import {randomUUID} from 'node:crypto';
import {
	mkdtemp, mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listenerSessionSchema, sceneSchema} from '@soundscapes/shared';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {buildApp} from '../app.js';
import {type Renderer, type RendererOptions} from '../audio/hls.js';
import {readConfig} from '../config.js';
import {Store} from '../persistence/store.js';
import {type Planner} from '../planning/contracts.js';
import {SessionManager} from './manager.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map(async dispose => dispose()));
});

async function setup(planner?: Planner) {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-session-'));
	const config = {...readConfig({SOUND_ENABLED: 'false'}), dataDirectory: directory, fixturePath: path.join(directory, 'fixture.wav')};
	await writeFile(config.fixturePath, 'fixture');
	let now = 1000;
	const renderers: Renderer[] = [];
	const factory = vi.fn(async (options: RendererOptions): Promise<Renderer> => {
		await mkdir(options.directory, {recursive: true});
		let running = true;
		const renderer: Renderer = {
			directory: options.directory, runId: options.runId, pid: 1234,
			get running() {
				return running;
			},
			async ready() {
				await writeFile(path.join(options.directory, 'stream.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment-000000001.ts\n');
				await writeFile(path.join(options.directory, 'segment-000000001.ts'), 'audio');
			},
			async stop() {
				running = false;
			},
		};
		renderers.push(renderer);
		return renderer;
	});
	const manager = new SessionManager({
		config, store: new Store(path.join(directory, 'test.sqlite')), rendererFactory: factory, now: () => now, automaticWatchdog: false,
		...(planner ? {planner} : {}),
	});
	cleanup.push(async () => {
		await manager.close();
		await rm(directory, {recursive: true, force: true});
	});
	return {
		manager, config, factory, renderers, now: () => now, advance(ms: number) {
			now += ms;
		},
	};
}

it('bounds preparation, stays idle without listeners, and never treats polling as demand', async () => {
	const {manager, renderers, factory, advance} = await setup();
	const {session, listenerId} = manager.create();
	expect(session.status).toBe('initializing');
	await manager.playlist(session.id, listenerId);
	expect(manager.get(session.id)).toMatchObject({
		status: 'idle', ready: true, rendering: false, listenerCount: 0,
	});
	advance(120_000);
	manager.get(session.id);
	await manager.playlist(session.id, listenerId);
	await manager.sweep();
	expect(factory).toHaveBeenCalledTimes(1);
	expect(renderers.every(renderer => !renderer.running)).toBe(true);
});

it('cancels scene initialization immediately on Stop without starting audio', async () => {
	const parseScene = vi.fn<Planner['parseScene']>(async () => new Promise(() => {/* Wait for cancellation. */}));
	const {manager, factory} = await setup({busy: false, parseScene, propose: vi.fn()});
	const {session} = manager.create('ambience', 'Quiet autumn park');
	await Promise.resolve();
	const stopped = await manager.stop(session.id);
	expect(stopped.status).toBe('stopped');
	expect(factory).not.toHaveBeenCalled();
	expect(manager.debug(session.id).rendering).toBe(false);
});

it('exposes live preparation without renewing a listener and resumes cancelled preparation in place', async () => {
	const parseScene = vi.fn<Planner['parseScene']>()
		.mockImplementationOnce(async () => new Promise(() => {/* Wait for explicit pause. */}))
		.mockImplementation(async originalPrompt => sceneSchema.parse({
			originalPrompt, title: 'Park', sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
		}));
	const {manager, advance} = await setup({busy: false, parseScene, propose: vi.fn()});
	const {session, listenerId} = manager.create('ambience', 'A park');
	await vi.waitFor(() => {
		expect(parseScene).toHaveBeenCalledTimes(1);
	});
	advance(120_000);
	expect(manager.get(session.id)).toMatchObject({ready: false, listenerCount: 0, progress: {stage: 'understanding', estimate: null, elapsedMs: 120_000}});
	expect(manager.debug(session.id).listeners[0]).toMatchObject({state: 'paused', lastConsumptionAgoSeconds: 120});
	await manager.pause(session.id, listenerId);
	expect(manager.get(session.id)).toMatchObject({status: 'idle', progress: {estimateReason: 'paused'}});
	expect(() => manager.resumePreparation(session.id, randomUUID())).toThrow('Listener not found');
	manager.resumePreparation(session.id, listenerId);
	manager.resumePreparation(session.id, listenerId);
	await vi.waitFor(() => {
		expect(manager.get(session.id).ready).toBe(true);
	});
	expect(parseScene).toHaveBeenCalledTimes(2);
	expect(manager.get(session.id)).toMatchObject({
		id: session.id, status: 'idle', listenerCount: 0, scene: {title: 'Park'}, progress: {stage: 'ready'},
	});
});

it('keeps playback controls responsive to an in-flight planner and freezes opportunity time while idle', async () => {
	let cancelled = false;
	const planner: Planner = {
		busy: false,
		async parseScene(originalPrompt) {
			return sceneSchema.parse({
				title: 'Autumn park', originalPrompt, sleepMode: true, simulatedStart: '1932-10-01T01:00:00Z',
			});
		},
		async propose(context, signal) {
			signal.addEventListener('abort', () => {
				cancelled = true;
			}, {once: true});
			return new Promise(() => {/* Model deliberately never resolves. */});
		},
	};
	const {manager, config, advance} = await setup(planner);
	config.planner.skipProbability = 0;
	config.planner.delayBuckets = [{weight: 1, minimumSeconds: 1, maximumSeconds: 1}];
	const {session, listenerId} = manager.create('ambience', 'Quiet autumn park');
	await manager.play(session.id, listenerId);
	await manager.sweep();
	advance(1100);
	await manager.sweep();
	expect(manager.debug(session.id).planning.busy).toBe(true);
	await manager.pause(session.id, listenerId);
	expect(cancelled).toBe(true);
	const remaining = manager.debug(session.id).nextEventOpportunitySeconds;
	advance(3_600_000);
	await manager.sweep();
	expect(manager.debug(session.id).nextEventOpportunitySeconds).toBe(remaining);
	expect(manager.debug(session.id).scheduledEvents).toEqual([]);
});

it('shares one producer, pauses per listener, freezes time, and rejects stale revival after an explicit pause', async () => {
	const {manager, factory, advance} = await setup();
	const first = manager.create();
	const second = manager.join(first.session.id);
	await manager.play(first.session.id, first.listenerId);
	await manager.play(first.session.id, first.listenerId);
	await manager.play(first.session.id, second.listenerId);
	expect(factory).toHaveBeenCalledTimes(2);
	advance(20_000);
	expect(await manager.pause(first.session.id, first.listenerId)).toMatchObject({status: 'active', listenerCount: 1, rendering: true});
	expect(await manager.pause(first.session.id, second.listenerId)).toMatchObject({status: 'idle', rendering: false});
	const elapsed = manager.get(first.session.id).activeElapsedMs;
	const runId = manager.debug(first.session.id).currentRun!;
	advance(120_000);
	await manager.playlist(first.session.id, first.listenerId);
	await manager.segment(first.session.id, first.listenerId, {runId, name: 'segment-000000001.ts'});
	expect(manager.get(first.session.id)).toMatchObject({activeElapsedMs: elapsed, status: 'idle'});
	expect(factory).toHaveBeenCalledTimes(2);
	await manager.play(first.session.id, first.listenerId);
	expect(factory).toHaveBeenCalledTimes(3);
});

it('idles after stream loss despite status/playlist polling and resumes an expired listener from HLS', async () => {
	const {manager, advance} = await setup();
	const {session, listenerId} = manager.create();
	await manager.play(session.id, listenerId);
	advance(89_000);
	manager.get(session.id);
	await manager.playlist(session.id, listenerId);
	const runId = manager.debug(session.id).currentRun!;
	await manager.segment(session.id, listenerId, {runId, name: 'segment-000000001.ts', consumption: false});
	advance(1000);
	await manager.sweep();
	expect(manager.get(session.id)).toMatchObject({status: 'idle', rendering: false});
	await manager.playlist(session.id, listenerId, false);
	expect(manager.get(session.id).status).toBe('idle');
	await manager.playlist(session.id, listenerId);
	expect(manager.get(session.id)).toMatchObject({status: 'active', rendering: true});
});

it('expires and freezes playback despite repeated recorder debug requests', async () => {
	const {manager, config, advance} = await setup();
	const app = await buildApp({config, sessions: manager});
	const {session, listenerId} = manager.create();
	try {
		await manager.play(session.id, listenerId);
		for (let index = 0; index < 4; index++) {
			advance(30_000);
			// eslint-disable-next-line no-await-in-loop -- Simulate serial sampling across watchdog expiry.
			const responses = await Promise.all([app.inject(`/api/debug/sessions/${session.id}`), app.inject('/api/debug/monitoring')]);
			expect(responses.map(response => response.statusCode)).toEqual([200, 200]);
			expect(responses[1].headers['cache-control']).toBe('no-store');
			// eslint-disable-next-line no-await-in-loop -- Advance the watchdog between samples.
			await manager.sweep();
		}

		expect(manager.debug(session.id)).toMatchObject({
			status: 'idle', rendering: false, producerPid: null, listenerCount: 0,
		});
		const elapsed = manager.get(session.id).activeElapsedMs;
		advance(60_000);
		await app.inject(`/api/debug/sessions/${session.id}`);
		expect(manager.get(session.id).activeElapsedMs).toBe(elapsed);
	} finally {
		await app.close();
	}
});

it('only successful current-run segment consumption extends listener demand', async () => {
	const {manager, advance} = await setup();
	const {session, listenerId} = manager.create();
	await manager.playlist(session.id, listenerId);
	const oldRun = manager.debug(session.id).currentRun!;
	await manager.play(session.id, listenerId);
	const runId = manager.debug(session.id).currentRun!;
	advance(80_000);
	await manager.segment(session.id, listenerId, {runId, name: 'segment-000000001.ts'});
	advance(80_000);
	await manager.segment(session.id, listenerId, {runId: oldRun, name: 'segment-000000001.ts'});
	await expect(manager.segment(session.id, listenerId, {runId, name: 'segment-999.ts'})).rejects.toMatchObject({statusCode: 404});
	await manager.sweep();
	expect(manager.get(session.id).status).toBe('active');
	advance(10_000);
	await manager.sweep();
	expect(manager.get(session.id)).toMatchObject({status: 'idle', rendering: false});
});

it('serializes racing controls and removes owned audio on stop', async () => {
	const {manager, config, renderers} = await setup();
	const {session, listenerId} = manager.create();
	await Promise.all([manager.play(session.id, listenerId), manager.pause(session.id, listenerId), manager.stop(session.id)]);
	expect(manager.get(session.id)).toMatchObject({status: 'stopped', ready: false, rendering: false});
	expect(renderers.every(renderer => !renderer.running)).toBe(true);
	await expect(readFile(path.join(config.dataDirectory, 'sessions', session.id))).rejects.toMatchObject({code: 'ENOENT'});
	await expect(manager.play(session.id, listenerId)).rejects.toMatchObject({statusCode: 410});
	await expect(manager.playlist(session.id, listenerId)).rejects.toMatchObject({statusCode: 410});
	expect(await manager.stop(session.id)).toMatchObject({status: 'stopped'});
});

it('limits retained runs across repeated resumes and releases every renderer on shutdown', async () => {
	const {manager, config, renderers} = await setup();
	const {session, listenerId} = manager.create();
	await manager.play(session.id, listenerId);
	await manager.pause(session.id, listenerId);
	await manager.play(session.id, listenerId);
	await manager.pause(session.id, listenerId);
	await manager.play(session.id, listenerId);
	expect(await readdir(path.join(config.dataDirectory, 'sessions', session.id, 'hls'))).toHaveLength(2);
	await manager.close();
	expect(renderers.every(renderer => !renderer.running)).toBe(true);
	expect(() => manager.create()).toThrow('shutting down');
});

it('contains renderer startup failures and requires a new session after an error', async () => {
	const {manager, factory} = await setup();
	factory.mockRejectedValueOnce(new Error('FFmpeg is missing'));
	const {session, listenerId} = manager.create();
	await expect(manager.playlist(session.id, listenerId)).rejects.toMatchObject({statusCode: 503});
	expect(manager.get(session.id)).toMatchObject({status: 'error', rendering: false});
	await expect(manager.play(session.id, listenerId)).rejects.toMatchObject({statusCode: 503});
	await manager.stop(session.id);
});

it('contains a renderer crash after playback starts', async () => {
	const {manager, factory} = await setup();
	const {session, listenerId} = manager.create();
	await manager.play(session.id, listenerId);
	factory.mock.calls.at(-1)![0].onFailure(new Error('encoder crashed'));
	await expect(manager.playlist(session.id, listenerId)).rejects.toMatchObject({statusCode: 503});
	expect(manager.get(session.id)).toMatchObject({status: 'error', rendering: false, listenerCount: 0});
});

it('validates HTTP contracts and IDs, serves uncached HLS, and rejects traversal and unknown listeners', async () => {
	const {manager, config} = await setup();
	const app = await buildApp({config, sessions: manager});
	try {
		await expect(app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'fixture', path: '/etc/passwd'}})).resolves.toMatchObject({statusCode: 400});
		const creation = await app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'fixture'}});
		expect(creation.statusCode).toBe(202);
		const {session, listenerId, streamUrl} = listenerSessionSchema.parse(creation.json());
		const playlist = await app.inject(streamUrl);
		expect(playlist.statusCode).toBe(200);
		expect(playlist.headers['cache-control']).toBe('no-store');
		expect(playlist.headers['content-type']).toContain('application/vnd.apple.mpegurl');
		const segmentUrl = playlist.body.split('\n').find(line => line.startsWith('/api/'))!;
		const segment = await app.inject(segmentUrl);
		expect(segment.statusCode).toBe(200);
		expect(segment.headers['content-type']).toBe('video/mp2t');
		expect(segment.body).toBe('audio');
		await expect(app.inject(segmentUrl.replace('segment-000000001.ts', '%2e%2e%2ffixture.wav'))).resolves.toMatchObject({statusCode: 400});
		await expect(app.inject(streamUrl.replace(listenerId, randomUUID()))).resolves.toMatchObject({statusCode: 404});
		await expect(app.inject(`/api/sessions/${session.id}/stream.m3u8`)).resolves.toMatchObject({statusCode: 400});
		await expect(app.inject({method: 'POST', url: `/api/sessions/${session.id}/play`, payload: {listenerId: 'invalid'}})).resolves.toMatchObject({statusCode: 400});
	} finally {
		await app.close();
	}
});

