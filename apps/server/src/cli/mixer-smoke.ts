import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAmbienceFixtures} from '../assets/fixtures.js';
import {mixArguments, renderChunk} from '../ambience/mix.js';
import {extendTimeline, type TimelineState} from '../ambience/timeline.js';
import {loadEnvironment, readConfig} from '../config.js';
import {Store} from '../persistence/store.js';
import {importEvent} from '../assets/events.js';
import {runAudioCommand} from '../audio/process.js';
import {type ScheduledEvent} from '../planning/contracts.js';
import {startAmbienceRenderer} from '../ambience/renderer.js';

loadEnvironment();
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-mix-'));
const config = {...readConfig(), dataDirectory: directory};
const store = new Store();
try {
	await createAmbienceFixtures(config, store);
	const source = path.join(directory, 'event.wav');
	await runAudioCommand(config.ffmpegPath, [
		'-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.1:duration=12:seed=777', '-af', 'lowpass=f=900', '-ac', '2', source,
	]);
	const eventAsset = await importEvent(source, {
		title: 'Gentle test breeze', category: 'wind', tags: ['wind'], source: 'Synthetic test WAV; not an acoustic field recording', reviewedSleepSafe: true,
	}, config, store);
	const assets = store.assets();
	const timeline: TimelineState = {seed: 1932, beds: []};
	extendTimeline(timeline, assets.filter(asset => asset.kind === 'ambience'), {untilMs: 180_000, playbackMs: 0});
	const events: ScheduledEvent[] = [{
		id: randomUUID(), assetId: eventAsset.id, description: 'Test breeze', category: 'wind', startMs: 85_000, durationMs: 12_000,
		gain: 0.25, fadeMs: 1000, pan: 0.15, lowpassHz: 3500, prominence: 0.1, simulatedTime: '2000-01-01T01:01:25Z',
	}];
	const reference = path.join(directory, 'reference.pcm');
	const first = path.join(directory, 'first.pcm');
	const second = path.join(directory, 'second.pcm');
	for (const [startMs, durationMs, output] of [[60_000, 60_000, reference], [60_000, 30_000, first], [90_000, 30_000, second]] as const) {
		// eslint-disable-next-line no-await-in-loop -- Avoid overlapping FFmpeg jobs in this offline check.
		await renderChunk(config.ffmpegPath, mixArguments({
			beds: timeline.beds, assets, events, root: directory, startMs, durationMs, output,
		}), new AbortController().signal);
	}

	const referenceBytes = await readFile(reference);
	const firstBytes = await readFile(first);
	const secondBytes = await readFile(second);
	assert.equal(firstBytes.length + secondBytes.length, referenceBytes.length);
	let maximumDifference = 0;
	for (let offset = 0; offset < referenceBytes.length; offset += 2) {
		const chunkValue = offset < firstBytes.length ? firstBytes.readInt16LE(offset) : secondBytes.readInt16LE(offset - firstBytes.length);
		maximumDifference = Math.max(maximumDifference, Math.abs(referenceBytes.readInt16LE(offset) - chunkValue));
	}

	// FFmpeg's two-/three-input float mixing paths can round one s16 unit
	// differently. This tolerance is -90.3 dBFS, not a gap/fade discontinuity.
	assert.ok(maximumDifference <= 1, `Chunked event mix differs from continuous reference by ${maximumDifference} PCM units`);
	const samples = new DataView(referenceBytes.buffer, referenceBytes.byteOffset, referenceBytes.byteLength);
	const levels: number[] = [];
	let peak = 0;
	for (let second = 0; second < 60; second++) {
		let power = 0;
		for (let sample = 0; sample < 88_200; sample++) {
			const value = samples.getInt16(((second * 88_200) + sample) * 2, true) / 32_768;
			power += value ** 2;
			peak = Math.max(peak, Math.abs(value));
		}

		levels.push(10 * Math.log10(power / 88_200));
	}

	const spread = Math.max(...levels) - Math.min(...levels);
	assert.ok(spread < 2, `Crossfade loudness spread ${spread} dB exceeds 2 dB`);
	assert.ok(peak < 0.125, `Unencoded mix peak is too high: ${peak}`);
	const baseline = path.join(directory, 'baseline.pcm');
	await renderChunk(config.ffmpegPath, mixArguments({
		beds: timeline.beds, assets, root: directory, startMs: 60_000, durationMs: 60_000, output: baseline,
	}), new AbortController().signal);
	const baselineBytes = await readFile(baseline);
	assert.ok(referenceBytes.subarray(0, 25 * 176_400).equals(baselineBytes.subarray(0, 25 * 176_400)), 'Event changed earlier audio');
	assert.ok(!referenceBytes.equals(baselineBytes), 'Event was not actually mixed');
	assert.ok(referenceBytes.subarray(38 * 176_400).equals(baselineBytes.subarray(38 * 176_400)), 'Event changed later audio');
	const offsets = [86_395.225_720_480_08, 74_999.999, 90_000.001, 149_999.999];
	let seed = 1234;
	for (let index = 0; index < 20; index++) {
		seed = ((seed * 1_664_525) + 1_013_904_223) % 0x1_00_00_00_00;
		offsets.push((seed / 0x1_00_00_00_00) * 150_000);
	}

	for (const startMs of offsets) {
		// eslint-disable-next-line no-await-in-loop -- Regression for timestamp-dependent infinite padding at fractional resumes.
		await renderChunk(config.ffmpegPath, mixArguments({
			beds: timeline.beds, assets, root: directory, startMs, durationMs: 30_000, output: baseline,
		}), new AbortController().signal);
		// eslint-disable-next-line no-await-in-loop
		const bytes = await readFile(baseline);
		assert.equal(bytes.length, 30 * 176_400, `Unbounded/incomplete chunk at ${startMs}`);
		for (let second = 0; second < 30; second++) {
			let power = 0;
			for (let frame = 0; frame < 44_100; frame++) {
				power += (bytes.readInt16LE(((second * 44_100) + frame) * 4) / 32_768) ** 2;
			}

			assert.ok(10 * Math.log10(power / 44_100) > -45, `Unexpected silence at ${startMs}, second ${second}`);
		}
	}

	let optionalFailures = 0;
	const fatalFailures: unknown[] = [];
	const brokenEvents = [{...events[0]!, startMs: 1000}];
	const renderer = await startAmbienceRenderer({
		root: directory, temporary: path.join(directory, 'temp'), directory: path.join(directory, 'hls'), runId: randomUUID(),
		fixturePath: config.fixturePath, ffmpegPath: config.ffmpegPath, assets: assets.filter(asset => asset.kind === 'ambience'),
		eventAssets: [{...eventAsset, file: 'assets/events/missing.wav'}], timeline, events: brokenEvents, playbackMs: () => 0,
		onPlan() {/* Offline continuity check. */}, onFailure(error) {
			fatalFailures.push(error);
		}, onOptionalFailure() {
			optionalFailures++;
		},
	});
	try {
		await renderer.ready();
		assert.equal(optionalFailures, 1);
		assert.deepEqual(fatalFailures, []);
		assert.equal(brokenEvents.length, 0);
		assert.ok(renderer.eventStartMs!() > renderer.diagnostics!().committedUntilMs);
		assert.ok(renderer.eventStartMs!() > renderer.diagnostics!().renderedUntilMs);
	} finally {
		await renderer.stop();
	}

	console.log(`PASS: crossfade/event continuity within ${maximumDifference} s16 unit; earlier/later audio unchanged; `
		+ `RMS spread ${spread.toFixed(2)} dB, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS.`);
	console.log('PASS: missing optional WAV falls back to ambience; future event slot stays beyond rendered and committed audio.');
	console.log(`PASS: ${offsets.length} fractional resume positions produce exactly 30 seconds of non-silent, size-bounded PCM.`);
} finally {
	store.close();
	await rm(directory, {recursive: true, force: true});
}
