import {z} from 'zod';
import {eventCategorySchema} from '@soundscapes/shared';

export const soundRequestSchema = z.strictObject({
	id: z.uuid(), sessionId: z.uuid(), kind: z.enum(['ambience', 'event']), prompt: z.string().trim().min(1).max(6000),
	durationSeconds: z.number().int().min(2).max(120), seed: z.number().int().min(0).max(2_147_483_647),
});
export type SoundRequest = z.infer<typeof soundRequestSchema>;
export const generatedAudioSchema = z.strictObject({
	id: z.uuid(), path: z.string(), model: z.enum(['stable-audio-3-small-sfx', 'stable-audio-3-small-music', 'stable-audio-3-medium']), revision: z.string().regex(/^[a-f\d]{40}$/),
	durationSeconds: z.number().positive().max(120), sampleRate: z.literal(44_100), channels: z.literal(2),
	elapsedMs: z.number().nonnegative(), loadMs: z.number().nonnegative(), resident: z.boolean().optional(), peakRssBytes: z.number().nonnegative(),
});
export type GeneratedAudio = z.infer<typeof generatedAudioSchema>;
export const soundProgressSchema = z.object({
	stage: z.enum(['loading', 'generating', 'decoding']),
	step: z.object({completed: z.number().int().min(0).max(8), total: z.literal(8)}).nullable().default(null),
});
export type SoundProgress = z.infer<typeof soundProgressSchema>;
export const workerStateSchema = z.object({pid: z.number().nullable(), loaded: z.boolean(), busy: z.boolean()});
export type SoundGenerator = {
	generate: (request: SoundRequest, signal: AbortSignal, progress?: (value: SoundProgress) => void) => Promise<GeneratedAudio>;
	close: () => Promise<void>;
	diagnostics: () => z.infer<typeof workerStateSchema>;
};
export const generationMetadataSchema = z.object({
	model: z.string().max(120), revision: z.string().max(64), seed: z.number().int(), prompt: z.string().max(6000),
	sceneKey: z.string().length(64), assetKey: z.string().length(64), createdAt: z.iso.datetime(), validation: z.literal('levels-v1'),
	variant: z.number().int().min(0).max(3).optional(), category: eventCategorySchema.optional(), elapsedMs: z.number().nonnegative(),
});
