import {z} from 'zod';

export {sceneSchema, eventCategorySchema, type Scene} from './scene.js';

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	service: z.literal('soundscapes'),
	stage: z.literal('local-event-planning'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponseJsonSchema = z.toJSONSchema(healthResponseSchema, {target: 'draft-7'});

export const sessionStatusSchema = z.enum(['initializing', 'active', 'idle', 'stopped', 'error']);
export const createSessionSchema = z.strictObject({mode: z.enum(['fixture', 'ambience']), prompt: z.string().trim().min(1).max(4000).optional()});
export const sessionIdSchema = z.uuid();
export const listenerControlSchema = z.strictObject({listenerId: z.uuid()});
export const sessionSchema = z.object({
	id: sessionIdSchema,
	mode: z.enum(['fixture', 'ambience']),
	title: z.string(),
	status: sessionStatusSchema,
	ready: z.boolean(),
	rendering: z.boolean(),
	listenerCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	activeElapsedMs: z.number().nonnegative(),
	simulatedTime: z.iso.datetime(),
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
