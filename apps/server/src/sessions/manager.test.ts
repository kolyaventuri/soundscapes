import {randomUUID} from 'node:crypto';
import {
	mkdtemp, mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
	listenerSessionSchema, sceneSchema, sessionListSchema, layerPlanSchema, sceneLibrarySchema,
} from '@soundscapes/shared';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {buildApp} from '../app.js';
import {type Renderer, type RendererOptions} from '../audio/hls.js';
import {readConfig} from '../config.js';
import {Store, assetSchema} from '../persistence/store.js';
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
			setVolume: vi.fn(async () => undefined),
		};
		renderers.push(renderer);
		return renderer;
	});
	const store = new Store(path.join(directory, 'test.sqlite'));
	const manager = new SessionManager({
		config, store, rendererFactory: factory, now: () => now, automaticWatchdog: false,
		...(planner ? {planner} : {}),
	});
	cleanup.push(async () => {
		await manager.close();
		await rm(directory, {recursive: true, force: true});
	});
	return {
		manager, config, store, factory, renderers, now: () => now, advance(ms: number) {
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

it('withholds stopped-run audio when a native playlist request arrives before Play', async () => {
	const {manager, factory} = await setup();
	const {session, listenerId} = manager.create();
	const beforePlay = await manager.playlist(session.id, listenerId);
	expect(beforePlay).toContain('#EXT-X-TARGETDURATION:6');
	expect(beforePlay).not.toContain('#EXTINF');
	expect(beforePlay).not.toContain('#EXT-X-ENDLIST');
	const preparedRun = manager.debug(session.id).currentRun;
	expect(manager.get(session.id)).toMatchObject({status: 'idle', rendering: false, listenerCount: 0});
	expect(factory).toHaveBeenCalledTimes(1);
	await manager.play(session.id, listenerId);
	const live = await manager.playlist(session.id, listenerId);
	expect(live).toContain(manager.debug(session.id).currentRun);
	expect(live).not.toContain(preparedRun);
	await manager.pause(session.id, listenerId);
	expect(await manager.playlist(session.id, listenerId)).not.toContain('#EXTINF');
	expect(factory).toHaveBeenCalledTimes(2);
	expect(manager.get(session.id)).toMatchObject({status: 'idle', rendering: false, listenerCount: 0});
});

it('lists orphaned and failed sessions, frees capacity after closing, and never renews demand', async () => {
	const planner: Planner = {
		busy: false, parseScene: vi.fn(async () => {
			throw new Error('Planning failed');
		}), propose: vi.fn(),
	};
	const {manager, config, advance, factory} = await setup(planner);
	const failed = manager.create('ambience', 'An unavailable scene');
	await vi.waitFor(() => {
		expect(manager.get(failed.session.id).status).toBe('error');
	});
	const owners = Array.from({length: 3}, () => manager.create());
	await Promise.all(owners.map(async owner => manager.play(owner.session.id, owner.listenerId)));
	await manager.pause(owners[0]!.session.id, owners[0]!.listenerId);
	const app = await buildApp({config, sessions: manager});
	try {
		advance(89_000);
		const response = await app.inject('/api/sessions');
		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toBe('no-store');
		const listing = sessionListSchema.parse(response.json());
		expect(listing.limit).toBe(4);
		expect(listing.sessions).toHaveLength(4);
		expect(listing.sessions.find(session => session.id === failed.session.id)?.status).toBe('error');
		expect(response.body).not.toContain('listenerId');
		expect(response.body).not.toContain('streamUrl');
		const calls = factory.mock.calls.length;
		advance(1001);
		await manager.sweep();
		expect(manager.list().sessions.filter(session => session.status === 'idle')).toHaveLength(3);
		expect(factory).toHaveBeenCalledTimes(calls);
		const blocked = await app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'fixture'}});
		expect(blocked.statusCode).toBe(409);
		const closed = await app.inject({method: 'POST', url: `/api/sessions/${failed.session.id}/stop`});
		expect(closed.statusCode).toBe(200);
		expect(manager.list().sessions.some(session => session.id === failed.session.id)).toBe(false);
		const created = await app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'fixture'}});
		expect(created.statusCode).toBe(202);
		await Promise.all(manager.list().sessions.map(async session => {
			const result = await app.inject({method: 'POST', url: `/api/sessions/${session.id}/stop`});
			expect(result.statusCode).toBe(200);
		}));
		const empty = await app.inject('/api/sessions');
		expect(empty.json()).toEqual({sessions: [], limit: 4});
	} finally {
		await app.close();
	}
});

