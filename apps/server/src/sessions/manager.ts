import {randomUUID} from 'node:crypto';
import {
	readFile, readdir, rm, stat,
} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {
	sceneSchema, type ListenerSession, type Session, type SessionStatus,
} from '@soundscapes/shared';
import {
	playlistSegments, segmentNamePattern, startRenderer, type Renderer, type RendererFactory,
} from '../audio/hls.js';
import {playableAssets} from '../assets/fixtures.js';
import {startAmbienceRenderer} from '../ambience/renderer.js';
import {timelineSchema, type TimelineState} from '../ambience/timeline.js';
import {Store, type Asset} from '../persistence/store.js';
import {type AppConfig} from '../config.js';
import {GenerationService, sceneKey} from '../generation/service.js';
import {type SoundGenerator} from '../generation/contracts.js';
import {OllamaPlanner} from '../planning/ollama.js';
import {EventController, abortable, type PlanningState} from '../planning/controller.js';
import {
	planningStateSchema, scheduledEventSchema, type Planner, type ScheduledEvent,
} from '../planning/contracts.js';
import {Preparation} from './preparation.js';

export class SessionError extends Error {
	constructor(public statusCode: number, message: string) {
		super(message);
	}
}

type Listener = {state: 'playing' | 'paused' | 'expired'; lastConsumptionAt: number};
const fixtureScene = sceneSchema.parse({
	title: 'Soft air ambience', description: 'Locally synthesized ambient air; no generated scene or events.', sleepMode: true as const, simulatedStart: '2000-01-01T01:00:00Z',
});

type Record = {
	id: string;
	mode: 'fixture' | 'ambience';
	scene: z.infer<typeof sceneSchema>;
	timeline: TimelineState;
	assetIds: string[];
	status: SessionStatus;
	createdAt: number;
	activeSince: number | undefined;
	elapsedMs: number;
	error: string | undefined;
	listeners: Map<string, Listener>;
	renderer: Renderer | undefined;
	runs: Map<string, string>;
	currentRun: string | undefined;
	pending: Promise<void>;
	planningEnabled: boolean;
	generationEnabled: boolean;
	preparation: string;
	progress: Preparation | undefined;
	sceneReady: boolean;
	planning: PlanningState;
	scheduledEvents: ScheduledEvent[];
	eventAssets: Asset[];
	controller: EventController | undefined;
	initialization: AbortController | undefined;
};

const savedSchema = z.object({
	id: z.uuid(), mode: z.enum(['fixture', 'ambience']), status: z.enum(['initializing', 'active', 'idle', 'stopped', 'error']),
	createdAt: z.number(), elapsedMs: z.number().nonnegative(), error: z.string().optional(),
	scene: sceneSchema.default(fixtureScene), timeline: timelineSchema, assetIds: z.array(z.uuid()).max(16),
	listeners: z.array(z.tuple([z.uuid(), z.object({state: z.enum(['playing', 'paused', 'expired']), lastConsumptionAt: z.number()})])).max(16),
	runs: z.array(z.uuid()).max(2), currentRun: z.uuid().optional(),
	generationEnabled: z.boolean().default(false), preparation: z.string().default(''),
	planningEnabled: z.boolean().default(false), sceneReady: z.boolean().default(true),
	planning: planningStateSchema.default({nextOpportunityMs: null, opportunities: 0, skipped: 0}),
	scheduledEvents: z.array(scheduledEventSchema).max(32).default([]),
});

type Options = {
	config: AppConfig;
	store?: Store;
	rendererFactory?: RendererFactory;
	now?: () => number;
	automaticWatchdog?: boolean;
	onEvent?: (event: string, sessionId: string, detail?: string) => void;
	planner?: Planner;
	soundGenerator?: SoundGenerator;
};

async function settled(promise: Promise<unknown>) {
	try {
		await promise;
	} catch {
		// The caller receives the error; later commands must still run.
	}
}

export class SessionManager {
	private readonly records = new Map<string, Record>();
	private readonly config: AppConfig;
	private readonly store: Store;
	private readonly customRenderer: boolean;
	private readonly factory: RendererFactory;
	private readonly now: () => number;
	private readonly onEvent: NonNullable<Options['onEvent']>;
	private readonly timer: ReturnType<typeof setInterval> | undefined;
	private readonly planner: Planner;
	private readonly generation: GenerationService;
	private closing = false;
	private sweeping = false;

