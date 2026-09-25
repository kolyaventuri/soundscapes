/* eslint-disable no-await-in-loop -- Persist ordered samples and recovery records serially. */
import {randomUUID} from 'node:crypto';
import {
	lstat, mkdir, readFile, rename, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
	recordingListSchema, startRecordingSchema, type Recording, type StartRecording,
} from '@soundscapes/shared';
import {type Sample} from './sample.js';
import {RunSummary} from './summary.js';
import {RotatingLog, writeJson} from './storage.js';

export type RecordingOptions = {
	dataDirectory: string;
	session: (id: string) => {title: string; status: string; ready: boolean};
	collect: (id: string) => Promise<Sample>;
	provenance: () => Promise<unknown>;
	onError: (error: unknown) => void;
};
type Active = {view: Recording; summary: RunSummary; samples: RotatingLog; events: RotatingLog; interval: number; deadline: number};

// One timer, one collection at a time. Reads and recording controls never call
// playback, preparation, or listener APIs. Browser lifetime is irrelevant.
export class Recordings {
	private views: Recording[] = [];
	private active: Active | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private pending: Promise<unknown> = Promise.resolve();
	private closed = false;
	private readonly directory: string;

	constructor(private readonly options: RecordingOptions) {
		this.directory = path.join(options.dataDirectory, 'soaks');
	}

