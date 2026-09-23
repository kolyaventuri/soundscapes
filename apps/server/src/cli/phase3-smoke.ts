import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sceneSchema} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {createAmbienceFixtures} from '../assets/fixtures.js';
import {importEvent} from '../assets/events.js';
import {runAudioCommand} from '../audio/process.js';
import {readConfig} from '../config.js';
import {Store} from '../persistence/store.js';
import {SessionManager} from '../sessions/manager.js';
import {type Planner} from '../planning/contracts.js';

const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-phase3-'));
const defaults = readConfig();
const config = {
	...defaults, dataDirectory: directory, idleTimeoutMs: 30_000,
	planner: {...defaults.planner, skipProbability: 0, delayBuckets: [{weight: 1, minimumSeconds: 3, maximumSeconds: 3}]},
};
const database = path.join(directory, 'test.sqlite');
let store = new Store(database);
let calls = 0;
let nulls = 0;
let failures = 0;
const planner: Planner = {
	busy: false,
	async parseScene(originalPrompt) {
		return sceneSchema.parse({
			title: 'Test park', originalPrompt, sleepMode: true, simulatedStart: '1932-10-01T01:00:00Z', allowedEventCategories: ['wind'],
		});
	},
	async propose(context) {
		calls++;
		if (calls === 2) {
			failures++;
			throw new Error('Injected local planner failure');
		}

		const asset = context.library[0];
		if (!asset) {
			nulls++;
			return {
				event: null, assetId: null, category: null, durationSeconds: null, prominence: null, reason: 'No unrepeated compatible event',
			};
		}

		return {
			event: 'A gentle breeze', assetId: asset.id, category: asset.category, durationSeconds: 12, prominence: 0.1, reason: 'Test library breeze',
		};
	},
};
const onEvent = (event: string, sessionId: string, detail?: string) => {
	console.log(`[${event}] ${detail ?? sessionId}`);
};

let manager = new SessionManager({
	config, store, planner, onEvent,
});
let app = await buildApp({config, sessions: manager});
try {
	await createAmbienceFixtures(config, store);
	const source = path.join(directory, 'event.wav');
	await runAudioCommand(config.ffmpegPath, [
		'-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.1:duration=12:seed=777', '-af', 'lowpass=f=900', '-ac', '2', source,
	]);
	await importEvent(source, {
		title: 'Gentle test breeze', category: 'wind', tags: ['wind'], source: 'Synthetic test WAV', reviewedSleepSafe: true,
	}, config, store);
	let origin = await app.listen({host: '127.0.0.1', port: 0});
	const {session, listenerId, streamUrl} = manager.create('ambience', 'Quiet park with gentle wind in October 1932.');
	await manager.play(session.id, listenerId);
	let minimum = 180;
	const monitor = setInterval(() => {
		minimum = Math.min(minimum, manager.debug(session.id).bufferAheadSeconds);
	}, 500);
	console.log('Decoding 145 seconds of real HLS with scheduled event, null proposals, and an injected planner failure…');
	try {
		const result = await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', `${origin}${streamUrl}`, '-t', '145', '-progress', 'pipe:1', '-f', 'null', '-'], 185_000);
		const times = [...result.stdout.matchAll(/out_time_us=(\d+)/g)];
		assert.ok(Number(times.at(-1)?.[1]) >= 144_900_000);
	} finally {
		clearInterval(monitor);
	}

	assert.ok(minimum >= 45, `Buffer underflow: ${minimum}`);
	assert.ok(failures > 0 && nulls > 0, JSON.stringify({
		calls, failures, nulls, planning: manager.debug(session.id).planning,
	}));
	const debug = manager.debug(session.id);
	assert.equal(debug.status, 'active');
	assert.equal(debug.scheduledEvents.length, 1);
	assert.ok(debug.scheduledEvents[0]!.startMs >= 90_000);
	assert.ok(debug.scheduledEvents[0]!.startMs + debug.scheduledEvents[0]!.durationMs < 145_000);
	assert.equal(store.events(session.id).length, 1);
	await manager.pause(session.id, listenerId);
	const remaining = manager.debug(session.id).nextEventOpportunitySeconds;
	const elapsed = manager.get(session.id).activeElapsedMs;
	await app.close();
	store = new Store(database);
	manager = new SessionManager({
		config, store, planner, onEvent,
	});
	await manager.initialize();
	app = await buildApp({config, sessions: manager});
	origin = await app.listen({host: '127.0.0.1', port: 0});
	const restored = manager.debug(session.id);
	assert.equal(restored.scene.originalPrompt, 'Quiet park with gentle wind in October 1932.');
	assert.equal(restored.scheduledEvents.length, 1);
	assert.equal(restored.nextEventOpportunitySeconds, remaining);
	assert.equal(restored.activeElapsedMs, elapsed);
	assert.equal(store.events(session.id).length, 1);
	await manager.play(session.id, listenerId);
	await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', `${origin}${streamUrl}`, '-t', '2', '-f', 'null', '-']);
	await manager.stop(session.id);
	console.log(`PASS: event traversed real HLS; minimum buffer ${minimum.toFixed(1)}s; ${calls} proposals, ${nulls} nulls, ${failures} injected failures; `
		+ 'scene/history/opportunity/clock persisted across restart.');
} finally {
	await app.close();
	await rm(directory, {recursive: true, force: true});
}
