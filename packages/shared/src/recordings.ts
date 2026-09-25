import {z} from 'zod';

export const startRecordingSchema = z.strictObject({
	sessionId: z.uuid(), minutes: z.union([z.literal(5), z.literal(480)]), device: z.string().trim().max(500),
	client: z.string().max(500).optional(),
});
export const recordingSchema = z.object({
	id: z.uuid(), sessionId: z.uuid(), title: z.string().max(200), device: z.string().max(500),
	startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), minutes: z.union([z.literal(5), z.literal(480)]),
	state: z.enum(['recording', 'completed', 'interrupted', 'failed']), elapsedSeconds: z.number().nonnegative(),
	samples: z.number().int().nonnegative(), completeSamples: z.number().int().nonnegative(),
	issues: z.array(z.object({code: z.string().max(100), count: z.number().int().positive(), detail: z.string().max(1000)})).max(64),
	metrics: z.array(z.object({
		name: z.string().max(100), first: z.number(), last: z.number(), minimum: z.number(), maximum: z.number(), mean: z.number(),
	})).max(100),
	inference: z.object({
		plannerCalls: z.number().int().nonnegative(), generatedRecordings: z.number().int().nonnegative(), cacheReuses: z.number().int().nonnegative(), failures: z.number().int().nonnegative(),
	}),
});
export const recordingListSchema = z.object({recordings: z.array(recordingSchema).max(20)});
export type Recording = z.infer<typeof recordingSchema>;
export type StartRecording = z.infer<typeof startRecordingSchema>;
