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
	setVolume?: (percent: number) => Promise<void>;
	eventStartMs?: () => number;
	diagnostics?: () => {renderedUntilMs: number; committedUntilMs: number; queuedChunks: number; minimumBufferMs: number; targetBufferMs: number; maximumBufferMs: number};
};

export type RendererOptions = {
	directory: string;
	runId: string;
	fixturePath: string;
	ffmpegPath: string;
	onFailure: (error: Error) => void;
	volumePercent?: number;
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
		'-stdin',
		// FFmpeg disables command input for all direct pipe: URLs, even fd 3.
		// Its fixed 8 MiB async ring preserves independent audio/control channels.
		...(options.pcm
			? ['-readrate', '1', '-readrate_initial_burst', '20', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'async:pipe:3']
			: ['-stream_loop', '-1', '-readrate', '1', '-readrate_initial_burst', '20', '-i', options.fixturePath]),
		'-map',
		'0:a:0',
		'-vn',
		'-af',
		// Master level is applied by the encoder to future frames. Published HLS
		// and committed PCM remain immutable; the peak limiter always stays last.
		`volume@master=${volumeGain(options.volumePercent ?? 100)},alimiter=limit=0.25:level=false:attack=5:release=50`,
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
	], {stdio: ['pipe', 'ignore', 'pipe', 'pipe']});
	// Both streams are explicitly configured as pipes above.
	const commandInput = child.stdin!;
	const commandOutput = child.stderr!;
	let stopping = false;
	let ended = false;
	let failure: Error | undefined;
	let stderr = '';
	commandOutput.setEncoding('utf8');
	commandOutput.on('data', (chunk: string) => {
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

	commandInput.on('error', () => {/* Child close reports the failure. */});
	const pcm = child.stdio[3] as Writable;
	pcm.on('error', () => {/* Child close reports the failure. */});
	options.pcm?.start(pcm);

	return {
		directory: options.directory,
		runId: options.runId,
		get pid() {
			return child.pid;
		},
		get running() {
			return !ended;
		},
		async setVolume(percent) {
			const gain = volumeGain(percent);
			if (ended || stopping || failure) {
				throw new Error('The audio renderer is not running');
			}

			await new Promise<void>((resolve, reject) => {
				let response = '';
				let settled = false;
				const finish = (error?: Error) => {
					if (settled) {
						return;
					}

					settled = true;
					clearTimeout(timer);
					commandOutput.off('data', reply);
					child.off('close', closed);
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				};

				const reply = (chunk: string) => {
					response = (response + chunk).slice(-2048);
					const match = /Command reply[^\n]*ret:(-?\d+)/.exec(response);
					if (match) {
						finish(match[1] === '0' ? undefined : new Error('FFmpeg could not change the stream level'));
					}
				};

				const closed = () => {
					finish(new Error('Renderer stopped before changing the stream level'));
				};

				const timer = setTimeout(() => {
					// A late, uncorrelated reply could otherwise acknowledge a later
					// setting. Fail this producer and let normal session recovery reap it.
					failure = new Error('Stream level change timed out');
					child.kill('SIGKILL');
					finish(failure);
				}, 2000);
				commandOutput.on('data', reply);
				child.once('close', closed);
				// Only validated numeric gain reaches this private command pipe.
				commandInput.write(`cvolume@master -1 volume ${gain}\n`, error => {
					if (error) {
						finish(error);
					}
				});
			});
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

function volumeGain(percent: number) {
	if (!Number.isInteger(percent) || percent < 0 || percent > 150) {
		throw new Error('Stream level must be an integer from 0 to 150');
	}

	return percent / 25;
}
