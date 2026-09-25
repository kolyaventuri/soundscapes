import {randomUUID} from 'node:crypto';
import {
	mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {readConfig} from '../config.js';
import {Diagnostics} from './diagnostics.js';
import {parseProcesses, type Sample} from './sample.js';
import {RotatingLog, sessionDiskUsage} from './storage.js';
import {RunSummary} from './summary.js';

const sessionId = randomUUID();
const runId = randomUUID();
const diagnostics = new Diagnostics();
function sample(seconds: number): Sample {
	return {
		at: new Date(Date.UTC(2026, 8, 23) + (seconds * 1000)).toISOString(), errors: [],
		runtime: {...diagnostics.snapshot(readConfig({})), uptimeSeconds: seconds, cpu: {user: seconds * 1000, system: 0}},
		session: {
			id: sessionId, mode: 'ambience', status: 'active', rendering: true, ready: true, listenerCount: 1, producerPid: 123,
			currentRun: runId, playbackCursorMs: seconds * 1000, renderedUntilMs: (seconds + 100) * 1000, committedUntilMs: (seconds + 30) * 1000,
			bufferAheadSeconds: 100, queuedPcmChunks: 3, idleTimeoutSeconds: 90, bufferLimitsSeconds: {minimum: 45, target: 90, maximum: 180},
			scheduledBeds: [], listeners: [{state: 'playing', lastConsumptionAgoSeconds: 3}],
			scheduledEvents: [], planning: {
				enabled: true, busy: false, model: 'local-test', opportunities: Math.floor(seconds / 300), skipped: 0, nextOpportunityMs: (seconds + 300) * 1000,
			},
			modelState: {plannerRequestActive: false, residency: 'not-polled'},
		},
		disk: {
			files: 25, bytes: 1024, hlsFiles: 20, hlsBytes: 512, pcmFiles: 3, pcmBytes: 512, truncated: false,
		},
		processes: [{
			pid: 123, parentPid: 1, cpuPercent: 3, rssBytes: 20_000, command: 'ffmpeg',
		}],
	};
}

it('bounds the diagnostic journal and error detail while preserving sequence numbers', () => {
	const journal = new Diagnostics();
	for (let index = 0; index < 200; index++) {
		journal.record('renderer-error', sessionId, 'x'.repeat(5000));
	}

	const snapshot = journal.snapshot(readConfig({}));
	expect(snapshot.events).toHaveLength(128);
	expect(snapshot.events[0]?.sequence).toBe(73);
	expect(snapshot.events.at(-1)?.sequence).toBe(200);
	expect(snapshot.events[0]?.detail).toHaveLength(4096);
	expect(snapshot.plannerConfiguration).toMatchObject({
		model: 'qwen3:8b', timeoutMs: 45_000, skipProbability: 0.25, delayScale: 1,
	});
});

it('keeps full-run aggregates without growing arrays during an eight-hour simulated recording', () => {
	const summary = new RunSummary(30, sessionId);
	for (let seconds = 0; seconds <= 28_800; seconds += 30) {
		summary.add(sample(seconds));
	}

	expect(summary.issues).toEqual({});
	expect(summary.completeSamples).toBe(961);
	expect(summary.json().metrics.serverCpuPercent?.mean).toBeCloseTo(0.1);
	expect(summary.json().metrics.eventOpportunities?.last).toBe(96);
	expect(summary.json().metrics.scheduledEventCount?.maximum).toBe(0);
	expect(JSON.stringify(summary.json()).length).toBeLessThan(6000);
});

it('flags stalls, low buffers, stale history, retention overflow, and missing samples', () => {
	const summary = new RunSummary(30, sessionId);
	summary.add(sample(900));
	for (const seconds of [930, 960, 990]) {
		const next = sample(seconds);
		next.session!.committedUntilMs = 930_000;
		next.session!.bufferAheadSeconds = 5;
		next.session!.scheduledBeds = [{assetId: randomUUID(), startMs: 0, durationMs: 90_000}];
		next.disk!.hlsFiles = 100;
		summary.add(next);
	}

	summary.add({at: sample(1200).at, errors: ['HTTP 503']});
	expect(Object.keys(summary.issues)).toEqual(expect.arrayContaining(['encoder-stalled', 'buffer-out-of-bounds', 'history-not-pruned', 'retention-limit', 'sample-gap', 'collection-error']));
});

it('does not impose ambience buffer requirements on the original looping fixture', () => {
	const summary = new RunSummary(30, sessionId);
	const fixture = sample(0);
	fixture.session!.mode = 'fixture';
	fixture.session!.bufferAheadSeconds = 0;
	summary.add(fixture);
	expect(summary.issues).toEqual({});
	expect(summary.metrics.activeBufferSeconds).toBeUndefined();
});

it('deduplicates lifecycle events and flags between-sample interruptions, restarts, and journal overflow', () => {
	const summary = new RunSummary(30, sessionId);
	summary.add(sample(0));
	const next = sample(30);
	next.runtime!.events = [{
		sequence: 1, at: sample(15).at, event: 'idle', sessionId,
	}];
	next.runtime!.latestSequence = 1;
	expect(summary.add(next).events).toHaveLength(1);
	expect(summary.add({...next, at: sample(60).at}).events).toHaveLength(0);
	expect(summary.issues['playback-interrupted']?.count).toBe(1);
	const restarted = sample(90);
	restarted.runtime!.instanceId = randomUUID();
	restarted.runtime!.latestSequence = 201;
	restarted.runtime!.events = [{
		sequence: 201, at: sample(80).at, event: 'renderer-error', sessionId, detail: 'encoder failed',
	}];
	summary.add(restarted);
	expect(Object.keys(summary.issues)).toEqual(expect.arrayContaining(['server-restarted', 'journal-gap', 'server-error']));
});

it('selects only the server process tree, including nested FFmpeg processes', () => {
	expect(parseProcesses('10 1 1.5 100 /usr/local/bin/node\n11 10 5.0 200 /bin/sh\n12 11 4.0 300 /opt/homebrew/bin/ffmpeg\n99 1 50.0 999 /other/node', 10)).toEqual([
		{
			pid: 10, parentPid: 1, cpuPercent: 1.5, rssBytes: 102_400, command: 'node',
		},
		{
			pid: 11, parentPid: 10, cpuPercent: 5, rssBytes: 204_800, command: 'sh',
		},
		{
			pid: 12, parentPid: 11, cpuPercent: 4, rssBytes: 307_200, command: 'ffmpeg',
		},
	]);
});

it('rotates within a fixed disk budget and bounds filesystem scans without following symlinks', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-monitor-'));
	try {
		const file = path.join(directory, 'samples.jsonl');
		const log = new RotatingLog(file, 32);
		for (let index = 0; index < 10; index++) {
			// eslint-disable-next-line no-await-in-loop -- Exercise ordered rotation.
			await log.append({index, data: '0123456789'});
		}

		expect(await readdir(directory)).toHaveLength(3);
		expect(log.rotations).toBe(9);
		expect(await readFile(file, 'utf8')).toContain('"index":9');
		expect(await readFile(`${file}.2`, 'utf8')).toContain('"index":7');
		await expect(log.append({huge: 'x'.repeat(100)})).rejects.toThrow('size limit');
		const session = path.join(directory, 'session');
		await mkdir(session);
		await writeFile(path.join(session, 'audio.ts'), '123');
		await writeFile(path.join(session, 'chunk.pcm'), '12345');
		await symlink(directory, path.join(session, 'outside'));
		expect(await sessionDiskUsage(session)).toMatchObject({
			files: 2, bytes: 8, hlsFiles: 1, pcmFiles: 1, truncated: false,
		});
		expect(await sessionDiskUsage(session, 1)).toMatchObject({truncated: true});
		expect(await sessionDiskUsage(path.join(directory, 'missing'))).toMatchObject({files: 0, bytes: 0});
	} finally {
		await rm(directory, {recursive: true, force: true});
	}
});

it('excludes earlier inference and initial journal overflow, but counts current-session failures once', () => {
	const summary = new RunSummary(30, sessionId);
	const initial = sample(900);
	initial.runtime!.events = [{
		sequence: 200, at: sample(800).at, event: 'planner-request-started', sessionId,
	}];
	initial.runtime!.latestSequence = 200;
	summary.add(initial);
	expect(summary.issues).toEqual({});
	expect(summary.inference.plannerCalls).toBe(0);
	const next = sample(930);
	next.runtime!.events = [
		{
			sequence: 201, at: sample(915).at, event: 'planner-request-failed', sessionId,
		},
		{
			sequence: 202, at: sample(916).at, event: 'sound-generation-failed', sessionId,
		},
		{
			sequence: 203, at: sample(917).at, event: 'sound-generated', sessionId: randomUUID(),
		},
	];
	next.runtime!.latestSequence = 203;
	summary.add(next);
	summary.add({...next, at: sample(960).at});
	expect(summary.inference).toEqual({
		plannerCalls: 0, generatedRecordings: 0, cacheReuses: 0, failures: 2,
	});
	expect(summary.issues['inference-failure']?.count).toBe(2);
});
