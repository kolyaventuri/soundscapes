import {z} from 'zod';
import {eventCategorySchema, type Scene} from '@soundscapes/shared';

export const eventProposalSchema = z.strictObject({
	event: z.string().trim().min(1).max(500).nullable(), assetId: z.uuid().nullable(), category: eventCategorySchema.nullable(),
	durationSeconds: z.number().min(0).max(30).nullable(), prominence: z.number().min(0).max(0.2).nullable(), reason: z.string().max(500),
});
export type EventProposal = z.infer<typeof eventProposalSchema>;
export const planningStateSchema = z.object({nextOpportunityMs: z.number().nonnegative().nullable(), opportunities: z.number().int().nonnegative(), skipped: z.number().int().nonnegative()});
export type PlanningState = z.infer<typeof planningStateSchema>;
export const scheduledEventSchema = z.object({
	id: z.uuid(), assetId: z.uuid(), description: z.string().max(500), category: eventCategorySchema,
	startMs: z.number().nonnegative(), durationMs: z.number().min(2000).max(30_000), gain: z.number().min(0).max(0.5),
	fadeMs: z.number().min(500).max(3000), pan: z.number().min(-0.2).max(0.2), lowpassHz: z.number().min(1500).max(6000),
	prominence: z.number().min(0).max(0.2), simulatedTime: z.iso.datetime(),
});
export type ScheduledEvent = z.infer<typeof scheduledEventSchema>;
export type LibraryEntry = {id: string; title: string; category: z.infer<typeof eventCategorySchema>; durationSeconds: number; tags: string[]};
export type PlannerContext = {
	scene: Scene; simulatedTime: string; elapsedMs: number; ambientState: string[]; recentEvents: ScheduledEvent[];
	library: LibraryEntry[]; earliestPlaybackMs: number; canGenerate?: boolean;
};
export type Planner = {
	parseScene: (prompt: string, signal: AbortSignal) => Promise<Scene>;
	propose: (context: PlannerContext, signal: AbortSignal) => Promise<EventProposal>;
	readonly busy: boolean;
};

export const delayBucketsSchema = z.array(z.object({weight: z.number().positive().max(1), minimumSeconds: z.number().min(1).max(3600), maximumSeconds: z.number().min(1).max(3600)}))
	.min(1).max(8).refine(buckets => Math.abs(buckets.reduce((sum, bucket) => sum + bucket.weight, 0) - 1) < 0.000_001 && buckets.every(bucket => bucket.maximumSeconds >= bucket.minimumSeconds));
export const defaultDelayBuckets = [
	{weight: 0.2, minimumSeconds: 60, maximumSeconds: 120},
	{weight: 0.45, minimumSeconds: 120, maximumSeconds: 300},
	{weight: 0.25, minimumSeconds: 300, maximumSeconds: 600},
	{weight: 0.1, minimumSeconds: 600, maximumSeconds: 900},
];
export function nextOpportunityDelay(random = Math.random, scale = 1, buckets = defaultDelayBuckets) {
	const draw = random();
	let cumulative = 0;
	const {minimumSeconds: minimum, maximumSeconds: maximum} = buckets.find(bucket => {
		cumulative += bucket.weight;
		return draw < cumulative;
	}) ?? buckets.at(-1)!;
	return Math.round((minimum + (random() * (maximum - minimum))) * 1000 * scale);
}

export const hardConstraints = [
	'No intelligible speech or music',
	'No explosions, screaming, gunfire, crashes, alarms, sirens, horns or sharp impacts',
	'No sudden nearby animals or dramatic weather changes',
	'Only subtle, distant environmental sounds; no change to the weather',
];
// eslint-disable-next-line @stylistic/max-len -- Keep the auditable exclusion expression intact.
const unsafe = /\b(explos\w*|scream\w*|gun\w*|crash\w*|alarm\w*|siren\w*|horn\w*|bang\w*|slam\w*|thunder\w*|storm\w*|shout\w*|speech|conversation\w*|voice\w*|speak\w*|music|bark\w*|roar\w*|sudden|sharp|loud|nearby)\b/i;
export function unsafeDescription(text: string) {
	return unsafe.test(text);
}
