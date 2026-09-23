import {z} from 'zod';

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	service: z.literal('soundscapes'),
	stage: z.literal('scaffolding'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponseJsonSchema = z.toJSONSchema(healthResponseSchema);
