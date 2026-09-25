/* eslint-disable no-await-in-loop -- Serial lifecycle and generation checkpoints. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
	mkdir, mkdtemp, readFile, rm,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {sceneSchema} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {runAudioCommand} from '../audio/process.js';
import {mixArguments, renderChunk} from '../ambience/mix.js';
import {loadEnvironment, readConfig, repositoryRoot} from '../config.js';
import {Store} from '../persistence/store.js';
import {SessionManager} from '../sessions/manager.js';
import {type SoundGenerator} from '../generation/contracts.js';
import {type Planner} from '../planning/contracts.js';
import {layerClips} from '../layers/timeline.js';
import {testPlan} from '../layers/fixtures.js';
import {writeJson} from '../monitoring/storage.js';
import {assertBeachPlan, beachPrompt} from './layer-regression.js';

loadEnvironment();
const real = process.argv.includes('--real');
const defaults = readConfig();
const parent = real ? path.join(defaults.dataDirectory, 'layer-checks') : tmpdir();
await mkdir(parent, {recursive: true});
const directory = await mkdtemp(path.join(parent, 'layers-'));
const config = {
	...defaults, tls: undefined, dataDirectory: directory, idleTimeoutMs: 30_000,
};
let generated = 0;
let planned = 0;
let failOptional = false;
let failRequired = false;
let clockShift = 0;
let hang = false;
const generator: SoundGenerator = {
	diagnostics: () => ({pid: null, loaded: false, busy: false}), close: async () => undefined,
	async generate(request, signal) {
		generated++;
		if (hang) {
			await delay(60_000, undefined, {signal});
		}

		if (failRequired && request.durationSeconds === 120) {
			throw new Error('Injected required music failure');
		}

		if (failOptional && request.kind === 'event') {
			throw new Error('Injected optional-layer failure');
		}

		const output = path.join(directory, 'quarantine/sound', `${request.id}.wav`);
		await mkdir(path.dirname(output), {recursive: true});
		await runAudioCommand(config.ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-y',
			'-f',
			'lavfi',
			'-i',
			`anoisesrc=color=pink:amplitude=0.1:sample_rate=44100:duration=${request.durationSeconds}:seed=${request.seed}`,
			'-af',
			request.kind === 'event' ? 'lowpass=f=1000,volume=\'if(lt(mod(t,2),0.02),1,0)\':eval=frame' : 'lowpass=f=1000',
			'-ac',
			'2',
			'-c:a',
			'pcm_f32le',
			output,
		], 30_000, signal);
		return {
			id: request.id, path: output, model: 'stable-audio-3-medium', revision: 'a'.repeat(40), durationSeconds: request.durationSeconds,
			sampleRate: 44_100, channels: 2, elapsedMs: 1, loadMs: 0, peakRssBytes: 0,
		};
	},
};
const planner: Planner = {
	busy: false,
	async parseScene(originalPrompt) {
		return sceneSchema.parse({
			title: 'Layered café', originalPrompt, audioPrompt: originalPrompt, sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
		});
	},
	async planLayers() {
		planned++;
		const plan = structuredClone(testPlan);
		for (const [index, source] of plan.layers.at(-1)!.effectSources!.entries()) {
			source.gapSeconds = index === 0 ? {minimum: 20, maximum: 45} : {minimum: 45, maximum: 120};
		}

		return plan;
	},
	async propose() {
		throw new Error('Layer transitions must not request event planning');
	},
};
let manager: SessionManager;
let store: Store;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let origin = '';
const report: Record<string, unknown> = {
	real, startedAt: new Date().toISOString(), outcome: 'running', directory,
};
const onEvent = (event: string, id: string, detail?: string) => {
	console.log(`[${event}] ${detail ?? id}`);
};

async function start() {
	store = new Store(path.join(directory, 'test.sqlite'));
	manager = new SessionManager({
		config, store, onEvent, now: () => Date.now() + clockShift, ...real ? {} : {planner, soundGenerator: generator},
	});
	await manager.initialize();
	app = await buildApp({config, sessions: manager, webRoot: path.join(repositoryRoot, 'apps/web/dist')});
	origin = await app.listen({host: '127.0.0.1', port: 0});
}

async function decode(streamUrl: string, seconds: number) {
	const result = await runAudioCommand(config.ffmpegPath, ['-hide_banner',
		'-xerror',
		'-nostdin',
		'-i',
		`${origin}${streamUrl}`,
		'-t',
		String(seconds),
		'-af',
		'volumedetect',
		'-progress',
		'pipe:1',
		'-f',
		'null',
		'-'], (seconds + 45) * 1000);
	const times = [...result.stdout.matchAll(/out_time_us=(\d+)/g)];
	assert.ok(Number(times.at(-1)?.[1]) >= (seconds - 0.1) * 1_000_000);
	return {meanDb: Number(/mean_volume: (-?[\d.]+) dB/.exec(result.stderr)?.[1]), peakDb: Number(/max_volume: (-?[\d.]+) dB/.exec(result.stderr)?.[1])};
}

try {
	await start();
	const beach = real && process.argv.includes('--beach');
	const prompt = beach
		? beachPrompt
		: 'Inside a cozy café, soft jazz piano plays continuously, indistinct conversation fills the room, with brief occasional espresso machine sounds and frequent single cup clinks on tables.';
	const started = Date.now();
	const owner = manager!.create('ambience', prompt, false, 'layered');
	console.log(`Layered smoke: ${origin}/?session=${owner.session.id} · ${directory}`);
	await manager!.play(owner.session.id, owner.listenerId);
	report.readyMs = Date.now() - started;
	report.initial = manager!.debug(owner.session.id);
	if (beach) {
		assertBeachPlan(manager!.debug(owner.session.id).layeredTimeline!.plan);
	}

	if (real && !beach) {
		const {plan} = manager!.debug(owner.session.id).layeredTimeline!;
		assert.doesNotMatch(plan.layers.find(layer => layer.id === 'ambience')!.prompt, /espresso|steam|clink/i);
		const sources = plan.layers.find(layer => layer.id === 'effects')!.effectSources!;
		assert.deepEqual(sources.find(source => /cup|clink/i.test(source.prompt))!.gapSeconds, {minimum: 20, maximum: 45});
		assert.deepEqual(sources.find(source => /espresso|steam/i.test(source.prompt))!.gapSeconds, {minimum: 45, maximum: 120});
		assert.ok(sources.some(source => /espresso|steam/i.test(source.prompt) && !/cup|clink/i.test(source.prompt)));
		assert.ok(sources.some(source => /cup|clink/i.test(source.prompt) && !/espresso|steam/i.test(source.prompt)));
		const effects = store!.assets().filter(asset => asset.generation?.layerId === 'effects');
		assert.equal(new Set(effects.map(asset => asset.generation?.layerSource)).size, sources.length);
		for (const asset of effects) {
			assert.equal(asset.durationMs, sources[asset.generation!.layerSource!]!.durationSeconds * 1000);
		}
	}

	assert.ok(manager!.debug(owner.session.id).layeredTimeline!.layers.find(layer => layer.policy.id === 'effects')!.effectSchedule);
	const {layers} = manager!.debug(owner.session.id);
	assert.ok(layers.some(layer => layer.id === 'music') && layers.some(layer => layer.id === 'activity'));
	assert.ok(layers.every(layer => layer.state === 'ready' || (!layer.required && layer.state === 'unavailable')));
	if (!real) {
		const effects = layers.find(layer => layer.id === 'effects');
		assert.equal(effects?.state, 'ready', 'Sparse effects must remain playable');
		assert.match(effects?.warning ?? '', /kept with peak protection/);
		const recordings = store!.assets().filter(asset => asset.generation?.layerId === 'effects');
		assert.equal(recordings.length, 2);
		assert.ok(recordings.every(asset => asset.peakDb <= -25 && asset.generation?.warning));
	}

	let minimum = 180;
	const samples: unknown[] = [];
	const monitor = setInterval(() => {
		const debug = manager!.debug(owner.session.id);
		minimum = Math.min(minimum, debug.bufferAheadSeconds);
		samples.push({
			at: new Date().toISOString(), buffer: debug.bufferAheadSeconds, layers: debug.layers, worker: debug.soundWorker,
		});
	}, 2000);
	try {
		report.levels = await decode(owner.streamUrl, 165);
	} finally {
		clearInterval(monitor);
	}

	report.samples = samples;
	report.minimumBufferSeconds = minimum;
	assert.ok(minimum >= 45);
	await manager!.pause(owner.session.id, owner.listenerId);
	await delay(250);
	assert.equal(manager!.debug(owner.session.id).generationQueue.length, 0);
	const state = structuredClone(manager!.debug(owner.session.id).layeredTimeline!);
	const originalMusic = state.layers.find(layer => layer.policy.id === 'music');
	assert.ok(originalMusic && originalMusic.clips.length >= 2);
	const assets = store!.assets();
	const reference = path.join(directory, 'reference.pcm');
	// One absolute mix versus two chunks across both ambience and music transitions.
	const parts = [reference, path.join(directory, 'part1.pcm'), path.join(directory, 'part2.pcm')];
	for (const [index, output] of parts.entries()) {
		await renderChunk(config.ffmpegPath, mixArguments({
			beds: layerClips(state), assets, root: directory,
			startMs: index === 2 ? 120_000 : 90_000, durationMs: index === 0 ? 60_000 : 30_000, output,
		}), new AbortController().signal);
	}

	const whole = await readFile(reference);
	const a = await readFile(parts[1]!);
	const b = await readFile(parts[2]!);
	assert.equal(a.length + b.length, whole.length);
	let difference = 0;
	for (let offset = 0; offset < whole.length; offset += 2) {
		const value = offset < a.length ? a.readInt16LE(offset) : b.readInt16LE(offset - a.length);
		difference = Math.max(difference, Math.abs(value - whole.readInt16LE(offset)));
	}

	assert.ok(difference <= 1, `Layered chunk discontinuity: ${difference} PCM units`);
	report.chunkDifference = difference;
	const generatedBefore = generated;
	await app!.close();
	await start();
	assert.deepEqual(manager!.debug(owner.session.id).layeredTimeline, state);
	const resumeStarted = Date.now();
	await manager!.play(owner.session.id, owner.listenerId);
	report.resumeMs = Date.now() - resumeStarted;
	await decode(owner.streamUrl, 2);
	assert.deepEqual(store!.assets(), assets, 'Level warnings and measurements must survive restart');
	assert.equal(store!.assets().length, assets.length, 'Resume must not regenerate the world');
	assert.equal(generated, generatedBefore);
	await manager!.pause(owner.session.id, owner.listenerId);
	report.assets = store!.assets();
	await manager!.stop(owner.session.id);
	if (!real) {
		assert.equal(planned, 1, 'No per-transition or resume LLM calls');
		assert.equal(assets.length, 16, 'Background pools should expand within their target bounds');
		const repeated = manager!.create('ambience', prompt, false, 'layered');
		await manager!.play(repeated.session.id, repeated.listenerId);
		assert.equal(generated, generatedBefore, 'Initial pools must reuse cached layer-specific assets');
		await manager!.pause(repeated.session.id, repeated.listenerId);
		const missing = manager!.debug(repeated.session.id).layeredTimeline!.layers.find(layer => layer.policy.id === 'activity')!.assetIds;
		await Promise.all(store!.assets().filter(asset => missing.includes(asset.id)).map(async asset => rm(path.join(directory, asset.file))));
		await manager!.play(repeated.session.id, repeated.listenerId);
		assert.equal(manager!.get(repeated.session.id).layers.find(layer => layer.id === 'activity')?.state, 'unavailable');
		await decode(repeated.streamUrl, 2);
		await manager!.stop(repeated.session.id);
		failOptional = true;
		const degraded = manager!.create('ambience', `${prompt} Different scene.`, false, 'layered');
		await manager!.play(degraded.session.id, degraded.listenerId);
		assert.equal(manager!.get(degraded.session.id).layers.find(layer => layer.id === 'effects')?.state, 'unavailable');
		hang = true;
		await decode(degraded.streamUrl, 2);
		await delay(1500);
		await manager!.pause(degraded.session.id, degraded.listenerId);
		await delay(100);
		assert.equal(manager!.debug(degraded.session.id).generationQueue.length, 0, 'Pause cancels background expansion');
		await manager!.play(degraded.session.id, degraded.listenerId);
		await delay(1500);
		clockShift = 31_000;
		await manager!.sweep();
		await delay(100);
		assert.equal(manager!.get(degraded.session.id).status, 'idle');
		assert.equal(manager!.debug(degraded.session.id).producerPid, null);
		assert.equal(manager!.debug(degraded.session.id).generationQueue.length, 0, 'Watchdog cancels background expansion');
		await manager!.stop(degraded.session.id);
		hang = false;
		failRequired = true;
		const requiredFailure = manager!.create('ambience', `${prompt} Another distinct room.`, false, 'layered');
		await assert.rejects(manager!.play(requiredFailure.session.id, requiredFailure.listenerId), /required music failure/);
		assert.equal(manager!.get(requiredFailure.session.id).status, 'error');
		await manager!.stop(requiredFailure.session.id);
		hang = true;
		const cancelled = manager!.create('ambience', 'A new scene awaiting generation', false, 'layered');
		await delay(100);
		await manager!.pause(cancelled.session.id, cancelled.listenerId);
		assert.equal(manager!.get(cancelled.session.id).status, 'idle');
		assert.equal(manager!.debug(cancelled.session.id).generationQueue.length, 0);
		await manager!.stop(cancelled.session.id);
	}

	report.outcome = 'passed';
	console.log(`PASS: layered HLS, independent boundaries, <=1 PCM-unit chunk difference, restart and cancellation; minimum buffer ${minimum.toFixed(1)}s. Listening remains pending.`);
} catch (error) {
	report.outcome = 'failed';
	report.error = String(error);
	console.error(error);
	process.exitCode = 1;
} finally {
	await app?.close();
	await writeJson(path.join(directory, 'report.json'), {...report, completedAt: new Date().toISOString()});
	if (!real) {
		await rm(directory, {recursive: true, force: true});
	}
}
