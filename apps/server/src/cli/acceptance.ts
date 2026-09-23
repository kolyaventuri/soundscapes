/* eslint-disable no-await-in-loop -- This bounded acceptance run follows one session serially. */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, stat} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {listenerSessionSchema, sessionSchema, type ListenerSession} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';
import {PythonSoundGenerator} from '../generation/python.js';
import {type SoundGenerator} from '../generation/contracts.js';
import {collectSample} from '../monitoring/sample.js';
import {RotatingLog, writeJson} from '../monitoring/storage.js';
import {RunSummary} from '../monitoring/summary.js';
import {Store} from '../persistence/store.js';
import {OllamaPlanner} from '../planning/ollama.js';
import {type Planner} from '../planning/contracts.js';
import {SessionManager} from '../sessions/manager.js';

loadEnvironment();
const defaults = readConfig();
assert.ok(defaults.sound.enabled, 'Enable the installed local sound model before running acceptance.');
const parent = path.join(defaults.dataDirectory, 'acceptance');
await mkdir(parent, {recursive: true});
const directory = await mkdtemp(path.join(parent, `${new Date().toISOString().replaceAll(':', '-')}-`));
const config = {
	...defaults, tls: undefined, dataDirectory: directory, idleTimeoutMs: 30_000,
	// Exercise opportunities in minutes; this is not a production-cadence soak.
	planner: {...defaults.planner, delayScale: 0.05},
	sound: {...defaults.sound, output: path.join(directory, 'quarantine/sound')},
};
const prompt = 'Central Park, New York City, October 1932, around 1 AM. Cool autumn night. Quiet and appropriate for sleeping.';
const playbackSeconds = 240;
const report: Record<string, unknown> = {
	formatVersion: 1, startedAt: new Date().toISOString(), outcome: 'running', prompt, playbackSeconds,
	models: {planner: config.planner.model, sound: config.sound.model, device: config.sound.device},
	testOverrides: {eventDelayScale: config.planner.delayScale, idleTimeoutSeconds: 30},
	limits: [
		'Four-minute FFmpeg decoder on the server; no physical-device or listening acceptance.',
		'Existing installed models and Ollama service; no model download or setup-token use.',
		'Server RSS includes this CLI; ps sampling can miss brief jobs. External Ollama and GPU allocation are not included.',
		'Actual model decisions are recorded, including nulls and errors; scripted failure/reuse tests are separate.',
	],
};
const calls: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];
const samples = new RotatingLog(path.join(directory, 'samples.jsonl'));
let stage = 'preparation';
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let manager: SessionManager | undefined;
let origin = '';
let store: Store | undefined;
const snapshot = async () => writeJson(path.join(directory, 'report.json'), {...report, calls, events});

async function measured<T>(kind: string, work: () => Promise<T>): Promise<T> {
	const startedAt = new Date().toISOString();
	try {
		const result = await work();
		calls.push({
			kind, stage, startedAt, elapsedMs: Date.now() - Date.parse(startedAt), result,
		});
		return result;
	} catch (error) {
		calls.push({
			kind, stage, startedAt, elapsedMs: Date.now() - Date.parse(startedAt), error: String(error),
		});
		throw error;
	} finally {
		assert.ok(calls.length <= 128, 'Unexpected inference call count');
		await snapshot();
	}
}

class MeasuredPlanner extends OllamaPlanner {
	override async parseScene(...args: Parameters<Planner['parseScene']>) {
		return measured('scene', async () => super.parseScene(...args));
	}

	override async propose(...args: Parameters<Planner['propose']>) {
		return measured('proposal', async () => super.propose(...args));
	}
}

class MeasuredGenerator extends PythonSoundGenerator {
	override async generate(...args: Parameters<SoundGenerator['generate']>) {
		return measured(args[0].kind, async () => super.generate(...args));
	}
}