	async initialize() {
		await mkdir(this.directory, {recursive: true});
		const index = path.join(this.directory, 'pwa-index.json');
		try {
			const info = await lstat(index);
			if (!info.isFile() || info.size > 1024 * 1024) {
				throw new Error('Invalid recording index');
			}

			this.views = recordingListSchema.parse(JSON.parse(await readFile(index, 'utf8'))).recordings;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		for (const view of this.views) {
			if (view.state === 'recording') {
				view.state = 'interrupted';
				view.issues.push({
					code: 'server-interrupted', count: 1,
					detail: 'Server ended before recording finished. Duration stops at the last saved sample; the unobserved interval is not counted.',
				});
				await this.saveReport(view);
			}
		}

		await this.saveIndex();
	}

	async list() {
		await this.pending;
		return structuredClone({recordings: this.views});
	}

	get(id: string) {
		const view = this.views.find(view => view.id === id);
		if (!view) {
			throw Object.assign(new Error('Recording not found in recent history'), {statusCode: 404});
		}

		return structuredClone(view);
	}

	async start(input: StartRecording) {
		return this.serial(async () => {
			const request = startRecordingSchema.parse(input);
			if (this.closed) {
				throw Object.assign(new Error('Server is shutting down'), {statusCode: 503});
			}

			if (this.active) {
				if (this.active.view.sessionId === request.sessionId) {
					return this.get(this.active.view.id);
				}

				throw Object.assign(new Error('Stop the current diagnostic recording before starting another.'), {statusCode: 409});
			}

			const session = this.options.session(request.sessionId);
			if (session.status !== 'active' || !session.ready) {
				throw Object.assign(new Error('Start audio playback before recording diagnostics.'), {statusCode: 409});
			}

			const id = randomUUID();
			const directory = this.runDirectory(id);
			await mkdir(directory);
			const provenance = await this.options.provenance();
			const startedAt = new Date().toISOString();
			const view: Recording = {
				id, sessionId: request.sessionId, title: session.title, device: request.device, startedAt, updatedAt: startedAt,
				minutes: request.minutes, state: 'recording', elapsedSeconds: 0, samples: 0, completeSamples: 0, issues: [], metrics: [],
				inference: {
					plannerCalls: 0, generatedRecordings: 0, cacheReuses: 0, failures: 0,
				},
			};
			const interval = request.minutes === 5 ? 5 : 30;
			await writeJson(path.join(directory, 'manifest.json'), {
				formatVersion: 2, ...request, startedAt, intervalSeconds: interval, provenance,
				notes: [
					'Server-managed recorder. No playback or listener activity is created. No audio is recorded.',
					'Source revision does not certify the running build. Keep the server powered and awake; do not rebuild or restart during the run.',
					'Process samples exclude external Ollama/GPU allocation and may miss brief peaks. Session disk excludes reusable assets and recorder files.',
					'Stream consumption does not prove audible playback. A server crash leaves only the last saved sample; recovery marks the run interrupted.',
				],
			});
			this.views = [view, ...this.views].slice(0, 20);
			this.active = {
				view, interval, deadline: Date.parse(startedAt) + (request.minutes * 60_000), summary: new RunSummary(interval, request.sessionId),
				samples: new RotatingLog(path.join(directory, 'samples.jsonl')), events: new RotatingLog(path.join(directory, 'events.jsonl')),
			};
			this.active.summary.firstAt = startedAt;
			try {
				await this.saveIndex();
				await this.sample();
			} catch (error) {
				await this.fail(error);
			}

			this.schedule();
			return this.get(id);
		});
	}

	async stop(id: string) {
		return this.serial(async () => {
			this.get(id);
			if (this.active?.view.id === id) {
				clearTimeout(this.timer);
				try {
					await this.sample();
					await this.finish('interrupted', 'Stopped early from recording controls. Audio playback was not changed.');
				} catch (error) {
					await this.fail(error);
				}
			}

			return this.get(id);
		});
	}

	async close() {
		this.closed = true;
		clearTimeout(this.timer);
		return this.serial(async () => this.finish('interrupted', 'Server shut down before the recording finished.'));
	}

	private async serial<T>(operation: () => Promise<T>): Promise<T> {
		// eslint-disable-next-line promise/prefer-await-to-then -- Chaining reserves this operation before another caller enters.
		const next = this.pending.then(operation);
		// eslint-disable-next-line promise/prefer-await-to-then -- A failed operation must not poison subsequent controls.
		this.pending = next.catch(() => undefined);
		return next;
	}

	private schedule() {
		clearTimeout(this.timer);
		const run = this.active;
		if (!run || this.closed) {
			return;
		}

		const next = Math.min(Date.parse(run.view.updatedAt) + (run.interval * 1000), run.deadline);
		this.timer = setTimeout(() => {
			void this.serial(async () => {
				try {
					await this.sample();
				} catch (error) {
					await this.fail(error);
				}

				this.schedule();
			// eslint-disable-next-line promise/prefer-await-to-then -- Timer callbacks cannot propagate a rejected promise.
			}).catch(this.options.onError);
		}, Math.max(0, next - Date.now()));
		this.timer.unref();
	}

	private async sample() {
		const run = this.active;
		if (!run) {
			return;
		}

		const sample = await this.options.collect(run.view.sessionId);
		const findings = run.summary.add(sample);
		await run.samples.append({...sample, runtime: sample.runtime ? {...sample.runtime, events: undefined} : undefined});
		for (const event of findings.events) {
			await run.events.append({kind: 'server', instanceId: sample.runtime?.instanceId, ...event});
		}

		for (const warning of findings.warnings) {
			await run.events.append({kind: 'recorder', ...warning});
		}

		run.view.updatedAt = sample.at;
		run.view.elapsedSeconds = Math.max(0, (Date.parse(sample.at) - Date.parse(run.view.startedAt)) / 1000);
		this.updateView(run);
		if (!sample.session || ['stopped', 'error'].includes(sample.session.status)) {
			await this.finish('interrupted', 'The recorded session stopped, failed, or became unavailable.');
		} else if (Date.parse(sample.at) >= run.deadline) {
			await this.finish('completed');
		} else {
			await this.persist(run.view);
		}
	}

	private updateView(run: Active) {
		const summary = run.summary.json();
		Object.assign(run.view, {
			samples: summary.samples, completeSamples: summary.completeSamples, inference: {...summary.inference},
			issues: Object.entries(summary.issues).map(([code, issue]) => ({code, ...issue})),
			metrics: Object.entries(summary.metrics).map(([name, metric]) => ({name, ...metric})),
		});
	}

	private async finish(state: Recording['state'], reason?: string) {
		const run = this.active;
		if (!run) {
			return;
		}

		clearTimeout(this.timer);
		if (reason) {
			run.summary.issue(`recording-${state}`, new Date().toISOString(), reason);
		}

		this.updateView(run);
		run.view.state = state;
		await this.persist(run.view);
		this.active = undefined;
	}

	private async fail(error: unknown) {
		this.options.onError(error);
		try {
			await this.finish('failed', String(error).slice(0, 1000));
		} catch (saveError) {
			// A disk failure must not crash the audio server. The last durable index
			// remains recording and will be recovered as interrupted at startup.
			this.options.onError(saveError);
		} finally {
			this.active = undefined;
			clearTimeout(this.timer);
		}
	}

	private runDirectory(id: string) {
		return path.join(this.directory, `pwa-${id}`);
	}

	private async saveReport(view: Recording) {
		const directory = this.runDirectory(view.id);
		const info = await lstat(directory);
		if (!info.isDirectory()) {
			throw new Error('Invalid recording directory');
		}

		await writeJson(path.join(directory, 'summary.json'), {formatVersion: 2, ...view});
		await writeFile(path.join(directory, 'summary.md.tmp'), recordingText(view), {mode: 0o600});
		await rename(path.join(directory, 'summary.md.tmp'), path.join(directory, 'summary.md'));
	}

	private async persist(view: Recording) {
		await this.saveReport(view);
		await this.saveIndex();
	}

	private async saveIndex() {
		await writeJson(path.join(this.directory, 'pwa-index.json'), {recordings: this.views});
	}
}

export function recordingText(view: Recording) {
	return [
		'Playback diagnostic recording',
		'',
		`${view.title} — ${view.state}`,
		`Started: ${view.startedAt}`,
		`Last sample: ${view.updatedAt}`,
		`Device: ${view.device || 'Not supplied'}`,
		`Session: ${view.sessionId}`,
		`Recording: ${view.id}`,
		`Duration: ${(view.elapsedSeconds / 60).toFixed(2)} / ${view.minutes} minutes`,
		`Complete samples: ${view.completeSamples}/${view.samples}`,
		'',
		view.state === 'completed' && view.issues.length === 0 && view.completeSamples === view.samples && view.samples > 1
			? 'No issues detected in sampled telemetry. Physical listening acceptance remains manual.'
			: 'Review required; this is not an acceptance result.',
		'',
		'Inference observed during this recording:',
		`${view.inference.plannerCalls} planner calls; ${view.inference.generatedRecordings} new recordings; ${view.inference.cacheReuses} cache reuses; ${view.inference.failures} failures.`,
		'Zero calls or generations means no corresponding inference evidence. Journal gaps make counts incomplete.',
		'',
		'Issues:',
		...(view.issues.length > 0 ? view.issues.map(issue => `${issue.code} (${issue.count}): ${issue.detail}`) : ['None recorded.']),
		'',
		'Sampled ranges (first → last; minimum–maximum):',
		...view.metrics.map(metric => `${metric.name}: ${metric.first.toFixed(2)} → ${metric.last.toFixed(2)}; ${metric.minimum.toFixed(2)}–${metric.maximum.toFixed(2)}`),
		'',
		'Periodic server/process/disk samples can miss brief interruptions and do not prove audible continuity.',
		'External Ollama/GPU allocation, browser stalls and speaker output are not measured. Confirm listening and device controls separately.',
		'',
	].join('\n');
}
