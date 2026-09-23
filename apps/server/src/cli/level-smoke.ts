import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {startRenderer, playlistSegments, type Renderer} from '../audio/hls.js';
import {createFixture} from '../audio/fixture.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';

loadEnvironment();
const config = readConfig();
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-level-'));
let renderer: Renderer | undefined;
const failures: Error[] = [];
const usePcm = process.argv.includes('--pcm');
let source: ReturnType<typeof createReadStream> | undefined;
async function segments() {
	return playlistSegments(await readFile(path.join(directory, 'stream.m3u8'), 'utf8'));
}

async function levels(file: string) {
	const result = await runAudioCommand(config.ffmpegPath, ['-v', 'info', '-nostdin', '-i', path.join(directory, file), '-af', 'volumedetect', '-f', 'null', '-']);
	return {mean: Number(/mean_volume: (-?[\d.]+)/.exec(result.stderr)?.[1]), peak: Number(/max_volume: (-?[\d.]+)/.exec(result.stderr)?.[1])};
}

async function changed(percent: number) {
	const previous = await segments();
	const before = previous.length;
	await renderer!.setVolume!(percent);
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		// eslint-disable-next-line no-await-in-loop -- Wait for two complete new segments, excluding the transition segment.
		const current = await segments();
		if (current.length >= before + 2) {
			return levels(current[before + 1]!);
		}

		// eslint-disable-next-line no-await-in-loop -- Bounded encoder progress wait.
		await delay(200);
	}

	throw new Error('No complete segment after changing stream level');
}

try {
	const fixturePath = path.join(directory, 'fixture.wav');
	await createFixture(fixturePath, config.ffmpegPath);
	const pcmFile = path.join(directory, 'source.pcm');
	if (usePcm) {
		await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-nostdin', '-stream_loop', '-1', '-i', fixturePath, '-t', '120', '-f', 's16le', pcmFile]);
	}

	renderer = await startRenderer({
		...(usePcm
			? {
				pcm: {
					start(input) {
						source = createReadStream(pcmFile);
						source.pipe(input);
					},
					async stop() {
						source?.destroy();
					},
				},
			}
			: {}),
		directory, fixturePath, ffmpegPath: config.ffmpegPath, runId: randomUUID(), volumePercent: 100, onFailure: error => failures.push(error),
	});
	await renderer.ready();
	const {pid} = renderer;
	const initial = await segments();
	const original = await readFile(path.join(directory, initial[0]!));
	const baseline = await levels(initial[0]!);
	const half = await changed(50);
	const boosted = await changed(150);
	const muted = await changed(0);
	assert.ok(Math.abs((half.mean - baseline.mean) + 6.02) < 0.5, JSON.stringify({baseline, half}));
	assert.ok(Math.abs((boosted.mean - baseline.mean) - 3.52) < 0.5, JSON.stringify({baseline, boosted}));
	assert.ok(boosted.peak <= -11.7 && muted.peak < -80, JSON.stringify({boosted, muted}));
	assert.equal(renderer.pid, pid);
	assert.ok(original.equals(await readFile(path.join(directory, initial[0]!))), 'Previously published audio changed');
	assert.deepEqual(failures, []);
	console.log(`PASS: ${usePcm ? 'streamed PCM' : 'file source'}, same encoder; 50% ${half.mean} dBFS, 150% ${boosted.mean} dBFS (peak ${boosted.peak}),`
		+ ` mute ${muted.peak} dBFS; published audio unchanged.`);
} finally {
	await renderer?.stop();
	await rm(directory, {recursive: true, force: true});
}