async function start() {
	store = new Store(path.join(directory, 'soundscapes.sqlite'));
	manager = new SessionManager({
		config, store, planner: new MeasuredPlanner(config.planner), soundGenerator: new MeasuredGenerator(config.sound),
		onEvent(event, sessionId, detail) {
			events.push({
				at: new Date().toISOString(), stage, event, sessionId, detail,
			});
			if (events.length > 256) {
				events.shift();
			}

			console.log(`[${stage}] ${event}${detail ? `: ${detail}` : ''}`);
		},
	});
	await manager.initialize();
	app = await buildApp({config, sessions: manager});
	origin = await app.listen({host: '127.0.0.1', port: 0});
}

async function request(route: string, body?: Record<string, unknown>) {
	const response = await fetch(`${origin}${route}`, {
		...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
		signal: AbortSignal.timeout(45_000), redirect: 'error',
	});
	assert.ok(response.ok, `${route}: HTTP ${response.status} ${response.ok ? '' : await response.text()}`);
	return response.json();
}

async function control(owner: ListenerSession, action: 'play' | 'pause' | 'stop') {
	return sessionSchema.parse(await request(`/api/sessions/${owner.session.id}/${action}`, {listenerId: owner.listenerId}));
}

async function prepare() {
	const started = Date.now();
	const owner = listenerSessionSchema.parse(await request('/api/sessions', {mode: 'ambience', prompt, sleepMode: true}));
	const deadline = started + (config.sound.timeoutMs * 4) + config.planner.timeoutMs + 60_000;
	let previous = '';
	while (Date.now() < deadline) {
		const current = sessionSchema.parse(await request(`/api/sessions/${owner.session.id}`));
		const progress = JSON.stringify(current.preparation);
		if (previous !== progress) {
			previous = progress;
			console.log(`[${stage}] ${progress}`);
		}

		assert.notEqual(current.status, 'error', current.error);
		if (current.ready && current.status === 'idle') {
			return {
				owner, readyMs: Date.now() - started, preparation: current.preparation, progress: current.progress,
			};
		}

		await delay(2000);
	}

	throw new Error('Preparation did not finish before its bounded deadline');
}

async function decode(owner: ListenerSession, seconds: number) {
	const decoded = await runAudioCommand(config.ffmpegPath, [
		'-hide_banner',
		'-xerror',
		'-nostdin',
		'-i',
		`${origin}${owner.streamUrl}`,
		'-t',
		String(seconds),
		'-af',
		'astats=reset=0,volumedetect',
		'-progress',
		'pipe:1',
		'-f',
		'null',
		'-',
	], (seconds + 45) * 1000);
	const times = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)];
	assert.ok(Number(times.at(-1)?.[1]) >= (seconds - 0.1) * 1_000_000, 'HLS decoder ended early');
	assert.ok(![...decoded.stderr.matchAll(/Number of (?:NaNs|Infs): ([\d.]+)/g)].some(match => Number(match[1]) > 0));
	const meanDb = Number(/mean_volume: (-?[\d.]+) dB/.exec(decoded.stderr)?.[1]);
	const peakDb = Number(/max_volume: (-?[\d.]+) dB/.exec(decoded.stderr)?.[1]);
	assert.ok(Number.isFinite(meanDb) && meanDb > -65 && peakDb <= -10, `Unexpected decoded levels: ${meanDb}/${peakDb}`);
	return {seconds, meanDb, peakDb};
}

function assertIdle(owner: ListenerSession) {
	const debug = manager!.debug(owner.session.id);
	assert.equal(debug.status, 'idle');
	assert.equal(debug.rendering, false);
	assert.equal(debug.producerPid, null);
	assert.equal(debug.soundWorker.busy, false);
	assert.equal(debug.planning.busy, false);
	assert.equal(debug.generationQueue.length, 0);
	return debug.activeElapsedMs;
}

