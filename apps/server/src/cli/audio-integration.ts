/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP result assertions next to each awaited operation. */
import assert from 'node:assert/strict';
import {
	mkdtemp, readFile, readdir, rm, stat,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {listenerSessionSchema, sessionSchema, type Session} from '@soundscapes/shared';
import {createAmbienceFixtures} from '../assets/fixtures.js';
import {Store} from '../persistence/store.js';
import {buildApp} from '../app.js';
import {createFixture} from '../audio/fixture.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';
import {SessionManager} from '../sessions/manager.js';

loadEnvironment();
const mode = process.argv.includes('--ambience') ? 'ambience' : 'fixture';
const playbackSeconds = z.coerce.number().int().min(2).max(28_800).parse(process.env.AUDIO_TEST_SECONDS ?? (mode === 'ambience' ? 105 : 2));
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-http-'));
const config = {
	...readConfig(), dataDirectory: directory,
	fixturePath: path.join(directory, 'fixture.wav'), idleTimeoutMs: mode === 'ambience' ? 30_000 : 4000,
};
const database = path.join(directory, 'test.sqlite');
const onEvent = (event: string, sessionId: string, detail?: string) => {
	if (mode === 'ambience') {
		console.log(`[lifecycle] ${event}${detail ? `: ${detail}` : ''}`);
	}
};

let manager = new SessionManager({config, store: new Store(database), onEvent});
let app = await buildApp({config, sessions: manager});

try {
	await createFixture(config.fixturePath, config.ffmpegPath);
	if (mode === 'ambience') {
		const library = new Store(database);
		try {
			await createAmbienceFixtures(config, library);
		} finally {
			library.close();
		}
	}

	let baseUrl = await app.listen({host: '127.0.0.1', port: 0});
	const created = await fetch(`${baseUrl}/api/sessions`, {
		method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode}),
	});
	assert.equal(created.status, 202);
	const {session, listenerId, streamUrl} = listenerSessionSchema.parse(await created.json());
	let sessionUrl = `${baseUrl}/api/sessions/${session.id}`;
	async function status() {
		const response = await fetch(sessionUrl);
		assert.equal(response.status, 200);
		return sessionSchema.parse(await response.json());
	}

	async function waitFor(expected: Session['status']) {
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline) {
			// eslint-disable-next-line no-await-in-loop -- Poll the actual server with a bounded deadline.
			const current = await status();
			if (current.status === expected) {
				return current;
			}

			assert.notEqual(current.status, 'error', current.error);
			// eslint-disable-next-line no-await-in-loop -- Avoid busy polling during encoder initialization.
			await delay(100);
		}

		throw new Error(`Timed out waiting for ${expected}`);
	}

	async function control(action: 'play' | 'pause' | 'stop') {
		const response = await fetch(`${sessionUrl}/${action}`, {
			method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({listenerId}),
		});
		assert.equal(response.status, 200);
		return sessionSchema.parse(await response.json());
	}

	assert.equal((await waitFor('idle')).rendering, false);
	assert.equal((await control('play')).rendering, true);
	const runId = manager.debug(session.id).currentRun!;
	const manifest = await fetch(`${baseUrl}${streamUrl}`);
	assert.equal(manifest.headers.get('cache-control'), 'no-store');
	const playlist = await manifest.text();
	assert.ok(playlist.split('\n').filter(line => line.startsWith('/api/')).length >= 3);
	console.log(`Decoding ${playbackSeconds} seconds of ${mode} HLS through real HTTP…`);
	let samples = 0;
	let minimumAhead = Number.POSITIVE_INFINITY;
	let maximumAhead = 0;
	const monitor = setInterval(() => {
		const debug = manager.debug(session.id);
		minimumAhead = Math.min(minimumAhead, debug.bufferAheadSeconds);
		maximumAhead = Math.max(maximumAhead, debug.bufferAheadSeconds);
		samples++;
	}, 500);
	try {
		const decoded = await runAudioCommand(config.ffmpegPath, [
			'-v', 'error', '-xerror', '-nostdin', '-i', `${baseUrl}${streamUrl}`, '-t', String(playbackSeconds), '-progress', 'pipe:1', '-f', 'null', '-',
		], (playbackSeconds + 30) * 1000);
		const times = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)];
		assert.ok(Number(times.at(-1)?.[1]) >= (playbackSeconds - 0.1) * 1_000_000, 'Decoder ended before the requested duration');
	} finally {
		clearInterval(monitor);
	}

	if (mode === 'ambience') {
		assert.ok(minimumAhead >= 45 && maximumAhead <= 180, `Buffer outside limits: ${minimumAhead}…${maximumAhead}`);
		assert.equal(manager.debug(session.id).ambiencePoolSize, 4);
		const runDirectory = path.join(directory, 'sessions', session.id, 'hls', runId);
		const files = await readdir(runDirectory);
		assert.ok(files.filter(file => file.endsWith('.ts')).length <= 21);
		assert.ok(manager.debug(session.id).queuedPcmChunks <= 6);
		console.log(`PASS: ${samples} buffer samples: ${minimumAhead.toFixed(1)}–${maximumAhead.toFixed(1)} seconds ahead, bounded PCM/HLS retention.`);
	}

	assert.equal((await control('pause')).status, 'idle');
	const playlistPath = path.join(directory, 'sessions', session.id, 'hls', runId, 'stream.m3u8');
	const frozenPlaylist = await readFile(playlistPath, 'utf8');
	const elapsed = (await status()).activeElapsedMs;
	const stale = await fetch(`${baseUrl}${streamUrl}`);
	assert.equal(stale.status, 200);
	await delay(1200);
	assert.equal(await readFile(playlistPath, 'utf8'), frozenPlaylist);
	assert.equal((await status()).activeElapsedMs, elapsed);
	assert.equal((await status()).rendering, false);
	await control('play');
	assert.notEqual(manager.debug(session.id).currentRun, runId);
	await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-nostdin', '-i', `${baseUrl}${streamUrl}`, '-t', '2', '-f', 'null', '-']);
	assert.equal((await waitFor('idle')).rendering, false);
	assert.equal(manager.debug(session.id).listeners[0]?.state, 'expired');
	const reconnected = await fetch(`${baseUrl}${streamUrl}`);
	assert.equal(reconnected.status, 200);
	assert.equal((await status()).status, 'active');
	if (mode === 'ambience') {
		const beforeRestart = await status();
		await app.close();
		manager = new SessionManager({config, store: new Store(database), onEvent});
		await manager.initialize();
		app = await buildApp({config, sessions: manager});
		baseUrl = await app.listen({host: '127.0.0.1', port: 0});
		sessionUrl = `${baseUrl}/api/sessions/${session.id}`;
		const restored = await status();
		assert.equal(restored.id, session.id);
		assert.equal(restored.status, 'idle');
		assert.ok(restored.activeElapsedMs >= beforeRestart.activeElapsedMs);
		await delay(200);
		assert.equal((await status()).activeElapsedMs, restored.activeElapsedMs);
		await control('play');
		await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', `${baseUrl}${streamUrl}`, '-t', '2', '-f', 'null', '-']);
		console.log('PASS: normal restart preserves session/listener IDs, clock, timeline, and playable audio.');
	}

	await control('stop');
	await assert.rejects(stat(path.join(directory, 'sessions', session.id)), {code: 'ENOENT'});
	console.log('PASS: real HTTP HLS decode, bounded preparation, pause/stale requests, frozen clock, resume, watchdog idle, HLS reconnect, stop, and cleanup (watchdog accelerated for the test).');
} finally {
	await app.close();
	await rm(directory, {recursive: true, force: true});
}
