import {execFile} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {hostname} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import {delayBucketsSchema} from '../planning/contracts.js';
import {sessionDiskUsage, type DiskUsage} from './storage.js';

const execute = promisify(execFile);
const nonnegative = z.number().nonnegative();
const runtimeSchema = z.object({
	instanceId: z.uuid(), startedAt: z.iso.datetime(), pid: z.number().int().positive(), hostname: z.string(), nodeVersion: z.string(),
	dataDirectory: z.string(), idleTimeoutSeconds: nonnegative,
	plannerConfiguration: z.object({
		url: z.url(), model: z.string().max(120), timeoutMs: nonnegative, skipProbability: z.number().min(0).max(1), delayScale: nonnegative, delayBuckets: delayBucketsSchema,
	}).optional(),
	memory: z.object({rss: nonnegative, heapUsed: nonnegative, external: nonnegative}),
	cpu: z.object({user: nonnegative, system: nonnegative}), uptimeSeconds: nonnegative,
	latestSequence: z.number().int().nonnegative(),
	events: z.array(z.object({
		sequence: z.number().int().positive(), at: z.iso.datetime(), event: z.string().max(128), sessionId: z.string().max(128), detail: z.string().max(4096).optional(),
	})).max(128),
});
const sessionDebugSchema = z.object({
	id: z.uuid(), status: z.enum(['initializing', 'active', 'idle', 'stopped', 'error']), mode: z.enum(['fixture', 'ambience']),
	rendering: z.boolean(), ready: z.boolean(), listenerCount: nonnegative, producerPid: z.number().int().positive().nullable(),
	currentRun: z.uuid().nullable(), playbackCursorMs: nonnegative, renderedUntilMs: nonnegative, committedUntilMs: nonnegative,
	bufferAheadSeconds: nonnegative, queuedPcmChunks: nonnegative, idleTimeoutSeconds: nonnegative,
	bufferLimitsSeconds: z.object({minimum: nonnegative, target: nonnegative, maximum: nonnegative}),
	scheduledBeds: z.array(z.object({assetId: z.uuid(), startMs: nonnegative, durationMs: nonnegative})).max(256),
	scheduledEvents: z.array(z.object({assetId: z.uuid(), startMs: nonnegative, durationMs: nonnegative})).max(32).optional(),
	planning: z.object({
		enabled: z.boolean(), busy: z.boolean(), model: z.string().max(120), opportunities: nonnegative, skipped: nonnegative, nextOpportunityMs: nonnegative.nullable(),
	}).optional(),
	modelState: z.object({plannerRequestActive: z.boolean(), residency: z.string().max(128)}).optional(),
	soundWorker: z.object({pid: z.number().int().positive().nullable(), loaded: z.boolean(), busy: z.boolean()}).optional(),
	generationQueue: z.array(z.object({
		id: z.uuid(), sessionId: z.uuid(), kind: z.enum(['ambience', 'event']), state: z.enum(['queued', 'running']), deadlineAt: nonnegative,
	})).max(8).optional(),
	listeners: z.array(z.object({state: z.enum(['playing', 'paused', 'expired']), lastConsumptionAgoSeconds: z.number()})).max(16),
	error: z.string().max(8192).optional(),
});
export type RuntimeSnapshot = z.infer<typeof runtimeSchema>;
export type DebugSnapshot = z.infer<typeof sessionDebugSchema>;
export type ProcessSample = {pid: number; parentPid: number; cpuPercent: number; rssBytes: number; command: string};
export type Sample = {
	at: string;
	runtime?: RuntimeSnapshot;
	session?: DebugSnapshot;
	disk?: DiskUsage;
	processes?: ProcessSample[];
	errors: string[];
};

export async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(url, {redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`${url.pathname}: HTTP ${response.status}`);
	}

	// Bound even a malformed/debug-server response, rather than buffering forever.
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of response.body! as ReadableStream<Uint8Array>) {
		size += chunk.length;
		if (size > 1024 * 1024) {
			throw new Error('Debug response exceeds 1 MiB');
		}

		chunks.push(chunk);
	}

	return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

export function parseProcesses(output: string, serverPid: number): ProcessSample[] {
	const rows = output.trim().split('\n').flatMap(line => {
		const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
		return match
			? [{
				pid: Number(match[1]), parentPid: Number(match[2]), cpuPercent: Number(match[3]), rssBytes: Number(match[4]) * 1024, command: path.basename(match[5]!),
			}]
			: [];
	});
	const descendants = new Set([serverPid]);
	for (let level = 0; level < 8; level++) {
		for (const row of rows) {
			if (descendants.has(row.parentPid)) {
				descendants.add(row.pid);
			}
		}
	}

	return rows.filter(row => descendants.has(row.pid)).slice(0, 64);
}

export function assertLocalRuntime(runtime: RuntimeSnapshot, dataDirectory: string) {
	if (runtime.hostname !== hostname() || path.resolve(runtime.dataDirectory) !== path.resolve(dataDirectory)) {
		throw new Error('The server host or DATA_DIR does not match this recorder; local process/disk measurements would be invalid.');
	}
}

export async function collectSample({origin, sessionId, dataDirectory, signal}: {origin: string; sessionId: string; dataDirectory: string; signal?: AbortSignal}): Promise<Sample> {
	const sample: Sample = {at: new Date().toISOString(), errors: []};
	const readRuntime = async () => runtimeSchema.parse(await fetchJson(new URL('/api/debug/monitoring', origin), signal));
	const readSession = async () => sessionDebugSchema.parse(await fetchJson(new URL(`/api/debug/sessions/${sessionId}`, origin), signal));
	const results = await Promise.allSettled([
		readRuntime(), readSession(),
	]);
	const [runtime, session] = results;
	if (runtime.status === 'fulfilled') {
		sample.runtime = runtime.value;
	} else {
		sample.errors.push(`Runtime: ${String(runtime.reason).slice(0, 1000)}`);
	}

	if (session.status === 'fulfilled') {
		if (session.value.id !== sessionId) {
			throw new Error('Debug endpoint returned a different session');
		}

		sample.session = session.value;
	} else {
		sample.errors.push(`Session: ${String(session.reason).slice(0, 1000)}`);
	}

	if (sample.runtime) {
		assertLocalRuntime(sample.runtime, dataDirectory);
		const local = await Promise.allSettled([
			execute('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,comm='], {timeout: 5000, maxBuffer: 2 * 1024 * 1024}),
			sessionDiskUsage(path.join(dataDirectory, 'sessions', sessionId)),
		]);
		const [processes, disk] = local;
		if (processes.status === 'fulfilled') {
			sample.processes = parseProcesses(processes.value.stdout, sample.runtime.pid);
			if (!sample.processes.some(row => row.pid === sample.runtime!.pid)) {
				sample.errors.push('Server PID absent from local process snapshot');
			}
		} else {
			sample.errors.push(`Processes: ${String(processes.reason).slice(0, 1000)}`);
		}

		if (disk.status === 'fulfilled') {
			sample.disk = disk.value;
		} else {
			sample.errors.push(`Disk: ${String(disk.reason).slice(0, 1000)}`);
		}
	}

	return sample;
}
