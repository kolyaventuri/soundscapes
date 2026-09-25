/* eslint-disable no-await-in-loop -- Exercise sequential recording history and recovery. */
/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP and persistence assertions next to each awaited read. */
import {randomUUID} from 'node:crypto';
import {
	mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {recordingListSchema} from '@soundscapes/shared';
import {readConfig} from '../config.js';
import {Diagnostics} from './diagnostics.js';
import {type Sample} from './sample.js';
import {Recordings, recordingText} from './recordings.js';
import {registerRecordingRoutes} from './routes.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const close of cleanup.splice(0).reverse()) {
		await close();
	}
});

async function setup() {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-recordings-'));
	cleanup.push(async () => rm(directory, {recursive: true, force: true}));
	const id = randomUUID();
	const runId = randomUUID();
	const journal = new Diagnostics();
	const state = {title: 'Test ambience', status: 'active', ready: true};
	let cursor = 0;
	const collect = vi.fn(async (): Promise<Sample> => {
		cursor += 5000;
		return {
			at: new Date().toISOString(), errors: [], runtime: journal.snapshot(readConfig({DATA_DIR: directory})),
			session: {
				id, mode: 'ambience', status: state.status as 'active' | 'idle' | 'stopped', ready: true, rendering: state.status === 'active',
				listenerCount: state.status === 'active' ? 1 : 0, producerPid: state.status === 'active' ? 123 : null,
				currentRun: runId, playbackCursorMs: cursor, renderedUntilMs: cursor + 100_000, committedUntilMs: cursor + 90_000,
				bufferAheadSeconds: 100, queuedPcmChunks: 3, idleTimeoutSeconds: 90, bufferLimitsSeconds: {minimum: 45, target: 90, maximum: 180},
				scheduledBeds: [], listeners: [{state: state.status === 'active' ? 'playing' : 'paused', lastConsumptionAgoSeconds: 0}],
			},
			disk: {
				files: 20, bytes: 1000, hlsFiles: 18, hlsBytes: 900, pcmFiles: 2, pcmBytes: 100, truncated: false,
			},
			processes: [],
		};
	});
	const options = {
		dataDirectory: directory, session: () => state, collect, provenance: async () => ({sourceRevisionAtRecorderStart: 'test'}), onError: vi.fn(),
	};
	const recorder = new Recordings(options);
	await recorder.initialize();
	cleanup.push(async () => recorder.close());
	return {
		recorder, options, state, directory, id, journal,
	};
}

it('completes five minutes automatically without a browser, persists results, and records between-sample inference once', async () => {
	const {recorder, id, directory, journal} = await setup();
	vi.useFakeTimers();
	const started = await recorder.start({sessionId: id, minutes: 5, device: 'Test device'});
	await vi.advanceTimersByTimeAsync(1000);
	journal.record('planner-request-started', id);
	journal.record('sound-generated', id);
	journal.record('sound-cache-reused', id);
	await vi.advanceTimersByTimeAsync(4000);
	await recorder.list();
	for (let sample = 1; sample < 60; sample++) {
		await vi.advanceTimersByTimeAsync(5000);
		await recorder.list();
	}

	const completed = recorder.get(started.id);
	expect(completed).toMatchObject({
		state: 'completed', samples: 61, completeSamples: 61, elapsedSeconds: 300, issues: [], inference: {
			plannerCalls: 1, generatedRecordings: 1, cacheReuses: 1, failures: 0,
		},
	});
	expect(recordingText(completed)).toContain('No issues detected');
	const saved = JSON.parse(await readFile(path.join(directory, 'soaks', `pwa-${started.id}`, 'summary.json'), 'utf8')) as unknown;
	expect(saved).toMatchObject({state: 'completed', completeSamples: 61});
	await vi.advanceTimersByTimeAsync(60_000);
	expect(recorder.get(started.id).samples).toBe(61);
});

