import {spawn} from 'node:child_process';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {type Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';

export type Renderer = {
	directory: string;
	runId: string;
	readonly pid: number | undefined;
	readonly running: boolean;
	ready: () => Promise<void>;
	stop: () => Promise<void>;
	eventStartMs?: () => number;
	diagnostics?: () => {renderedUntilMs: number; committedUntilMs: number; queuedChunks: number; minimumBufferMs: number; targetBufferMs: number; maximumBufferMs: number};
};

export type RendererOptions = {
	directory: string;
	runId: string;
	fixturePath: string;
	ffmpegPath: string;
	onFailure: (error: Error) => void;
	pcm?: {start: (input: Writable) => void; stop: () => Promise<void>};
};

export type RendererFactory = (options: RendererOptions) => Promise<Renderer>;

export const segmentNamePattern = /^segment-\d+\.ts$/;

export function playlistSegments(playlist: string) {
	return playlist.split('\n').filter(line => segmentNamePattern.test(line));
}

export const startRenderer: RendererFactory = async options => {
	await mkdir(options.directory, {recursive: true});
	const child = spawn(options.ffmpegPath, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-nostdin',
		...(options.pcm
			? ['-readrate', '1', '-readrate_initial_burst', '20', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0']
			: ['-stream_loop', '-1', '-readrate', '1', '-readrate_initial_burst', '20', '-i', options.fixturePath]),
		'-map',
		'0:a:0',
		'-vn',
		'-af',
		// Fixed +12 dB test boost; user-adjustable volume comes later.
		'volume=4,alimiter=limit=0.25:level=false:attack=5:release=50',
		'-ar',
		'44100',
		'-ac',
		'2',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-f',
		'hls',
		'-hls_time',
		'6',
		'-hls_list_size',
		'10',
		'-hls_delete_threshold',
		'10',
		'-hls_start_number_source',
		'epoch_us',
		'-hls_flags',
		'delete_segments+temp_file+omit_endlist+discont_start',
		'-hls_segment_filename',
		path.join(options.directory, 'segment-%018d.ts'),
		path.join(options.directory, 'stream.m3u8'),
	], {stdio: ['pipe', 'ignore', 'pipe']});
	let stopping = false;
	let ended = false;
	let failure: Error | undefined;
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		stderr = (stderr + chunk).slice(-8192);
	});
	const closed = new Promise<void>(resolve => {
		child.once('error', error => {
			failure = error;
		});
		child.once('close', code => {
			ended = true;
			if (!stopping) {
				failure ??= new Error(`FFmpeg exited (${code}): ${stderr}`);
				options.onFailure(failure);
			}

			resolve();
		});
	});

	child.stdin.on('error', () => {/* Child close reports the failure. */});
	options.pcm?.start(child.stdin);

	return {
		directory: options.directory,
		runId: options.runId,
		get pid() {
			return child.pid;
		},
		get running() {
			return !ended;
		},
		async ready() {
			const deadline = Date.now() + 20_000;
			while (Date.now() < deadline) {
				if (ended) {
					throw failure ?? new Error('Renderer stopped during initialization');
				}

				try {
					// eslint-disable-next-line no-await-in-loop -- Bounded readiness polling.
					const playlist = await readFile(path.join(options.directory, 'stream.m3u8'), 'utf8');
					if (playlistSegments(playlist).length >= 3) {
						return;
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}
				}

				// eslint-disable-next-line no-await-in-loop -- Poll until the previous read finds enough segments.
				await delay(50);
			}

			throw new Error('FFmpeg did not publish three segments within 20 seconds');
		},
		async stop() {
			const pcmStopped = options.pcm?.stop();
			if (ended) {
				await pcmStopped;
				return;
			}

			stopping = true;
			child.kill('SIGTERM');
			const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
			try {
				await closed;
				await pcmStopped;
			} finally {
				clearTimeout(timer);
			}
		},
	};
};