	constructor({
		config, store = new Store(), rendererFactory = startRenderer, now = () => performance.timeOrigin + performance.now(), automaticWatchdog = true,
		onEvent = () => undefined, planner, soundGenerator,
	}: Options) {
		this.config = config;
		this.store = store;
		this.customRenderer = rendererFactory !== startRenderer;
		this.factory = rendererFactory;
		this.now = now;
		this.onEvent = onEvent;
		this.planner = planner ?? new OllamaPlanner(config.planner);
		this.generation = new GenerationService(config, store, soundGenerator);
		if (automaticWatchdog) {
			this.timer = setInterval(() => {
				void this.watchdog();
			}, 1000);
			this.timer.unref();
		}
	}

	async initialize() {
		await this.generation.initialize();
		for (const value of this.store.loadSessions()) {
			const saved = savedSchema.parse(value);
			const session: Record = {
				...saved, status: saved.status === 'stopped' || saved.status === 'error' ? saved.status : 'idle',
				eventAssets: [], controller: undefined, initialization: undefined, progress: undefined,
				error: saved.error, activeSince: undefined, renderer: undefined, pending: Promise.resolve(), currentRun: saved.currentRun,
				listeners: new Map(saved.listeners.map(([id, listener]) => [id, {...listener, state: listener.state === 'playing' ? 'expired' : listener.state}])),
				runs: new Map(saved.runs.map(id => [id, path.join(this.directory(saved.id), 'hls', id)])),
			};
			this.records.set(saved.id, session);
		}

		await this.recoverFiles();
		for (const session of this.records.values()) {
			this.save(session);
			if (session.status === 'idle' && !session.currentRun && !session.generationEnabled) {
				void this.prepare(session);
			}
		}
	}

	create(mode: 'fixture' | 'ambience' = 'fixture', prompt?: string): ListenerSession {
		if (prompt && mode !== 'ambience') {
			throw new SessionError(400, 'Scene prompts require ambience mode');
		}

		if (this.closing) {
			throw new SessionError(503, 'Server is shutting down');
		}

		for (const [id, session] of this.records) {
			if (session.status === 'stopped') {
				this.records.delete(id);
				this.store.deleteSession(id);
			}
		}

		if (this.records.size >= 4) {
			throw new SessionError(409, 'Stop an existing session before creating another (maximum four).');
		}

		const session: Record = {
			id: randomUUID(), mode, scene: {...fixtureScene, title: prompt ? 'Preparing your scene' : fixtureScene.title, originalPrompt: prompt ?? ''},
			timeline: {seed: Math.floor(Math.random() * 0x1_00_00_00_00), beds: []}, assetIds: [],
			generationEnabled: Boolean(prompt) && this.config.sound.enabled, preparation: '', progress: undefined,
			planningEnabled: Boolean(prompt), sceneReady: !prompt, planning: {nextOpportunityMs: null, opportunities: 0, skipped: 0}, scheduledEvents: [],
			eventAssets: [], controller: undefined, initialization: prompt ? new AbortController() : undefined,
			status: 'initializing', createdAt: this.now(), activeSince: undefined,
			elapsedMs: 0, error: undefined, listeners: new Map(), renderer: undefined,
			runs: new Map(), currentRun: undefined, pending: Promise.resolve(),
		};
		this.records.set(session.id, session);
		const result = this.join(session.id);
		void this.prepare(session);
		return result;
	}

	join(id: string): ListenerSession {
		const session = this.record(id);
		this.requireUsable(session);
		if (session.listeners.size >= 16) {
			throw new SessionError(409, 'This session has reached its listener limit.');
		}

		const listenerId = randomUUID();
		session.listeners.set(listenerId, {state: 'paused', lastConsumptionAt: this.now()});
		this.save(session);
		return {
			session: this.view(session), listenerId,
			streamUrl: `/api/sessions/${id}/stream.m3u8?listenerId=${listenerId}`,
		};
	}

	get(id: string) {
		return this.view(this.record(id));
	}

	resumePreparation(id: string, listenerId: string) {
		const session = this.record(id);
		this.requireUsable(session);
		this.listener(session, listenerId);
		if (session.status === 'idle' && !session.currentRun) {
			this.transition(session, 'initializing');
			void this.prepare(session);
		}

		return this.view(session);
	}

