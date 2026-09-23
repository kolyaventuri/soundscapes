/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP result assertions next to each awaited operation. */
import assert from 'node:assert/strict';
import {
	mkdtemp, readFile, rm, stat,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {listenerSessionSchema, sessionSchema, type Session} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {createFixture} from '../audio/fixture.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';
import {SessionManager} from '../sessions/manager.js';

loadEnvironment();
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-http-'));
const config = {
	...readConfig(), dataDirectory: directory,
	fixturePath: path.join(directory, 'fixture.wav'), idleTimeoutMs: 4000,
};
const manager = new SessionManager({config});
const app = await buildApp({config, sessions: manager});

try {
	await createFixture(config.fixturePath, config.ffmpegPath);
	const baseUrl = await app.listen({host: '127.0.0.1', port: 0});
	const created = await fetch(`${baseUrl}/api/sessions`, {
		method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'fixture'}),
	});
	assert.equal(created.status, 202);
	const {session, listenerId, streamUrl} = listenerSessionSchema.parse(await created.json());
	const sessionUrl = `${baseUrl}/api/sessions/${session.id}`;
	async function status() {
		const response = await fetch(sessionUrl);
		assert.equal(response.status, 200);
		return sessionSchema.parse(await response.json());
	}

	async function waitFor(expected: Session['status']) {
		const deadline = Date.now() + 25_000;
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
	await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-nostdin', '-i', `${baseUrl}${streamUrl}`, '-t', '2', '-f', 'null', '-']);
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
	await control('stop');
	await assert.rejects(stat(path.join(directory, 'sessions', session.id)), {code: 'ENOENT'});
	console.log('PASS: real HTTP HLS decode, bounded preparation, pause/stale requests, frozen clock, resume, watchdog idle, HLS reconnect, stop, and cleanup (watchdog accelerated to 4 seconds).');
} finally {
	await app.close();
	await rm(directory, {recursive: true, force: true});
}
