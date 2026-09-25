import {z} from 'zod';

export const generationModeSchema = z.enum(['simple', 'layered']);
export const layerIdSchema = z.enum(['ambience', 'music', 'activity', 'effects']);
// Four source names (60) + captions (240) + separators need up to 1,211 characters.
// This is the compiled layer budget, not the audio model's token context length.
export const layerPromptMaxLength = 1250;
export const layerPolicySchema = z.strictObject({
	id: layerIdSchema, title: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(layerPromptMaxLength), required: z.boolean(),
	playback: z.enum(['continuous', 'gapped', 'sparse']),
	gapSeconds: z.strictObject({minimum: z.number().int().min(0).max(300), maximum: z.number().int().min(0).max(600)}),
	fadeSeconds: z.number().min(0.5).max(15), gain: z.number().min(0.05).max(1), variability: z.number().min(0).max(0.3),
	// Older saved policies retain their combined caption. New effect pools hold
	// one independently generated source per recording.
	effectSources: z.array(z.strictObject({
		prompt: z.string().trim().min(1).max(302), durationSeconds: z.number().int().min(2).max(10), gain: z.number().min(0.05).max(1),
		// Absent on older plans, which keep their original shared effects clock.
		gapSeconds: z.strictObject({minimum: z.number().int().min(20).max(300), maximum: z.number().int().min(20).max(600)}).optional(),
	})).min(1).max(4).optional(),
});
export const layerPlanSchema = z.strictObject({acoustics: z.string().trim().min(1).max(240), layers: z.array(layerPolicySchema).min(1).max(4)});
export type LayerPolicy = z.infer<typeof layerPolicySchema>;
export type LayerPlan = z.infer<typeof layerPlanSchema>;
export const layerProgressSchema = z.object({
	id: layerIdSchema, title: z.string(), description: z.string().max(layerPromptMaxLength).default(''),
	expansion: z.enum(['idle', 'expanding', 'limited']).default('idle'), required: z.boolean(), playback: z.enum(['continuous', 'gapped', 'sparse']),
	state: z.enum(['waiting', 'generating', 'ready', 'unavailable']), readyClips: z.number().int().min(0).max(6),
	initialClips: z.number().int().min(1).max(4), targetClips: z.number().int().min(1).max(6), warning: z.string().max(300).nullable(),
});