	async play(id: string, listenerId: string) {
		const session = this.record(id);
		return this.enqueue(session, async () => {
			this.requireUsable(session);
			const listener = this.listener(session, listenerId);
			if (listener.state !== 'playing') {
				listener.state = 'playing';
				listener.lastConsumptionAt = this.now();
			}

			try {
				if (!session.renderer?.running) {
					await this.start(session);
				}

				this.transition(session, 'active');
			} catch (error) {
				if (this.closing || (error instanceof Error && error.name === 'AbortError')) {
					listener.state = 'paused';
					this.transition(session, 'idle');
					return this.view(session);
				}

				await this.fail(session, error);
				throw new SessionError(503, session.error!);
			}

			this.save(session);
			return this.view(session);
		});
	}

	async pause(id: string, listenerId: string) {
		const session = this.record(id);
		this.listener(session, listenerId);
		if (this.listenerCount(session) <= 1) {
			session.initialization?.abort();
			session.controller?.cancel();
		}

		return this.enqueue(session, async () => {
			this.listener(session, listenerId).state = 'paused';
			if (session.status !== 'stopped' && session.status !== 'error' && this.listenerCount(session) === 0) {
				await session.renderer?.stop();
				this.transition(session, 'idle');
			}

			this.save(session);
			return this.view(session);
		});
	}

	async stop(id: string) {
		const session = this.record(id);
		session.initialization?.abort();
		session.controller?.cancel();
		return this.enqueue(session, async () => {
			await session.renderer?.stop();
			for (const listener of session.listeners.values()) {
				listener.state = 'paused';
			}

			this.transition(session, 'stopped');
			session.currentRun = undefined;
			session.runs.clear();
			await rm(this.directory(id), {recursive: true, force: true});
			this.save(session);
			return this.view(session);
		});
	}

	async playlist(id: string, listenerId: string, consumption = true) {
		const session = this.record(id);
		this.requireUsable(session);
		const listener = this.listener(session, listenerId);
		// A timed-out listener may reconnect without foreground JavaScript. Explicit
		// pauses stay paused, even when Safari prefetches or polls an old playlist.
		if (consumption && listener.state === 'expired') {
			await this.play(id, listenerId);
		}

		await session.pending;
		this.requireUsable(session);
		const runId = session.currentRun;
		const directory = runId ? session.runs.get(runId) : undefined;
		if (!directory || !runId) {
			throw new SessionError(503, 'Audio is still preparing');
		}

		const manifest = await readFile(path.join(directory, 'stream.m3u8'), 'utf8');
		return manifest.split('\n').map(line => playlistSegments(line).length > 0
			? `/api/sessions/${id}/hls/${runId}/${line}?listenerId=${listenerId}`
			: line).join('\n');
	}

