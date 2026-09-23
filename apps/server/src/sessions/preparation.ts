import {type PreparationProgress} from '@soundscapes/shared';
import {type Store} from '../persistence/store.js';

type Task = {id: string; profile: string; startedAt?: number; done?: boolean};

// Timings contain no prompts or credentials. A new profile learns from successful
// local work; inference steps are reported separately from time-to-play estimates.
export class Preparation {
	completedBeds = 0;
	reusedBeds = 0;
	private readonly startedAt: number;
	private stageStartedAt: number;
	private stage: PreparationProgress['stage'] = 'checking';
	private step: PreparationProgress['step'] = null;
	private readonly tasks: Task[] = [];
	private active: Task | undefined;
	private planned = false;
	private finishedAt: number | undefined;
	constructor(private readonly store: Store, private readonly now: () => number, readonly totalBeds: number) {
		this.startedAt = now();
		this.stageStartedAt = now();
	}

	plan(tasks: Array<{id: string; profile: string}>, completePlan = true) {
		this.tasks.push(...tasks);
		this.planned = completePlan;
	}

	skip(id: string) {
		const task = this.tasks.find(task => task.id === id);
		if (task) {
			task.done = true;
		}
	}

	freeze() {
		this.finishedAt ??= this.now();
	}

	begin(id: string, profile: string, stage: PreparationProgress['stage']) {
		const task = this.tasks.find(task => task.id === id) ?? {id, profile};
		if (!this.tasks.includes(task)) {
			this.tasks.push(task);
		}

		task.profile = profile;
		task.startedAt = this.now();
		this.active = task;
		this.update(stage);
	}

	complete() {
		if (this.active) {
			this.store.recordTiming(this.active.profile, Math.max(0, this.now() - this.active.startedAt!));
			this.active.done = true;
			this.active = undefined;
		}
	}

	update(stage: PreparationProgress['stage'], step: PreparationProgress['step'] = null) {
		if (stage !== this.stage) {
			this.stageStartedAt = this.now();
		}

		this.stage = stage;
		this.step = step;
		if (stage === 'ready') {
			this.freeze();
		}
	}

	view(running: boolean, competingWork = false): PreparationProgress {
		const now = this.finishedAt ?? this.now();
		const base = {
			stage: this.stage, elapsedMs: Math.max(0, now - this.startedAt), stageElapsedMs: Math.max(0, now - this.stageStartedAt),
			completedBeds: this.completedBeds, reusedBeds: this.reusedBeds, totalBeds: this.totalBeds, step: this.step,
		};
		const unknown = (estimateReason: PreparationProgress['estimateReason']): PreparationProgress => ({...base, estimate: null, estimateReason});
		if (this.stage === 'ready') {
			return unknown('ready');
		}

		if (!running) {
			return unknown('paused');
		}

		if (competingWork || this.stage === 'queued') {
			return unknown('queue');
		}

		if (!this.planned) {
			return unknown('learning');
		}

		let lowerMs = 0;
		let upperMs = 0;
		for (const task of this.tasks.filter(task => !task.done)) {
			const samples = this.store.timings(task.profile);
			if (samples.length === 0) {
				return unknown('learning');
			}

			const elapsed = task.startedAt === undefined ? 0 : Math.max(0, now - task.startedAt);
			// Broad empirical range, not a deadline or a percent-complete countdown.
			const upper = Math.max(...samples) * 1.6;
			if (elapsed >= upper) {
				return unknown('overrun');
			}

			lowerMs += Math.max(0, (Math.min(...samples) * 0.65) - elapsed);
			upperMs += upper - elapsed;
		}

		return upperMs > 0 ? {...base, estimate: {lowerMs, upperMs}, estimateReason: 'measured'} : unknown('learning');
	}
}
