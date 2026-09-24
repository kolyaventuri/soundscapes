import assert from 'node:assert/strict';
import {
	mkdtemp, mkdir, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {sceneSchema} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {runAudioCommand} from '../audio/process.js';
import {readConfig} from '../config.js';
import {Store} from '../persistence/store.js';
import {SessionManager} from '../sessions/manager.js';
import {type Planner} from '../planning/contracts.js';
import {type SoundGenerator} from '../generation/contracts.js';

const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-phase4-'));
const defaults = readConfig({DATA_DIR: directory});
const config = {
	...defaults, planner: {...defaults.planner, skipProbability: 0, delayBuckets: [{weight: 1, minimumSeconds: 3, maximumSeconds: 3}]},
};
let beds = 0;
let events = 0;
let cancelled = 0;
let hang = false;
const generator: SoundGenerator = {
	diagnostics: () => ({pid: null, loaded: false, busy: false}), close: async () => undefined,
	async generate(request, signal) {
		if (hang) {
			try {
				await delay(10_000, undefined, {signal});
			} catch (error) {
				cancelled++;
				throw error;
			}
		}

		const output = path.join(config.sound.output, `${request.id}.wav`);
		await mkdir(config.sound.output, {recursive: true});
		if (request.kind === 'event') {
			events++;
			if (events === 1) {
				throw new Error('Injected inference failure');
			}

			await (events === 2 ? writeFile(output, 'invalid generated WAV') : synthesize());
		} else {
			beds++;
			await synthesize();
		}

		async function synthesize() {
			await runAudioCommand(config.ffmpegPath, [
				'-v',
				'error',
				'-nostdin',
				'-y',
				'-f',
				'lavfi',
				'-i',
				`anoisesrc=color=pink:amplitude=${request.kind === 'ambience' && beds === 1 ? 0.000_01 : 0.1}:sample_rate=44100:duration=${request.durationSeconds}:seed=${request.seed}`,
				'-af',
				'lowpass=f=1000',
				'-ac',
				'2',
				'-c:a',
				'pcm_f32le',
				output,
			], 30_000, signal);
		}

		return {
			id: request.id, path: output, model: 'stable-audio-3-small-sfx', revision: 'a'.repeat(40), durationSeconds: request.durationSeconds,
			sampleRate: 44_100, channels: 2, elapsedMs: 1, loadMs: 0, peakRssBytes: 0,
		};
	},
};
const planner: Planner = {
	busy: false,
	async parseScene(originalPrompt) {
		return sceneSchema.parse({
			title: 'Phase 4 test park', originalPrompt, sleepMode: true, simulatedStart: '2000-01-01T01:00:00Z', allowedEventCategories: ['wind'],
		});
	},
	async propose(context) {
		return context.recentEvents.length > 0
			? {
				event: null, assetId: null, category: null, durationSeconds: null, prominence: null, reason: 'Keep it sparse',
			}
			: {
				event: 'A gentle distant breeze', assetId: null, category: 'wind', durationSeconds: 12, prominence: 0.1, reason: 'Test generated event',
			};
	},
};
const database = path.join(directory, 'test.sqlite');
let store = new Store(database);
const onEvent = (event: string, sessionId: string, detail?: string) => {
	console.log(`[${event}] ${detail ?? sessionId}`);
};

let manager = new SessionManager({
	config, store, planner, soundGenerator: generator, onEvent,
});
let app = await buildApp({config, sessions: manager});
try {
	let origin = await app.listen({host: '127.0.0.1', port: 0});
	const prompt = 'A quiet test park with gentle wind.';
	const {session, listenerId, streamUrl} = manager.create('ambience', prompt);
	await manager.play(session.id, listenerId);
	assert.equal(beds, 4);
	const quietBed = store.assets().find(asset => asset.generation?.warning);
	assert.ok(quietBed && quietBed.meanDb < -38 && quietBed.peakDb <= -18, 'Quiet valid audio must be retained with bounded gain and a warning');
	assert.equal(manager.get(session.id).audioSource, 'generated');
	let minimum = 180;
	const monitor = setInterval(() => {
		minimum = Math.min(minimum, manager.debug(session.id).bufferAheadSeconds);
	}, 500);
	try {
		console.log('Decoding 145 seconds of real HLS while inference and invalid-output failures are injected…');
		await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', `${origin}${streamUrl}`, '-t', '145', '-f', 'null', '-'], 185_000);
	} finally {
		clearInterval(monitor);
	}

	assert.ok(minimum >= 45, `Buffer fell to ${minimum}s`);
	assert.equal(events, 3);
	assert.equal(store.events(session.id).length, 1);
	assert.equal(store.assets().length, 5, 'Rejected outputs must not enter the library');
	await manager.pause(session.id, listenerId);
	const elapsed = manager.get(session.id).activeElapsedMs;
	const pool = manager.debug(session.id).ambiencePoolSize;
	await app.close();
	store = new Store(database);
	manager = new SessionManager({
		config, store, planner, soundGenerator: generator, onEvent,
	});
	await manager.initialize();
	app = await buildApp({config, sessions: manager});
	origin = await app.listen({host: '127.0.0.1', port: 0});
	assert.equal(manager.get(session.id).activeElapsedMs, elapsed);
	await manager.play(session.id, listenerId);
	await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', `${origin}${streamUrl}`, '-t', '2', '-f', 'null', '-']);
	assert.equal(manager.debug(session.id).ambiencePoolSize, pool);
	assert.equal(beds, 4, 'Restoration must reuse existing beds');
	await manager.stop(session.id);
	const repeated = manager.create('ambience', prompt);
	await manager.play(repeated.session.id, repeated.listenerId);
	assert.equal(beds, 4, 'A repeated exact scene must reuse existing beds');
	await manager.stop(repeated.session.id);
	hang = true;
	const interrupted = manager.create('ambience', 'A different quiet park');
	await delay(100);
	await manager.pause(interrupted.session.id, interrupted.listenerId);
	assert.equal(manager.get(interrupted.session.id).status, 'idle');
	assert.equal(manager.debug(interrupted.session.id).generationQueue.length, 0);
	assert.equal(cancelled, 1);
	await manager.sweep();
	assert.equal(beds, 4, 'Idle sessions must not dispatch new inference');
	await manager.stop(interrupted.session.id);
	console.log(`PASS: four validated beds; reuse and restart; generated event through HLS; failed/invalid output isolation; cancellation; minimum buffer ${minimum.toFixed(1)}s.`);
} finally {
	await app.close();
	await rm(directory, {recursive: true, force: true});
}