	async segment(id: string, listenerId: string, {runId, name, consumption = true}: {runId: string; name: string; consumption?: boolean}) {
		if (!segmentNamePattern.test(name)) {
			throw new SessionError(400, 'Invalid segment name');
		}

		const session = this.record(id);
		this.requireUsable(session);
		const listener = this.listener(session, listenerId);
		const directory = session.runs.get(runId);
		if (!directory) {
			throw new SessionError(404, 'Segment is no longer available');
		}

		const file = path.join(directory, name);
		try {
			const metadata = await stat(file);
			if (metadata.size > 2 * 1024 * 1024) {
				throw new SessionError(500, 'Unexpected segment size');
			}

			const bytes = await readFile(file);
			if (consumption && listener.state === 'playing' && runId === session.currentRun) {
				listener.lastConsumptionAt = this.now();
			}

			return bytes;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new SessionError(404, 'Segment is no longer available');
			}

			throw error;
		}
	}

	debug(id: string) {
		const session = this.record(id);
		const listeners = [...session.listeners.values()];
		const playbackCursorMs = this.elapsed(session);
		const buffer = session.renderer?.diagnostics?.();
		return {
			playbackCursorMs, playbackCursorSource: 'server active-time estimate',
			renderedUntilMs: buffer?.renderedUntilMs ?? playbackCursorMs, committedUntilMs: buffer?.committedUntilMs ?? playbackCursorMs,
			bufferAheadSeconds: session.renderer?.running && buffer ? Math.max(0, buffer.renderedUntilMs - playbackCursorMs) / 1000 : 0,
			bufferLimitsSeconds: {minimum: 45, target: 90, maximum: 180},
			queuedPcmChunks: session.renderer?.running ? buffer?.queuedChunks ?? 0 : 0,
			activeAmbience: session.timeline.beds.filter(bed => bed.startMs <= playbackCursorMs && bed.startMs + bed.durationMs > playbackCursorMs).map(bed => bed.assetId),
			ambiencePoolSize: session.assetIds.length, degradedSingleBed: session.mode === 'ambience' && session.assetIds.length === 1,
			scheduledBeds: session.timeline.beds, scheduledEvents: session.scheduledEvents,
			generationQueue: this.generation.queue.jobs.filter(job => job.sessionId === session.id),
			soundWorker: this.generation.generator.diagnostics(),
			...this.planningDebug(session, playbackCursorMs),
			...this.view(session), scene: session.scene, producerPid: session.renderer?.running ? session.renderer.pid : null,
			currentRun: session.currentRun ?? null,
			idleTimeoutSeconds: this.config.idleTimeoutMs / 1000,
			listeners: listeners.map(listener => ({
				state: listener.state, lastConsumptionAgoSeconds: (this.now() - listener.lastConsumptionAt) / 1000,
			})),
		};
	}

	async sweep() {
		if (this.sweeping || this.closing) {
			return;
		}

		this.sweeping = true;
		try {
			for (const session of this.records.values()) {
				if (this.closing) {
					break;
				}

				// Initial scene inference must not delay watchdogs for other sessions.
				if (session.status !== 'active') {
					continue;
				}

				// Serialize resource transitions rather than accumulating watchdog jobs.
				// eslint-disable-next-line no-await-in-loop
				await this.enqueue(session, async () => {
					if (session.status !== 'active') {
						return;
					}

					for (const listener of session.listeners.values()) {
						if (listener.state === 'playing' && this.now() - listener.lastConsumptionAt >= this.config.idleTimeoutMs) {
							listener.state = 'expired';
							this.onEvent('listener-expired', session.id, 'No segment consumption within the idle timeout');
						}
					}

					if (this.listenerCount(session) === 0) {
						await session.renderer?.stop();
						this.transition(session, 'idle');
					}

					this.save(session);
					if (session.status === 'active') {
						session.controller?.tick(this.elapsed(session));
					}
				});
			}
		} finally {
			this.sweeping = false;
		}
	}

	async close() {
		if (this.closing) {
			return;
		}

		this.closing = true;
		clearInterval(this.timer);
		for (const session of this.records.values()) {
			session.initialization?.abort();
			session.controller?.cancel();
		}

		await Promise.all([...this.records.values()].map(async session => this.enqueue(session, async () => {
			await session.renderer?.stop();
			for (const listener of session.listeners.values()) {
				if (listener.state === 'playing') {
					listener.state = 'expired';
				}
			}

			if (session.status !== 'stopped' && session.status !== 'error') {
				this.transition(session, 'idle');
			}

			this.save(session);
		})));
		await Promise.all([...this.records.values()].map(async session => session.controller?.settled()));
		await this.generation.close();
		this.store.close();
	}

	private async watchdog() {
		try {
			await this.sweep();
		} catch (error) {
			this.onEvent('watchdog-error', 'server', String(error));
		}
	}

	private elapsed(session: Record) {
		return session.elapsedMs + (session.activeSince === undefined ? 0 : Math.max(0, this.now() - session.activeSince));
	}

	private save(session: Record) {
		this.store.saveSession(session.id, {
			id: session.id, mode: session.mode, status: session.status, createdAt: session.createdAt,
			elapsedMs: this.elapsed(session), error: session.error, scene: session.scene, timeline: session.timeline, assetIds: session.assetIds,
			generationEnabled: session.generationEnabled, preparation: session.preparation,
			planningEnabled: session.planningEnabled, sceneReady: session.sceneReady, planning: session.planning, scheduledEvents: session.scheduledEvents,
			listeners: [...session.listeners], runs: [...session.runs.keys()].slice(-2), currentRun: session.currentRun,
		});
	}

	private async recoverFiles() {
		const root = path.join(this.config.dataDirectory, 'sessions');
		const folders = await readDirectory(root);
		await Promise.all(folders.filter(id => z.uuid().safeParse(id).success).map(async id => {
			const session = this.records.get(id);
			if (!session || session.status === 'stopped') {
				await rm(this.directory(id), {recursive: true, force: true});
				return;
			}

			await rm(path.join(this.directory(id), 'temp'), {recursive: true, force: true});
			const hls = path.join(this.directory(id), 'hls');
			const runs = await readDirectory(hls);
			await Promise.all(runs.filter(run => z.uuid().safeParse(run).success && !session.runs.has(run)).map(async run => rm(path.join(hls, run), {recursive: true, force: true})));
			if (session.currentRun) {
				try {
					await stat(path.join(hls, session.currentRun, 'stream.m3u8'));
				} catch {
					session.currentRun = undefined;
				}
			}
		}));
		for (const session of this.records.values()) {
			if (!folders.includes(session.id)) {
				session.currentRun = undefined;
				session.runs.clear();
			}
		}
	}

	private record(id: string) {
		const session = this.records.get(id);
		if (!session) {
			throw new SessionError(404, 'Session not found. It may have ended when the server restarted.');
		}

		return session;
	}

	private listener(session: Record, id: string) {
		const listener = session.listeners.get(id);
		if (!listener) {
			throw new SessionError(404, 'Listener not found');
		}

		return listener;
	}

	private requireUsable(session: Record) {
		if (session.status === 'stopped') {
			throw new SessionError(410, 'Session has stopped');
		}

		if (session.status === 'error') {
			throw new SessionError(503, session.error ?? 'Audio renderer failed');
		}
	}

	private listenerCount(session: Record) {
		return [...session.listeners.values()].filter(listener => listener.state === 'playing').length;
	}

	private directory(id: string) {
		return path.join(this.config.dataDirectory, 'sessions', id);
	}

	private view(session: Record): Session {
		return {
			id: session.id, mode: session.mode, title: session.mode === 'fixture' ? 'Quiet pink noise' : session.scene.title, status: session.status,
			audioSource: session.generationEnabled ? 'generated' : 'fixture', preparation: session.preparation,
			progress: session.progress?.view(session.status === 'initializing', this.generation.queue.jobs.some(job => job.sessionId !== session.id)) ?? null,
			scene: session.sceneReady && session.planningEnabled ? session.scene : null,
			ready: session.currentRun !== undefined, rendering: session.renderer?.running ?? false,
			listenerCount: this.listenerCount(session), createdAt: new Date(session.createdAt).toISOString(),
			activeElapsedMs: this.elapsed(session),
			simulatedTime: new Date(Date.parse(session.scene.simulatedStart) + this.elapsed(session)).toISOString(),
			...(session.error ? {error: session.error} : {}),
		};
	}

	private transition(session: Record, status: SessionStatus) {
		if (status !== 'initializing') {
			session.progress?.freeze();
		}

		if (status !== 'active') {
			session.controller?.cancel();
		}

		if (session.status === status) {
			return;
		}

		if (session.activeSince !== undefined) {
			session.elapsedMs += this.now() - session.activeSince;
		}

		session.activeSince = status === 'active' ? this.now() : undefined;
		session.status = status;
		this.onEvent(status, session.id);
		this.save(session);
	}

	private async enqueue<T>(session: Record, action: () => Promise<T>): Promise<T> {
		const previous = session.pending;
		const result = (async () => {
			await previous;
			return action();
		})();
		session.pending = settled(result);
		return result;
	}

	private async prepare(session: Record) {
		await this.enqueue(session, async () => {
			try {
				await this.start(session);
				await session.renderer?.stop();
				this.transition(session, 'idle');
			} catch (error) {
				if (this.closing || (error instanceof Error && error.name === 'AbortError')) {
					this.transition(session, 'idle');
					return;
				}

				await this.fail(session, error);
			}
		});
	}

	private async prepareResources(session: Record) {
		const abort = session.initialization ?? new AbortController();
		session.initialization = abort;
		try {
			abort.signal.throwIfAborted();
			if (!session.sceneReady) {
				session.preparation = 'Understanding your scene';
				session.progress!.begin('scene', `planner:${this.config.planner.model}:scene-v2`, 'understanding');
				const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.config.planner.timeoutMs)]);
				session.scene = await abortable(this.planner.parseScene(session.scene.originalPrompt, signal), signal);
				session.sceneReady = true;
				session.progress!.complete();
				this.save(session);
			}

			if (session.generationEnabled && session.assetIds.length < 4) {
				session.preparation = 'Preparing ambience 0 of 4';
				session.progress!.update('checking');
				await this.generation.beds(session.scene, {
					sessionId: session.id, signal: abort.signal, valid: () => !this.closing && session.status === 'initializing',
				}, assets => {
					session.assetIds = assets.map(asset => asset.id);
					session.preparation = `Preparing ambience ${assets.length} of 4`;
					this.onEvent('ambience-prepared', session.id, `${assets.length}/4`);
					this.save(session);
				}, session.progress);
			}

			abort.signal.throwIfAborted();
			session.preparation = 'Buffering your stream';
		} finally {
			session.initialization = undefined;
		}
	}

	private async start(session: Record) {
		session.progress = new Preparation(this.store, this.now, session.generationEnabled ? 4 : 0);
		session.progress.completedBeds = session.generationEnabled ? session.assetIds.length : 0;
		const bufferProfile = `buffer-v1:${session.mode}:${session.generationEnabled ? 'generated' : 'fixture'}`;
		session.progress.plan([{id: 'buffer', profile: bufferProfile}], !session.generationEnabled || session.assetIds.length >= 4);
		this.transition(session, 'initializing');
		await this.prepareResources(session);
		session.progress.begin('buffer', bufferProfile, 'buffering');
		if (session.mode === 'fixture') {
			const fixture = await stat(this.config.fixturePath);
			if (!fixture.isFile() || fixture.size > 128 * 1024 * 1024) {
				throw new Error('Invalid fixture file');
			}
		}

		const runId = randomUUID();
		const directory = path.join(this.directory(session.id), 'hls', runId);
		const options = {
			directory, runId, fixturePath: this.config.fixturePath, ffmpegPath: this.config.ffmpegPath,
			onFailure: (error: Error) => {
				void this.rendererFailed(session, runId, error);
			},
		};
		const available = session.mode === 'ambience' ? await playableAssets(this.config, this.store) : [];
		const assets = available.filter(asset => session.generationEnabled ? session.assetIds.includes(asset.id) : !asset.generation);
		const eventAssets = session.planningEnabled ? await playableAssets(this.config, this.store, 'event') : [];
		session.eventAssets = eventAssets.filter(asset => asset.event && (!asset.generation || asset.generation.sceneKey === sceneKey(session.scene))).slice(0, 64);
		if (session.mode === 'ambience' && session.assetIds.length === 0) {
			session.assetIds = assets.map(asset => asset.id);
		}

		const renderer = session.mode === 'ambience' && !this.customRenderer
			? await startAmbienceRenderer({
				...options, root: this.config.dataDirectory, temporary: path.join(this.directory(session.id), 'temp', runId),
				assets: assets.filter(asset => session.assetIds.includes(asset.id)), timeline: session.timeline, playbackMs: () => this.elapsed(session),
				events: session.scheduledEvents, eventAssets: session.eventAssets,
				onOptionalFailure: error => {
					this.onEvent('event-mix-error', session.id, String(error).slice(0, 500));
					this.save(session);
				},
				onPlan: selected => {
					const retained = session.scheduledEvents.filter(event => event.startMs + event.durationMs >= this.elapsed(session) - 600_000);
					session.scheduledEvents.splice(0, session.scheduledEvents.length, ...retained);
					for (const asset of selected) {
						this.store.useAsset(asset.id, new Date(this.now()).toISOString());
					}

					this.save(session);
				},
			})
			: await this.factory(options);
		session.renderer = renderer;
		if (session.planningEnabled && !session.controller) {
			session.controller = this.eventController(session);
		}

		session.runs.set(runId, directory);
		await renderer.ready();
		session.progress.complete();
		session.progress.update('ready');
		session.currentRun = runId;
		session.preparation = '';
		while (session.runs.size > 2) {
			const oldest = session.runs.entries().next().value;
			if (!oldest) {
				break;
			}

			session.runs.delete(oldest[0]);
			// eslint-disable-next-line no-await-in-loop -- Retire each run before selecting the next.
			await rm(oldest[1], {recursive: true, force: true});
		}

		this.save(session);
	}

	private async rendererFailed(session: Record, runId: string, error: Error) {
		await this.enqueue(session, async () => {
			if (session.renderer?.runId === runId && session.status !== 'stopped' && session.status !== 'error') {
				await this.fail(session, error);
			}
		});
	}

	private async fail(session: Record, error: unknown) {
		await session.renderer?.stop();
		for (const listener of session.listeners.values()) {
			listener.state = 'paused';
		}

		session.error = session.sceneReady
			? (session.generationEnabled
				? `Scene audio preparation failed. Check pnpm sound:setup and pnpm sound:smoke, then create a new session. ${String(error).slice(0, 300)}`
				: 'Audio could not be prepared. Run pnpm fixture:create or pnpm ambience:create, then pnpm audio:smoke, then create a new session.')
			: `Scene planning failed. Start the local Ollama server, pull ${this.config.planner.model}, and try again. ${String(error).slice(0, 300)}`;
		this.onEvent('renderer-error', session.id, String(error));
		this.transition(session, 'error');
	}

	private planningDebug(session: Record, playbackCursorMs: number) {
		return {
			nextEventOpportunitySeconds: session.planningEnabled && session.planning.nextOpportunityMs !== null ? Math.max(0, session.planning.nextOpportunityMs - playbackCursorMs) / 1000 : null,
			planning: {
				...session.planning, enabled: session.planningEnabled, busy: session.controller?.busy ?? false, model: this.config.planner.model,
			},
			modelState: {plannerRequestActive: this.planner.busy, residency: 'not-polled; requests use keep_alive=0'}, modelsLoaded: {llm: null, sound: this.generation.generator.diagnostics().loaded},
		};
	}

	private eventController(session: Record) {
		return new EventController({
			state: session.planning, planner: this.planner, ...this.config.planner,
			active: () => !this.closing && session.status === 'active',
			assets: () => session.eventAssets,
			...(session.generationEnabled
				? {
					generate: async (proposal, signal, deadlineAt) => {
						const asset = await this.generation.event(session.scene, proposal, {
							sessionId: session.id, signal, deadlineAt, valid: () => !this.closing && session.status === 'active',
						});
						if (!session.eventAssets.some(existing => existing.id === asset.id)) {
							const used = new Set(session.scheduledEvents.map(event => event.assetId));
							while (session.eventAssets.length >= 64) {
								const unused = session.eventAssets.findIndex(existing => !used.has(existing.id));
								if (unused === -1) {
									throw new Error('Event asset catalog is full');
								}

								session.eventAssets.splice(unused, 1);
							}

							session.eventAssets.push(asset);
						}

						return asset;
					},
				}
				: {}),
			context: () => ({
				scene: session.scene, simulatedTime: this.view(session).simulatedTime, elapsedMs: this.elapsed(session),
				ambientState: session.timeline.beds.filter(bed => bed.startMs <= this.elapsed(session) && bed.startMs + bed.durationMs > this.elapsed(session))
					.map(bed => this.store.assets().find(asset => asset.id === bed.assetId)?.title ?? bed.assetId),
				recentEvents: this.store.events(session.id).map(value => scheduledEventSchema.parse(value)),
				library: [], canGenerate: session.generationEnabled, earliestPlaybackMs: session.renderer?.eventStartMs?.() ?? 0,
			}),
			changed: () => {
				this.save(session);
			},
			log: (event, detail) => {
				this.onEvent(event, session.id, detail);
			},
			schedule: async (event, signal, deadlinePlaybackMs) => this.enqueue(session, async () => {
				if (signal.aborted || this.closing || session.status !== 'active' || !session.renderer?.running || !session.renderer.eventStartMs) {
					return undefined;
				}

				const startMs = session.renderer.eventStartMs();
				if (startMs > deadlinePlaybackMs || session.scheduledEvents.length >= 32 || session.scheduledEvents.some(previous => Math.abs(previous.startMs - startMs) < 60_000)) {
					return undefined;
				}

				const scheduled = scheduledEventSchema.parse({...event, startMs, simulatedTime: new Date(Date.parse(session.scene.simulatedStart) + startMs).toISOString()});
				session.scheduledEvents.push(scheduled);
				try {
					this.store.transaction(() => {
						this.store.addEvent(event.id, session.id, startMs, scheduled);
						this.store.useAsset(event.assetId, new Date(this.now()).toISOString());
						this.save(session);
					});
				} catch (error) {
					session.scheduledEvents.pop();
					throw error;
				}

				return scheduled;
			}),
		});
	}
}

async function readDirectory(directory: string): Promise<string[]> {
	try {
		return await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}

		throw error;
	}
}
