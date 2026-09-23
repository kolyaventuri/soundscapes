import {type GeneratedAudio, type SoundGenerator, type SoundRequest} from './contracts.js';

type Job = {
	request: SoundRequest; signal: AbortSignal; valid: () => boolean; deadlineAt: number;
	resolve: (audio: GeneratedAudio) => void; reject: (error: unknown) => void; removeAbort: () => void;
};

export class GenerationQueue {
	private readonly waiting: Job[] = [];
	private active: Job | undefined;
	private abort: AbortController | undefined;
	private closing = false;
	private task: Promise<void> | undefined;
	constructor(private readonly generator: SoundGenerator, private readonly now = Date.now, private readonly capacity = 8) {}

	get jobs() {
		return [...this.active ? [this.active] : [], ...this.waiting].map(job => ({
			id: job.request.id, sessionId: job.request.sessionId, kind: job.request.kind, state: job === this.active ? 'running' : 'queued', deadlineAt: job.deadlineAt,
		}));
	}

	async submit(request: SoundRequest, {signal, valid, deadlineAt}: {signal: AbortSignal; valid: () => boolean; deadlineAt: number}) {
		if (this.closing || signal.aborted || !valid() || deadlineAt <= this.now()) {
			throw new Error('Sound request is cancelled, idle, or past its deadline');
		}

		if (this.waiting.length + Number(Boolean(this.active)) >= this.capacity) {
			throw new Error('Sound generation queue is full');
		}

		return new Promise<GeneratedAudio>((resolve, reject) => {
			const job: Job = {
				request, signal, valid, deadlineAt, resolve, reject, removeAbort() {
					signal.removeEventListener('abort', cancel);
				},
			};
			const cancel = () => {
				if (this.active === job) {
					this.abort?.abort(signal.reason);
				} else {
					const index = this.waiting.indexOf(job);
					if (index !== -1) {
						this.waiting.splice(index, 1);
					}

					job.removeAbort();
					reject(signal.reason as Error);
				}
			};

			signal.addEventListener('abort', cancel, {once: true});
			this.waiting.push(job);
			this.drain();
		});
	}

	async close() {
		this.closing = true;
		this.abort?.abort();
		for (const job of this.waiting.splice(0)) {
			job.removeAbort();
			job.reject(new Error('Sound queue shut down'));
		}

		await this.generator.close();
		await this.task;
	}

	private drain() {
		if (this.active !== undefined || this.closing) {
			return;
		}

		// Stable sort preserves FIFO within each priority, without preempting inference.
		this.waiting.sort((left, right) => Number(left.request.kind === 'event') - Number(right.request.kind === 'event'));
		const job = this.waiting.shift();
		if (!job) {
			return;
		}

		this.active = job;
		const abort = new AbortController();
		this.abort = abort;
		this.task = (async () => {
			await Promise.resolve();
			try {
				if (job.signal.aborted || !job.valid() || job.deadlineAt <= this.now()) {
					throw new Error('Sound request expired before dispatch');
				}

				const signal = AbortSignal.any([job.signal, abort.signal, AbortSignal.timeout(Math.max(1, Math.ceil(job.deadlineAt - this.now())))]);
				const audio = await this.generator.generate(job.request, signal);
				signal.throwIfAborted();
				if (!job.valid() || job.deadlineAt <= this.now()) {
					throw new Error('Stale sound result discarded');
				}

				job.resolve(audio);
			} catch (error) {
				job.reject(error);
			} finally {
				job.removeAbort();
				this.active = undefined;
				this.abort = undefined;
				this.drain();
			}
		})();
	}
}
