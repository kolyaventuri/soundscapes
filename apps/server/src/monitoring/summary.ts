import {type Sample, type RuntimeSnapshot} from './sample.js';

type Metric = {first: number; last: number; minimum: number; maximum: number; samples: number; sum: number};
type Warn = (code: string, detail: string) => void;
type Issue = {count: number; firstAt: string; lastAt: string; detail: string};

export class RunSummary {
	readonly metrics: Record<string, Metric> = {};
	readonly issues: Record<string, Issue> = {};
	readonly states: Record<string, number> = {};
	samples = 0;
	completeSamples = 0;
	firstAt: string | undefined;
	lastAt: string | undefined;
	private previous: Sample | undefined;
	private lastSequence = 0;
	private lastInstance = '';
	private stalledSince: number | undefined;
	private growthBaseline: {at: number; bytes: number; files: number; beds: number} | undefined;

	constructor(private readonly intervalSeconds: number, private readonly sessionId: string) {}

	issue(code: string, at: string, detail: string) {
		const previous = this.issues[code];
		this.issues[code] = {
			count: (previous?.count ?? 0) + 1, firstAt: previous?.firstAt ?? at, lastAt: at, detail: detail.slice(0, 1000),
		};
		return {at, code, detail};
	}

	add(sample: Sample) {
		const warnings: Array<{at: string; code: string; detail: string}> = [];
		const warn = (code: string, detail: string) => warnings.push(this.issue(code, sample.at, detail));
		const now = Date.parse(sample.at);
		const {previous} = this;
		this.firstAt ??= sample.at;
		this.lastAt = sample.at;
		this.samples++;
		if (sample.runtime && sample.session && sample.disk && sample.processes && sample.errors.length === 0) {
			this.completeSamples++;
		}

		if (previous) {
			const gap = (now - Date.parse(previous.at)) / 1000;
			this.metric('sampleGapSeconds', gap);
			if (gap > (this.intervalSeconds * 1.5) + 2 || gap < 0) {
				warn('sample-gap', `Sample spacing ${gap.toFixed(1)}s; expected ${this.intervalSeconds}s. Host sleep or recorder delay is possible.`);
			}
		}

		for (const error of sample.errors) {
			warn('collection-error', error);
		}

		const events = this.observeRuntime(sample, warn);
		this.observeProcesses(sample);
		this.observeSession(sample, warn);
		this.observePlanning(sample);
		this.observeDisk(sample, warn);

		this.previous = sample;
		return {warnings, events};
	}

	json() {
		return {
			samples: this.samples, completeSamples: this.completeSamples, firstAt: this.firstAt, lastAt: this.lastAt,
			states: this.states, issues: this.issues,
			metrics: Object.fromEntries(Object.entries(this.metrics).map(([name, value]) => [name, {...value, mean: value.sum / value.samples}])),
		};
	}

	private observeRuntime(sample: Sample, warn: Warn) {
		const {runtime} = sample;
		const {previous} = this;
		let events = runtime?.events ?? [];
		if (runtime) {
			if (this.lastInstance && this.lastInstance !== runtime.instanceId) {
				warn('server-restarted', 'Server instance changed; its in-memory journal was reset and events near shutdown may be unavailable.');
				this.lastSequence = 0;
			}

			if ((events[0]?.sequence ?? 1) > this.lastSequence + 1) {
				warn('journal-gap', 'More than 128 server events occurred before collection; older details were lost.');
			}

			events = events.filter(event => event.sequence > this.lastSequence);
			this.lastSequence = runtime.latestSequence;
			this.lastInstance = runtime.instanceId;
			this.metric('serverRssBytes', runtime.memory.rss);
			this.metric('serverHeapUsedBytes', runtime.memory.heapUsed);
			this.metric('serverExternalBytes', runtime.memory.external);
			if (previous?.runtime?.instanceId === runtime.instanceId) {
				const seconds = runtime.uptimeSeconds - previous.runtime.uptimeSeconds;
				if (seconds > 0) {
					this.metric('serverCpuPercent', (runtime.cpu.user + runtime.cpu.system - previous.runtime.cpu.user - previous.runtime.cpu.system) / (seconds * 10_000));
				}
			}
		}

		this.observeEvents(events, sample.at, warn);

		return events;
	}

	private observeEvents(events: RuntimeSnapshot['events'], at: string, warn: Warn) {
		for (const event of events) {
			const relevant = (event.sessionId === this.sessionId || event.sessionId === 'server') && event.at >= (this.firstAt ?? at);
			if (relevant && event.event.includes('error')) {
				warn('server-error', `${event.event}: ${event.detail ?? event.sessionId}`);
			}

			if (relevant && ['idle', 'stopped', 'listener-expired'].includes(event.event)) {
				warn('playback-interrupted', `${event.event} at ${event.at}; review against intentional controls.`);
			}
		}
	}

	private observeProcesses(sample: Sample) {
		if (sample.processes) {
			const ffmpeg = sample.processes.filter(row => row.command === 'ffmpeg');
			this.metric('ffmpegProcessCount', ffmpeg.length);
			this.metric('ffmpegRssBytes', ffmpeg.reduce((sum, row) => sum + row.rssBytes, 0));
			this.metric('ffmpegPsCpuPercent', ffmpeg.reduce((sum, row) => sum + row.cpuPercent, 0));
			const sound = sample.processes.find(row => row.pid === sample.session?.soundWorker?.pid);
			this.metric('soundWorkerRssBytes', sound?.rssBytes ?? 0);
			this.metric('soundWorkerPsCpuPercent', sound?.cpuPercent ?? 0);
		}
	}

