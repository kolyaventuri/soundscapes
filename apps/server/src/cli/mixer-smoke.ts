import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAmbienceFixtures} from '../assets/fixtures.js';
import {mixArguments, renderChunk} from '../ambience/mix.js';
import {extendTimeline, type TimelineState} from '../ambience/timeline.js';
import {loadEnvironment, readConfig} from '../config.js';
import {Store} from '../persistence/store.js';

loadEnvironment();
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-mix-'));
const config = {...readConfig(), dataDirectory: directory};
const store = new Store();
try {
	await createAmbienceFixtures(config, store);
	const assets = store.assets();
	const timeline: TimelineState = {seed: 1932, beds: []};
	extendTimeline(timeline, assets, {untilMs: 180_000, playbackMs: 0});
	const reference = path.join(directory, 'reference.pcm');
	const first = path.join(directory, 'first.pcm');
	const second = path.join(directory, 'second.pcm');
	for (const [startMs, durationMs, output] of [[60_000, 60_000, reference], [60_000, 30_000, first], [90_000, 30_000, second]] as const) {
		// eslint-disable-next-line no-await-in-loop -- Avoid overlapping FFmpeg jobs in this offline check.
		await renderChunk(config.ffmpegPath, mixArguments({
			beds: timeline.beds, assets, root: directory, startMs, durationMs, output,
		}), new AbortController().signal);
	}

	const referenceBytes = await readFile(reference);
	const firstBytes = await readFile(first);
	const secondBytes = await readFile(second);
	const referenceHash = createHash('sha256').update(referenceBytes).digest('hex');
	const chunkHash = createHash('sha256').update(firstBytes).update(secondBytes).digest('hex');
	assert.equal(referenceHash, chunkHash, 'Chunk boundary differs from continuous reference mix');
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
	console.log(`PASS: chunks match a continuous 15-second crossfade; RMS spread ${spread.toFixed(2)} dB, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS.`);
} finally {
	store.close();
	await rm(directory, {recursive: true, force: true});
}
