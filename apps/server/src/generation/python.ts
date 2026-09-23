import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir, access} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {z} from 'zod';
import {type AppConfig} from '../config.js';
import {abortable} from '../planning/controller.js';
import {
	generatedAudioSchema, soundRequestSchema, type GeneratedAudio, type SoundGenerator, type SoundRequest,
} from './contracts.js';

const responseSchema = z.discriminatedUnion('type', [
	z.object({type: z.literal('ready'), protocol: z.literal(1), network: z.literal('disabled')}),
	z.object({type: z.literal('result'), audio: generatedAudioSchema}),
	z.object({type: z.literal('error'), id: z.string().optional().nullable(), message: z.string().max(2000)}),
]);

export class PythonSoundGenerator implements SoundGenerator {
	private child: ChildProcessWithoutNullStreams | undefined;
	private exited: Promise<void> = Promise.resolve();
	private readiness: ReturnType<typeof readiness> | undefined;
	private pending: {id: string; resolve: (audio: GeneratedAudio) => void; reject: (error: Error) => void} | undefined;
	private loaded = false;
	private busy = false;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private stderr = '';
	constructor(private readonly config: AppConfig['sound']) {}

	diagnostics() {
		return {pid: this.child?.pid ?? null, loaded: this.loaded, busy: this.busy};
	}

	async generate(request: SoundRequest, cancellation: AbortSignal): Promise<GeneratedAudio> {
		soundRequestSchema.parse(request);
		if (this.busy) {
			throw new Error('Sound worker accepts only one request at a time');
		}

		this.busy = true;
		clearTimeout(this.idleTimer);
		const signal = AbortSignal.any([cancellation, AbortSignal.timeout(this.config.timeoutMs)]);
		try {
			signal.throwIfAborted();
			await this.start();
			await abortable(this.readiness!.promise, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
			signal.throwIfAborted();
			const result = new Promise<GeneratedAudio>((resolve, reject) => {
				this.pending = {id: request.id, resolve, reject};
				this.child!.stdin.write(`${JSON.stringify(request)}\n`, error => {
					if (error) {
						reject(error);
					}
				});
			});
			const audio = await abortable(result, signal);
			if (audio.path !== path.join(this.config.output, `${request.id}.wav`) || audio.durationSeconds !== request.durationSeconds) {
				throw new Error('Sound worker returned an unexpected file or duration');
			}

			this.loaded = true;
			return audio;
		} catch (error) {
			await this.close(); // Reap inference before allowing the next queue item or file cleanup.
			throw error;
		} finally {
			this.pending = undefined;
			this.busy = false;
			if (this.child) {
				this.idleTimer = setTimeout(() => {
					void this.close();
				}, this.config.idleUnloadMs);
				this.idleTimer.unref();
			}
		}
	}

	async close() {
		clearTimeout(this.idleTimer);
		const {child} = this;
		if (child) {
			child.kill('SIGKILL');
			await this.exited;
		}
	}

	private async start() {
		await this.exitedIfStopping();
		if (this.child) {
			return;
		}

		try {
			await Promise.all([access(this.config.python), access(this.config.manifest)]);
		} catch {
			throw new Error('Sound model is not installed. Follow README and run pnpm sound:setup.');
		}

		await mkdir(this.config.output, {recursive: true});
		this.stderr = '';
		this.readiness = readiness();
		const child = spawn(this.config.python, [this.config.worker], {
			stdio: ['pipe', 'pipe', 'pipe'],
			// Never pass the setup token, provider credentials, or the application's environment.
			env: {
				PATH: process.env.PATH, HOME: process.env.HOME, PYTHONUNBUFFERED: '1',
				HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
				SOUNDSCAPES_SOUND_MANIFEST: this.config.manifest, SOUNDSCAPES_SOUND_OUTPUT: this.config.output, SOUNDSCAPES_SOUND_DEVICE: this.config.device,
			},
		});
		this.child = child;
		this.exited = new Promise(resolve => {
			child.once('close', (code, signal) => {
				this.child = undefined;
				this.loaded = false;
				const error = new Error(`Sound worker exited (${code ?? signal}): ${this.stderr.slice(-1500)}`);
				this.readiness?.reject(error);
				this.pending?.reject(error);
				resolve();
			});
		});
		child.on('error', error => {
			this.readiness?.reject(error);
			this.pending?.reject(error);
		});
		child.stderr.on('data', (chunk: Uint8Array) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-4000);
		});
		let buffer = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			try {
				buffer += chunk;
				if (buffer.length > 32_768) {
					throw new Error('Sound worker exceeded the protocol size limit');
				}

				let newline = buffer.indexOf('\n');
				while (newline >= 0) {
					const message = responseSchema.parse(JSON.parse(buffer.slice(0, newline)));
					buffer = buffer.slice(newline + 1);
					if (message.type === 'ready') {
						this.readiness?.resolve();
					} else if (message.type === 'error') {
						this.pending?.reject(new Error(message.message));
					} else if (message.audio.id === this.pending?.id) {
						this.pending.resolve(message.audio);
					} else {
						throw new Error('Unexpected sound worker result');
					}

					newline = buffer.indexOf('\n');
				}
			} catch (error) {
				this.readiness?.reject(error);
				this.pending?.reject(error as Error);
				child.kill('SIGKILL');
			}
		});
	}

	private async exitedIfStopping() {
		if (this.child?.killed) {
			await this.exited;
		}
	}
}

function readiness() {
	let fulfill!: () => void;
	let fail!: (error: unknown) => void;
	const promise = new Promise<void>((resolve, reject) => {
		fulfill = resolve;
		fail = reject;
	});
	return {promise, resolve: fulfill, reject: fail};
}