it('persists level changes without restarting a producer or renewing listener activity', async () => {
	const {manager, factory, renderers, advance, store} = await setup();
	const {session, listenerId} = manager.create();
	await manager.play(session.id, listenerId);
	advance(89_000);
	expect(await manager.setVolume(session.id, listenerId, 50)).toMatchObject({volumePercent: 50, status: 'active'});
	expect(renderers.at(-1)!.setVolume).toHaveBeenCalledWith(50);
	expect(factory).toHaveBeenCalledTimes(2);
	advance(1001);
	await manager.sweep();
	expect(manager.get(session.id)).toMatchObject({status: 'idle', listenerCount: 0, volumePercent: 50});
	await manager.setVolume(session.id, listenerId, 75);
	expect(factory).toHaveBeenCalledTimes(2);
	expect(store.loadSessions()[0]).toMatchObject({volumePercent: 75});
	await expect(manager.setVolume(session.id, listenerId, 151)).rejects.toThrow();
	await expect(manager.setVolume(session.id, randomUUID(), 20)).rejects.toThrow('Listener not found');
	await manager.play(session.id, listenerId);
	expect(factory.mock.calls.at(-1)![0]).toMatchObject({volumePercent: 75});
});

it('passes the explicit sleep-mode selection to scene parsing and preserves it across saved state', async () => {
	const parseScene = vi.fn<Planner['parseScene']>(async (originalPrompt, signal, sleepMode) => sceneSchema.parse({
		originalPrompt, title: 'Café', sleepMode: sleepMode ?? false, simulatedStart: '2000-01-01T01:00:00Z',
	}));
	const {manager, store} = await setup({busy: false, parseScene, propose: vi.fn()});
	const {session, listenerId} = manager.create('ambience', 'A café with jazz', true);
	await manager.playlist(session.id, listenerId);
	expect(parseScene).toHaveBeenCalledWith('A café with jazz', expect.any(AbortSignal), true);
	expect(manager.get(session.id).scene?.sleepMode).toBe(true);
	expect(store.loadSessions()[0]).toMatchObject({requestedSleepMode: true});
});