it('serializes duplicate starts, rejects competing recordings, preserves idle playback, and restores history', async () => {
	const {recorder, options, state, id} = await setup();
	vi.useFakeTimers();
	const input = {sessionId: id, minutes: 480 as const, device: ''};
	const starts = await Promise.all([recorder.start(input), recorder.start(input)]);
	expect(starts[0].id).toBe(starts[1].id);
	await expect(recorder.start({...input, sessionId: randomUUID()})).rejects.toMatchObject({statusCode: 409});
	state.status = 'idle';
	await vi.advanceTimersByTimeAsync(30_000);
	await recorder.list();
	expect(recorder.get(starts[0].id).issues).toEqual(expect.arrayContaining([expect.objectContaining({code: 'not-active'})]));
	expect(state.status).toBe('idle');
	const stopped = await recorder.stop(starts[0].id);
	expect(stopped.state).toBe('interrupted');
	expect(state.status).toBe('idle');
	await expect(recorder.start(input)).rejects.toMatchObject({statusCode: 409});
	await recorder.close();
	const restored = new Recordings(options);
	await restored.initialize();
	cleanup.push(async () => restored.close());
	expect((await restored.list()).recordings[0]).toMatchObject({id: stopped.id, state: 'interrupted'});
	expect(await restored.stop(stopped.id)).toMatchObject({state: 'interrupted'});
	expect(recordingText(stopped)).toContain('Review required');
});

it('recovers an unclean server exit at the last saved duration instead of counting unobserved time', async () => {
	const {recorder, options, directory, id} = await setup();
	vi.useFakeTimers();
	const started = await recorder.start({sessionId: id, minutes: 480, device: ''});
	await vi.advanceTimersByTimeAsync(30_000);
	await recorder.list();
	const index = await readFile(path.join(directory, 'soaks', 'pwa-index.json'), 'utf8');
	await recorder.close();
	await writeFile(path.join(directory, 'soaks', 'pwa-index.json'), index);
	await vi.advanceTimersByTimeAsync(8 * 3_600_000);
	const recovered = new Recordings(options);
	await recovered.initialize();
	cleanup.push(async () => recovered.close());
	expect(recovered.get(started.id)).toMatchObject({state: 'interrupted', elapsedSeconds: 30, samples: 2});
	expect(recovered.get(started.id).issues.at(-1)?.code).toBe('server-interrupted');
	expect(recordingText(recovered.get(started.id))).not.toContain('No issues detected');
});

it('marks collection failures and stopped sessions without leaving a recording timer alive', async () => {
	const {recorder, options, id, state} = await setup();
	vi.useFakeTimers();
	const first = await recorder.start({sessionId: id, minutes: 5, device: ''});
	options.collect.mockRejectedValueOnce(new Error('Disk failed'));
	await vi.advanceTimersByTimeAsync(5000);
	await recorder.list();
	expect(recorder.get(first.id).state).toBe('failed');
	expect(options.onError).toHaveBeenCalled();
	const second = await recorder.start({sessionId: id, minutes: 5, device: ''});
	state.status = 'stopped';
	await vi.advanceTimersByTimeAsync(5000);
	await recorder.list();
	expect(recorder.get(second.id).state).toBe('interrupted');
	expect(vi.getTimerCount()).toBe(0);
});

it('validates recording API inputs, bounds history, and serves a plain-text summary without touching playback', async () => {
	const {recorder, id, options} = await setup();
	const app = fastify({ajv: {customOptions: {coerceTypes: false, removeAdditional: false}}});
	registerRecordingRoutes(app, recorder);
	cleanup.push(async () => app.close());
	for (const minutes of [1, 10, '5']) {
		const bad = await app.inject({method: 'POST', url: '/api/recordings', payload: {sessionId: id, minutes, device: ''}});
		expect(bad.statusCode).toBe(400);
	}

	for (let run = 0; run < 21; run++) {
		const created = await app.inject({method: 'POST', url: '/api/recordings', payload: {sessionId: id, minutes: 5, device: '<script>not HTML</script>'}});
		expect(created.statusCode).toBe(200);
		const recording = created.json<{id: string}>();
		const stopped = await app.inject({method: 'POST', url: `/api/recordings/${recording.id}/stop`});
		expect(stopped.statusCode).toBe(200);
	}

	const listing = recordingListSchema.parse((await app.inject('/api/recordings')).json());
	expect(listing.recordings).toHaveLength(20);
	const samplesBefore = options.collect.mock.calls.length;
	const summary = await app.inject(`/api/recordings/${listing.recordings[0]!.id}/summary`);
	expect(summary.headers['content-type']).toContain('text/plain');
	expect(summary.headers['content-disposition']).toContain('attachment;');
	expect(summary.body).toContain('Review required');
	expect(options.collect.mock.calls.length).toBe(samplesBefore);
	expect((await app.inject(`/api/recordings/${randomUUID()}/summary`)).statusCode).toBe(404);
	expect((await app.inject('/api/recordings/not-a-uuid/summary')).statusCode).toBe(400);
});