it('recovers session identity, listener controls, elapsed time, and HLS after normal restart', async () => {
	const {manager, config, factory, advance, now} = await setup();
	const {session, listenerId} = manager.create();
	await manager.play(session.id, listenerId);
	advance(25_000);
	await manager.close();
	advance(3_600_000);
	const restored = new SessionManager({
		config, store: new Store(path.join(config.dataDirectory, 'test.sqlite')), rendererFactory: factory, now, automaticWatchdog: false,
	});
	try {
		await restored.initialize();
		expect(restored.get(session.id)).toMatchObject({
			status: 'idle', ready: true, activeElapsedMs: 25_000, rendering: false,
		});
		expect(restored.debug(session.id).listeners[0]?.state).toBe('expired');
		await restored.play(session.id, listenerId);
		advance(10_000);
		expect(restored.get(session.id).activeElapsedMs).toBe(35_000);
		await restored.pause(session.id, listenerId);
		advance(10_000);
		expect(restored.get(session.id).activeElapsedMs).toBe(35_000);
	} finally {
		await restored.close();
	}
});

it('expires other listeners while a scene parser is still pending', async () => {
	const planner: Planner = {
		busy: true,
		parseScene: async () => new Promise(() => {/* Cancelled by shutdown; must not block the watchdog. */}),
		propose: async () => new Promise(() => {/* No active planning session in this test. */}),
	};
	const {manager, advance} = await setup(planner);
	const preparing = manager.create('ambience', 'A quiet park');
	const playing = manager.create('fixture');
	await manager.play(playing.session.id, playing.listenerId);
	advance(90_001);
	await manager.sweep();
	expect(manager.get(playing.session.id)).toMatchObject({status: 'idle', rendering: false});
	expect(manager.get(preparing.session.id).status).toBe('initializing');
}, 3000);

it('cleans crash leftovers only in owned UUID session folders and rebuilds missing playlists', async () => {
	const {manager, config, factory, now} = await setup();
	const {session, listenerId} = manager.create();
	await manager.playlist(session.id, listenerId);
	await manager.close();
	const root = path.join(config.dataDirectory, 'sessions');
	const orphan = path.join(root, randomUUID());
	const unrelated = path.join(root, 'keep-me');
	await mkdir(orphan, {recursive: true});
	await mkdir(unrelated);
	await rm(path.join(root, session.id, 'hls'), {recursive: true});
	const restored = new SessionManager({
		config, store: new Store(path.join(config.dataDirectory, 'test.sqlite')), rendererFactory: factory, now, automaticWatchdog: false,
	});
	try {
		await restored.initialize();
		await restored.playlist(session.id, listenerId);
		expect(restored.get(session.id)).toMatchObject({ready: true, status: 'idle'});
		expect(await readdir(root)).toContain('keep-me');
		expect(await readdir(root)).not.toContain(path.basename(orphan));
	} finally {
		await restored.close();
	}
});