it('reports missing assets through a bounded read-only debug API without counting usage', async () => {
	const {manager, config, store} = await setup();
	const asset = assetSchema.parse({
		id: randomUUID(), kind: 'event', title: 'Breeze', file: 'assets/events/missing.wav',
		durationMs: 8000, sampleRate: 44_100, channels: 2, peakDb: -25, meanDb: -40, source: 'Test',
		event: {category: 'wind', tags: ['wind'], reviewedSleepSafe: true},
	});
	store.putAsset(asset);
	const app = await buildApp({config, sessions: manager});
	try {
		const response = await app.inject('/api/debug/assets?limit=10');
		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toBe('no-store');
		expect(response.json()).toMatchObject({total: 1, assets: [{id: asset.id, available: false, usageCount: 0}]});
		const invalid = await app.inject('/api/debug/assets?limit=1000');
		expect(invalid.statusCode).toBe(400);
		expect(store.assets()[0]!.usageCount).toBe(0);
	} finally {
		await app.close();
	}
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

it('reports layer validation failures as planning errors rather than broken sound setup', async () => {
	const planner: Planner = {
		busy: false,
		async parseScene(originalPrompt) {
			return sceneSchema.parse({
				title: 'Layer test', originalPrompt, sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
			});
		},
		async planLayers() {
			return layerPlanSchema.parse({});
		},
		propose: vi.fn(),
	};
	const {manager, config, factory} = await setup(planner);
	config.sound.enabled = true;
	const {session} = manager.create('ambience', 'Distant rain, wind and leaves', false, 'layered');
	await vi.waitFor(() => {
		expect(manager.get(session.id).status).toBe('error');
	});
	expect(manager.get(session.id).error).toContain('scene planner');
	expect(manager.get(session.id).error).not.toMatch(/sound:setup|sound:smoke|Zod|too_big/);
	expect(factory).not.toHaveBeenCalled();
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
			const responses = await Promise.all([app.inject(`/api/debug/sessions/${session.id}`), app.inject('/api/debug/monitoring'), app.inject('/api/recordings')]);
			expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200]);
			expect(responses[2].headers['cache-control']).toBe('no-store');
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
		await manager.play(session.id, listenerId);
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

it('rejects malformed HTTP bodies and pagination without starting work or changing listener demand', async () => {
	const {manager, config, store, factory, advance} = await setup();
	const app = await buildApp({config, sessions: manager});
	try {
		const invalidCreations = [
			{mode: 'shell'},
			{mode: 'ambience', prompt: ''},
			{mode: 'ambience', prompt: 'x'.repeat(4001)},
			{mode: 'ambience', sleepMode: 'true'},
			{mode: 'fixture', seed: 123},
		];
		const rejected = await Promise.all(invalidCreations.map(async payload => app.inject({method: 'POST', url: '/api/sessions', payload})));
		expect(rejected.map(response => response.statusCode)).toEqual(invalidCreations.map(() => 400));
		const oversized = await app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'ambience', prompt: 'x'.repeat(17_000)}});
		expect(oversized.statusCode).toBe(413);
		expect(store.loadSessions()).toHaveLength(0);
		expect(factory).not.toHaveBeenCalled();
		const {session, listenerId} = manager.create();
		await manager.play(session.id, listenerId);
		advance(89_000);
		const levels = await Promise.all([-1, 151, 1.5, '50', null].map(async volumePercent => app.inject({
			method: 'POST', url: `/api/sessions/${session.id}/level`, payload: {listenerId, volumePercent},
		})));
		expect(levels.map(response => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
		const queries = await Promise.all(['limit=1000', 'offset=-1', 'offset=100000000', 'file=../../.env'].map(async query => app.inject(`/api/debug/assets?${query}`)));
		expect(queries.map(response => response.statusCode)).toEqual([400, 400, 400, 400]);
		const extra = await app.inject({method: 'POST', url: `/api/sessions/${session.id}/level`, payload: {listenerId, volumePercent: 50, command: 'quit'}});
		expect(extra.statusCode).toBe(400);
		advance(1001);
		await manager.sweep();
		expect(manager.get(session.id)).toMatchObject({volumePercent: 100, status: 'idle'});
		expect(manager.debug(session.id).listeners[0]?.state).toBe('expired');
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

it('archives ready scenes, preserves them after Stop, and keeps library reads passive and bounded', async () => {
	const parseScene = vi.fn(async (originalPrompt: string) => sceneSchema.parse({
		originalPrompt, title: 'Autumn park', sleepMode: true, description: 'Leaves rustle beside a footpath.', simulatedStart: '1932-10-01T01:00:00Z',
	}));
	const {manager, config, advance, factory} = await setup({busy: false, parseScene, propose: vi.fn()});
	const owner = manager.create('ambience', 'A park with rustling leaves');
	expect(manager.listScenes('', 0).total).toBe(0);
	await manager.play(owner.session.id, owner.listenerId);
	const app = await buildApp({config, sessions: manager});
	try {
		advance(89_000);
		const response = await app.inject('/api/scenes?q=leaves');
		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toBe('no-store');
		const listing = sceneLibrarySchema.parse(response.json());
		expect(listing.total).toBe(1);
		expect(listing.scenes[0]).toMatchObject({scene: {sleepMode: true, originalPrompt: 'A park with rustling leaves'}, generationMode: 'simple'});
		for (const privateField of ['listenerId', 'streamUrl', 'producerPid', 'assets/']) {
			expect(response.body).not.toContain(privateField);
		}

		for (const query of ['offset=-1', 'offset=1.2', 'offset=100000000', 'extra=1', `q=${'a'.repeat(201)}`]) {
			// eslint-disable-next-line no-await-in-loop -- Exercise each independent invalid request.
			const invalid = await app.inject(`/api/scenes?${query}`);
			expect(invalid.statusCode).toBe(400);
		}

		const calls = factory.mock.calls.length;
		advance(1001);
		await manager.sweep();
		expect(manager.get(owner.session.id)).toMatchObject({status: 'idle', rendering: false, listenerCount: 0});
		expect(factory).toHaveBeenCalledTimes(calls);
		await manager.stop(owner.session.id);
		const afterStop = await app.inject('/api/scenes');
		expect(sceneLibrarySchema.parse(afterStop.json())).toEqual(listing);
		expect(manager.list().sessions).toEqual([]);
		expect(parseScene).toHaveBeenCalledTimes(1);
	} finally {
		await app.close();
	}
});

it('backfills prepared pre-library sessions on upgrade without starting playback or inference', async () => {
	const parseScene = vi.fn(async (originalPrompt: string) => sceneSchema.parse({
		originalPrompt, title: 'Saved park', sleepMode: false, simulatedStart: '1932-10-01T01:00:00Z',
	}));
	const {manager, config, factory} = await setup({busy: false, parseScene, propose: vi.fn()});
	const owner = manager.create('ambience', 'An existing park scene');
	await manager.playlist(owner.session.id, owner.listenerId);
	await manager.close();
	const file = path.join(config.dataDirectory, 'test.sqlite');
	const database = new DatabaseSync(file);
	database.exec('DROP TABLE saved_scenes; PRAGMA user_version=2;');
	database.close();
	const restored = new SessionManager({
		config, store: new Store(file), rendererFactory: factory, automaticWatchdog: false,
	});
	const calls = factory.mock.calls.length;
	try {
		await restored.initialize();
		expect(restored.listScenes('', 0).scenes[0]).toMatchObject({scene: {title: 'Saved park', originalPrompt: 'An existing park scene'}});
		expect(restored.get(owner.session.id)).toMatchObject({status: 'idle', rendering: false, listenerCount: 0});
		expect(factory).toHaveBeenCalledTimes(calls);
		expect(parseScene).toHaveBeenCalledTimes(1);
	} finally {
		await restored.close();
	}
});