	private observePlanning({session}: Sample) {
		if (session?.soundWorker) {
			this.metric('soundWorkerLoaded', Number(session.soundWorker.loaded));
			this.metric('soundWorkerBusy', Number(session.soundWorker.busy));
			this.metric('soundGenerationQueueCount', session.generationQueue?.length ?? 0);
		}

		if (session?.scheduledEvents) {
			this.metric('scheduledEventCount', session.scheduledEvents.length);
		}

		if (session?.planning) {
			this.metric('eventOpportunities', session.planning.opportunities);
			this.metric('eventSkips', session.planning.skipped);
		}

		if (session?.modelState) {
			this.metric('plannerRequestActive', Number(session.modelState.plannerRequestActive));
		}
	}

	private observeSession(sample: Sample, warn: Warn) {
		const {session} = sample;
		if (session) {
			this.states[session.status] = (this.states[session.status] ?? 0) + 1;
			this.metric('scheduledBedCount', session.scheduledBeds.length);
			this.metric('queuedPcmChunks', session.queuedPcmChunks);
			this.metric('playbackCursorMs', session.playbackCursorMs);
			if (session.status === 'active') {
				if (session.mode === 'ambience') {
					this.metric('activeBufferSeconds', session.bufferAheadSeconds);
					if (session.bufferAheadSeconds < session.bufferLimitsSeconds.minimum || session.bufferAheadSeconds > session.bufferLimitsSeconds.maximum) {
						warn('buffer-out-of-bounds', `Buffer ${session.bufferAheadSeconds.toFixed(1)}s is outside ${session.bufferLimitsSeconds.minimum}–${session.bufferLimitsSeconds.maximum}s.`);
					}
				}

				if (!session.rendering || session.producerPid === null) {
					warn('producer-missing', 'Active session has no running producer.');
				}

				const playing = session.listeners.filter(listener => listener.state === 'playing');
				if (playing.every(listener => listener.lastConsumptionAgoSeconds >= session.idleTimeoutSeconds)) {
					warn('consumption-stale', 'No playing listener has consumed a segment within the watchdog interval.');
				}
			} else {
				warn('not-active', `Expected uninterrupted playback; observed ${session.status}. Review intentional controls against timestamps.`);
			}

			this.observeProgress(sample, warn);

			if (session.scheduledBeds.some(bed => bed.startMs + bed.durationMs < session.playbackCursorMs - 660_000)) {
				warn('history-not-pruned', 'Bed history is over eleven minutes behind the cursor (includes one minute of pruning grace).');
			}
		}
	}

	private observeProgress(sample: Sample, warn: Warn) {
		const {session, runtime} = sample;
		const {previous} = this;
		const now = Date.parse(sample.at);
		if (!session) {
			return;
		}

		const before = previous?.session;
		if (session.status === 'active' && before?.status === 'active' && session.currentRun === before.currentRun && runtime?.instanceId === previous?.runtime?.instanceId) {
			if (session.playbackCursorMs <= before.playbackCursorMs) {
				warn('clock-stalled', 'Active playback cursor did not advance.');
			}

			if (session.committedUntilMs <= before.committedUntilMs) {
				this.stalledSince ??= Date.parse(previous!.at);
				if (now - this.stalledSince >= 90_000) {
					warn('encoder-stalled', 'Encoder commit cursor has not advanced for at least 90 seconds.');
				}
			} else {
				this.stalledSince = undefined;
			}
		} else {
			this.stalledSince = undefined;
		}
	}

	private observeDisk(sample: Sample, warn: Warn) {
		const {session, disk} = sample;
		const now = Date.parse(sample.at);
		if (disk) {
			for (const key of ['files', 'bytes', 'hlsFiles', 'hlsBytes', 'pcmFiles', 'pcmBytes'] as const) {
				this.metric(`disk.${key}`, disk[key]);
			}

			if (disk.truncated) {
				warn('disk-scan-truncated', 'Session tree exceeded the 5000-entry scan limit; totals are incomplete.');
			}

			if (disk.hlsFiles > 44 || disk.pcmFiles > 8 || (session?.scheduledBeds.length ?? 0) > 24) {
				warn('retention-limit', 'HLS (>44 across two runs), PCM (>8), or scheduled beds (>24) exceeded the expected retention allowance.');
			}

			if (session?.status === 'active' && session.playbackCursorMs >= 900_000) {
				const baseline = this.growthBaseline;
				if (baseline && now - baseline.at >= 900_000) {
					if (disk.bytes > baseline.bytes + (32 * 1024 * 1024) || disk.files > baseline.files + 24 || session.scheduledBeds.length > baseline.beds + 4) {
						warn('retention-growth', 'Session retention grew beyond expected chunk/run variation over fifteen minutes.');
					}

					this.growthBaseline = undefined;
				}

				this.growthBaseline ??= {
					at: now, bytes: disk.bytes, files: disk.files, beds: session.scheduledBeds.length,
				};
			}
		}
	}

	private metric(name: string, value: number) {
		const previous = this.metrics[name];
		this.metrics[name] = {
			first: previous?.first ?? value, last: value, minimum: Math.min(previous?.minimum ?? value, value), maximum: Math.max(previous?.maximum ?? value, value),
			samples: (previous?.samples ?? 0) + 1, sum: (previous?.sum ?? 0) + value,
		};
	}
}
