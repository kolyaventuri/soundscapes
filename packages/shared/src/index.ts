import {z} from 'zod';

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	service: z.literal('soundscapes'),
	stage: z.literal('static-streaming'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponseJsonSchema = z.toJSONSchema(healthResponseSchema, {target: 'draft-7'});

export const sessionStatusSchema = z.enum(['initializing', 'active', 'idle', 'stopped', 'error']);
export const createSessionSchema = z.strictObject({mode: z.literal('fixture')});
export const sessionIdSchema = z.uuid();
export const listenerControlSchema = z.strictObject({listenerId: z.uuid()});
export const sessionSchema = z.object({
	id: sessionIdSchema,
	mode: z.literal('fixture'),
	title: z.string(),
	status: sessionStatusSchema,
	ready: z.boolean(),
	rendering: z.boolean(),
	listenerCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	activeElapsedMs: z.number().nonnegative(),
	error: z.string().optional(),
});
export const listenerSessionSchema = z.object({
	session: sessionSchema,
	listenerId: z.uuid(),
	streamUrl: z.string(),
});
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type ListenerSession = z.infer<typeof listenerSessionSchema>;