try {
	const revision = await runAudioCommand('git', ['rev-parse', 'HEAD']);
	const dirty = await runAudioCommand('git', ['status', '--porcelain']);
	const ffmpeg = await runAudioCommand(config.ffmpegPath, ['-version']);
	report.sourceRevision = revision.stdout.trim();
	report.sourceDirty = dirty.stdout.trim().length > 0;
	report.ffmpeg = ffmpeg.stdout.split('\n')[0];
	console.log(`Acceptance report: ${path.join(directory, 'report.json')}`);
	await snapshot();
	await start();
	const prepared = await prepare();
	const {owner} = prepared;
	report.initialPreparation = prepared;
	assert.equal(store!.assets().filter(asset => asset.kind === 'ambience').length, 4);
	const {scene} = manager!.get(owner.session.id);
	assert.equal(scene?.year, 1932);
	assert.ok(scene?.simulatedStart.startsWith('1932-10-'));
	stage = 'playback';
	await control(owner, 'play');
	const summary = new RunSummary(5, owner.session.id);
	let decoding = true;
	// Collect serially, but concurrently with the real decoder; neither debug GET renews demand.
	async function monitor() {
		// eslint-disable-next-line no-unmodified-loop-condition -- The concurrent decoder clears this flag in finally.
		while (decoding) {
			const sample = await collectSample({origin, sessionId: owner.session.id, dataDirectory: directory});
			summary.add(sample);
			await samples.append(sample);
			await delay(5000);
		}
	}

	async function decodeAndFinish() {
		try {
			return await decode(owner, playbackSeconds);
		} finally {
			decoding = false;
		}
	}

	try {
		// Observe both promises immediately so sampling failures cannot be unhandled.
		const results = await Promise.allSettled([decodeAndFinish(), monitor()]);
		for (const result of results) {
			if (result.status === 'rejected') {
				throw new Error('Playback or sampling failed', {cause: result.reason});
			}
		}

		report.decodedAudio = results[0].status === 'fulfilled' ? results[0].value : null;
	} finally {
		decoding = false;
		report.playback = summary.json();
	}

	assert.equal(summary.completeSamples, summary.samples);
	assert.deepEqual(summary.issues, {});
	report.eventHistory = store!.events(owner.session.id);
	report.playbackDebug = manager!.debug(owner.session.id);
	stage = 'pause';
	await control(owner, 'pause');
	const frozen = assertIdle(owner);
	const callCount = calls.length;
	const stale = await fetch(`${origin}${owner.streamUrl}`, {signal: AbortSignal.timeout(5000)});
	assert.equal(stale.status, 200);
	await stale.body?.cancel();
	await delay(2000);
	assert.equal(assertIdle(owner), frozen);
	assert.equal(calls.length, callCount);
	stage = 'stream-loss';
	await control(owner, 'play');
	await decode(owner, 2);
	const deadline = Date.now() + 45_000;
	while (manager!.get(owner.session.id).status === 'active' && Date.now() < deadline) {
		await request(`/api/debug/sessions/${owner.session.id}`);
		await delay(1000);
	}

	const expiredClock = assertIdle(owner);
	assert.equal(manager!.debug(owner.session.id).listeners[0]?.state, 'expired');
	const bedCalls = calls.filter(call => call.kind === 'ambience').length;
	stage = 'restart';
	await app!.close();
	await start();
	assert.equal(assertIdle(owner), expiredClock);
	assert.deepEqual(manager!.get(owner.session.id).scene, scene);
	await control(owner, 'play');
	await decode(owner, 2);
	assert.equal(calls.filter(call => call.kind === 'ambience').length, bedCalls);
	await control(owner, 'stop');
	await assert.rejects(stat(path.join(directory, 'sessions', owner.session.id)), {code: 'ENOENT'});
	report.recovery = {
		explicitPause: true, streamLoss: true, restartSameWorld: true, noBedRegeneration: true, stopCleanup: true,
	};
	stage = 'repeat-scene';
	const repeated = await prepare();
	report.repeatPreparation = repeated;
	assert.equal(calls.filter(call => call.kind === 'ambience').length, bedCalls, 'Same prompt did not reuse all four beds');
	await control(repeated.owner, 'stop');
	report.assets = store!.assets();
	report.outcome = 'passed';
	console.log('PASS: real Central Park generation, four-minute HLS decode, measured levels/resources, pause/watchdog/restart, and repeated-scene reuse.');
	console.log('Listening and overnight acceptance remain open.');
} catch (error) {
	report.outcome = 'failed';
	report.error = String(error);
	console.error(error);
	process.exitCode = 1;
} finally {
	try {
		await app?.close();
	} finally {
		await manager?.close();
		report.completedAt = new Date().toISOString();
		await snapshot();
	}
}
