import {
	mkdir, readFile, rm, stat,
} from 'node:fs/promises';
import path from 'node:path';
import {type Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {startRenderer, type Renderer, type RendererOptions} from '../audio/hls.js';
import {type Asset} from '../persistence/store.js';
import {type ScheduledEvent} from '../planning/contracts.js';
import {
	bytesPerSecond, chunkMs, mixArguments, renderChunk,
} from './mix.js';
import {extendTimeline, type TimelineState} from './timeline.js';

export const bufferLimits = {minimumBufferMs: 45_000, targetBufferMs: 90_000, maximumBufferMs: 180_000};
type Options = RendererOptions & {
	root: string;
	temporary: string;
	assets: Asset[];
	timeline: TimelineState;
	events?: ScheduledEvent[];
	eventAssets?: Asset[];
	playbackMs: () => number;
	onPlan: (selected: Asset[]) => void;
	onOptionalFailure?: (error: unknown) => void;
};

export async function startAmbienceRenderer(options: Options): Promise<Renderer> {
	await mkdir(options.temporary, {recursive: true});
	const abort = new AbortController();
	const offsetMs = options.playbackMs();
	const chunks = new Map<number, string>();
	let renderedUntilMs = offsetMs;
	let committedUntilMs = offsetMs;
	let mixingUntilMs = offsetMs;
	let feeding = Promise.resolve();
	let producing = Promise.resolve();
	let input: Writable | undefined;
	let nextChunk = 0;

	async function produce() {
		// Reserve this chunk before yielding: new overlays can only enter later chunks.
		mixingUntilMs = renderedUntilMs + chunkMs;
		const selected: Asset[] = [];
		extendTimeline(options.timeline, options.assets, {untilMs: renderedUntilMs + chunkMs, playbackMs: options.playbackMs(), selected: asset => selected.push(asset)});
		options.onPlan(selected);
		const file = path.join(options.temporary, `chunk-${nextChunk}.pcm`);
		const events = (options.events ?? []).filter(event => event.startMs < mixingUntilMs && event.startMs + event.durationMs > renderedUntilMs);
		const mix = {
			beds: options.timeline.beds, assets: [...options.assets, ...options.eventAssets ?? []], root: options.root, startMs: renderedUntilMs, durationMs: chunkMs, output: file,
		};
		try {
			await renderChunk(options.ffmpegPath, mixArguments({...mix, events}), abort.signal);
		} catch (error) {
			if (abort.signal.aborted || events.length === 0) {
				throw error;
			}

			// A missing/broken optional WAV must not take the bed down with it.
			const ids = new Set(events.map(event => event.id));
			const retained = options.events!.filter(event => !ids.has(event.id));
			options.events!.splice(0, options.events!.length, ...retained);
			options.onOptionalFailure?.(error);
			await renderChunk(options.ffmpegPath, mixArguments(mix), abort.signal);
		}

		const metadata = await stat(file);
		if (metadata.size !== bytesPerSecond * chunkMs / 1000) {
			throw new Error('Mixer returned an incomplete PCM chunk');
		}

		chunks.set(nextChunk++, file);
		renderedUntilMs += chunkMs;
	}

	async function refill() {
		while (!abort.signal.aborted) {
			const ahead = renderedUntilMs - options.playbackMs();
			// eslint-disable-next-line no-await-in-loop -- One bounded mixer job or a cancellable wait.
			await (ahead < bufferLimits.targetBufferMs && ahead + chunkMs <= bufferLimits.maximumBufferMs
				? produce()
				: delay(250, undefined, {signal: abort.signal}));
		}
	}

	async function feed() {
		let index = 0;
		while (!abort.signal.aborted) {
			const file = chunks.get(index);
			if (!file) {
				// eslint-disable-next-line no-await-in-loop -- Await the next produced chunk.
				await delay(50, undefined, {signal: abort.signal});
				continue;
			}

			// At most one 30-second PCM buffer is in JS memory per session.
			// eslint-disable-next-line no-await-in-loop
			const bytes = await readFile(file);
			if (abort.signal.aborted) {
				break;
			}

			// This is the immutable boundary, before any byte reaches the encoder.
			committedUntilMs = offsetMs + ((index + 1) * chunkMs);
			// eslint-disable-next-line no-await-in-loop -- Wait for pipe backpressure before allocating another buffer.
			await writeChunk(input!, bytes);
			chunks.delete(index++);
			// eslint-disable-next-line no-await-in-loop
			await rm(file, {force: true});
		}
	}

	function failed(error: unknown) {
		if (!abort.signal.aborted) {
			abort.abort();
			options.onFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async function guard(job: () => Promise<void>) {
		try {
			await job();
		} catch (error) {
			failed(error);
		}
	}

	try {
		while (renderedUntilMs - offsetMs < bufferLimits.targetBufferMs) {
			// eslint-disable-next-line no-await-in-loop -- Initial preparation is three bounded jobs.
			await produce();
		}

		const renderer = await startRenderer({
			...options,
			pcm: {
				start(destination) {
					input = destination;
					feeding = guard(feed);
					producing = guard(refill);
				},
				async stop() {
					abort.abort();
					input?.destroy();
					await Promise.all([feeding, producing]);
					await rm(options.temporary, {recursive: true, force: true});
				},
			},
		});
		return {
			...renderer,
			eventStartMs: () => Math.max(renderedUntilMs, mixingUntilMs, committedUntilMs) + 1000,
			get running() {
				return renderer.running;
			},
			diagnostics: () => ({
				renderedUntilMs, committedUntilMs, queuedChunks: chunks.size, ...bufferLimits,
			}),
		};
	} catch (error) {
		abort.abort();
		await rm(options.temporary, {recursive: true, force: true});
		throw error;
	}
}

async function writeChunk(destination: Writable, bytes: Uint8Array) {
	await new Promise<void>((resolve, reject) => {
		destination.write(bytes, error => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}
