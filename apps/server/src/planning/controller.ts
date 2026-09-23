
import {randomUUID} from 'node:crypto';
import {type Scene} from '@soundscapes/shared';
import {type Asset} from '../persistence/store.js';
import {
	eventProposalSchema, nextOpportunityDelay, unsafeDescription, type defaultDelayBuckets, type Planner, type PlannerContext, type ScheduledEvent, type PlanningState, type EventProposal,
} from './contracts.js';

export type {PlanningState} from './contracts.js';
type Options = {
	state: PlanningState; planner: Planner; skipProbability: number; delayScale: number; timeoutMs: number; random?: () => number;
	delayBuckets?: typeof defaultDelayBuckets;
	context: () => PlannerContext; assets: () => Asset[]; active: () => boolean;
	schedule: (event: Omit<ScheduledEvent, 'startMs' | 'simulatedTime'>, signal: AbortSignal, deadlinePlaybackMs: number) => Promise<ScheduledEvent | undefined>;
	generate?: (proposal: EventProposal, signal: AbortSignal, deadlineAt: number) => Promise<Asset>;
	changed: () => void; log: (event: string, detail?: string) => void;
};

export function eligibleAssets(assets: Asset[], scene: Scene, history: ScheduledEvent[], elapsedMs: number) {
	const recent = history.filter(event => event.startMs + event.durationMs >= elapsedMs - (30 * 60_000));
	return assets.filter(asset => asset.kind === 'event' && asset.event && (asset.event.reviewedSleepSafe || asset.generation?.validation === 'levels-v1')
		&& scene.allowedEventCategories.includes(asset.event.category)
		&& !unsafeDescription(`${asset.title} ${asset.event.tags.join(' ')}`)
		&& !recent.some(event => event.assetId === asset.id || (event.category === asset.event!.category && event.startMs >= elapsedMs - (10 * 60_000))));
}

export class EventController {
	private readonly random: () => number;
	private pending: AbortController | undefined;
	private job: Promise<void> | undefined;
	constructor(private readonly options: Options) {
		this.random = options.random ?? Math.random;
	}

	get busy() {
		return this.pending !== undefined;
	}

	tick(elapsedMs: number) {
		const {state} = this.options;
		if (!this.options.active()) {
			this.cancel();
			return;
		}

		if (state.nextOpportunityMs === null) {
			state.nextOpportunityMs = elapsedMs + nextOpportunityDelay(this.random, this.options.delayScale, this.options.delayBuckets);
			this.options.changed();
		}

		if (this.pending !== undefined || elapsedMs < state.nextOpportunityMs) {
			return;
		}

		// Advance independently of model results. Missed opportunities are not replayed.
		state.nextOpportunityMs = elapsedMs + nextOpportunityDelay(this.random, this.options.delayScale, this.options.delayBuckets);
		state.opportunities++;
		this.options.changed();
		this.options.log('event-opportunity');
		if (this.random() < this.options.skipProbability || this.options.planner.busy) {
			this.skip('Intentional skip or planner already occupied');
			return;
		}

		const abort = new AbortController();
		this.pending = abort;
		this.job = (async () => {
			try {
				await this.plan(abort);
			} finally {
				if (this.pending === abort) {
					this.pending = undefined;
				}
			}
		})();
	}

	cancel() {
		this.pending?.abort();
	}

	async settled() {
		await this.job;
	}

	private skip(reason: string) {
		this.options.state.skipped++;
		this.options.log('event-skipped', reason);
		this.options.changed();
	}

	private async plan(abort: AbortController) {
		const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.options.generate ? 90_000 : this.options.timeoutMs)]);
		const deadlineAt = Date.now() + 90_000;
		try {
			const context = this.options.context();
			const eligible = eligibleAssets(this.options.assets(), context.scene, context.recentEvents, context.elapsedMs);
			context.library = eligible.map(asset => ({
				id: asset.id, title: asset.title, category: asset.event!.category, durationSeconds: asset.durationMs / 1000, tags: asset.event!.tags,
			}));
			// Race even adapters that fail to honor cancellation; late results are never applied.
			const planningSignal = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]);
			const proposal = eventProposalSchema.parse(await abortable(this.options.planner.propose(context, planningSignal), planningSignal));
			if (signal.aborted || !this.options.active()) {
				return;
			}

			if (proposal.event === null) {
				this.skip(`Planner chose null: ${proposal.reason}`);
				return;
			}

			if (invalidProposal(proposal, context)) {
				this.skip('Proposal rejected by context, repetition or sleep-mode rules');
				return;
			}

			let asset = eligible.find(asset => asset.id === proposal.assetId);
			if (!asset && proposal.assetId === null && this.options.generate) {
				asset = await abortable(this.options.generate(proposal, signal, deadlineAt), signal);
			}

			if (!asset || proposal.category !== asset.event?.category || proposal.durationSeconds! * 1000 > asset.durationMs
				|| eligibleAssets([asset], context.scene, context.recentEvents, context.elapsedMs).length === 0) {
				this.skip('Proposal rejected by library or duration rules');
				return;
			}

			signal.throwIfAborted();
			if (!this.options.active()) {
				return;
			}

			const scheduled = await this.options.schedule({
				id: randomUUID(), assetId: asset.id, description: proposal.event, category: asset.event.category,
				durationMs: Math.round(proposal.durationSeconds! * 1000), prominence: proposal.prominence!,
				gain: Math.min(0.5, 0.15 + proposal.prominence!), fadeMs: 1000, pan: (this.random() - 0.5) * 0.3, lowpassHz: 3500,
			}, signal, context.earliestPlaybackMs + 60_000);
			if (scheduled) {
				this.options.log('event-scheduled', `${asset.title} at ${scheduled.startMs}ms`);
			} else {
				this.skip('No mutable future slot; result discarded');
			}
		} catch (error) {
			if (!abort.signal.aborted) {
				this.skip(`Planner failed or timed out: ${String(error).slice(0, 500)}`);
			}
		}
	}
}

export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	let listener: () => void = () => undefined;
	try {
		return await Promise.race([promise, new Promise<never>((resolve, reject) => {
			listener = () => {
				reject(signal.reason as Error);
			};

			signal.addEventListener('abort', listener, {once: true});
			if (signal.aborted) {
				listener();
			}
		})]);
	} finally {
		signal.removeEventListener('abort', listener);
	}
}

function invalidProposal(proposal: EventProposal, context: PlannerContext) {
	return !proposal.category || !context.scene.allowedEventCategories.includes(proposal.category) || proposal.durationSeconds === null
		|| proposal.durationSeconds < 2 || proposal.prominence === null || !proposal.event || unsafeDescription(proposal.event)
		|| context.recentEvents.some(event => event.category === proposal.category && event.startMs >= context.elapsedMs - 600_000);
}
