import {z} from 'zod';

export const generationModeSchema = z.enum(['simple', 'layered']);
export const layerIdSchema = z.enum(['ambience', 'music', 'activity', 'effects']);
export const layerPolicySchema = z.strictObject({
	id: layerIdSchema, title: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(500), required: z.boolean(),
	playback: z.enum(['continuous', 'gapped', 'sparse']),
	gapSeconds: z.strictObject({minimum: z.number().int().min(0).max(300), maximum: z.number().int().min(0).max(600)}),
	fadeSeconds: z.number().min(0.5).max(15), gain: z.number().min(0.05).max(1), variability: z.number().min(0).max(0.3),
});
export const layerPlanSchema = z.strictObject({acoustics: z.string().trim().min(1).max(240), layers: z.array(layerPolicySchema).min(1).max(4)});
export type LayerPolicy = z.infer<typeof layerPolicySchema>;
export type LayerPlan = z.infer<typeof layerPlanSchema>;
export const layerProgressSchema = z.object({
	id: layerIdSchema, title: z.string(), required: z.boolean(), playback: z.enum(['continuous', 'gapped', 'sparse']),
	state: z.enum(['waiting', 'generating', 'ready', 'unavailable']), readyClips: z.number().int().min(0).max(6),
	initialClips: z.number().int().min(1).max(4), targetClips: z.number().int().min(1).max(6), warning: z.string().max(300).nullable(),
});
