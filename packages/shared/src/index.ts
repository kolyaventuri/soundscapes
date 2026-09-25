import {z} from 'zod';
import {sceneSchema} from './scene.js';
import {generationModeSchema, layerProgressSchema} from './layers.js';

export {
	generationModeSchema, layerIdSchema, layerPlanSchema, layerPolicySchema, layerProgressSchema, type LayerPlan, type LayerPolicy,
} from './layers.js';

export {
	savedSceneSchema, sceneLibrarySchema, sceneLibraryPageSize, type SavedScene,
} from './library.js';

export {
	startRecordingSchema, recordingSchema, recordingListSchema, type Recording, type StartRecording,
} from './recordings.js';

export {sceneSchema, eventCategorySchema, type Scene} from './scene.js';

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	service: z.literal('soundscapes'),
	stage: z.literal('local-event-planning'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponseJsonSchema = z.toJSONSchema(healthResponseSchema, {target: 'draft-7'});

export const sessionStatusSchema = z.enum(['initializing', 'active', 'idle', 'stopped', 'error']);
export const createSessionSchema = z.strictObject({
	mode: z.enum(['fixture', 'ambience']), prompt: z.string().trim().min(1).max(4000).optional(), sleepMode: z.boolean().optional(), generationMode: generationModeSchema.optional(),
});
export const sessionIdSchema = z.uuid();
export const listenerControlSchema = z.strictObject({listenerId: z.uuid()});
export const volumePercentSchema = z.number().int().min(0).max(150);
export const volumeControlSchema = listenerControlSchema.extend({volumePercent: volumePercentSchema});
export const preparationProgressSchema = z.object({
	stage: z.enum(['understanding', 'checking', 'queued', 'loading', 'generating', 'decoding', 'validating', 'buffering', 'ready']),
	elapsedMs: z.number().nonnegative(), stageElapsedMs: z.number().nonnegative(),
	completedBeds: z.number().int().min(0).max(16), totalBeds: z.number().int().min(0).max(16), reusedBeds: z.number().int().min(0).max(16),
	step: z.object({completed: z.number().int().nonnegative(), total: z.number().int().positive()}).nullable(),
	estimate: z.object({lowerMs: z.number().nonnegative(), upperMs: z.number().positive()}).nullable(),
	estimateReason: z.enum(['measured', 'learning', 'queue', 'overrun', 'paused', 'ready']),
});
export type PreparationProgress = z.infer<typeof preparationProgressSchema>;
export const sessionSchema = z.object({
	id: sessionIdSchema,
	mode: z.enum(['fixture', 'ambience']),
	title: z.string(),
	status: sessionStatusSchema,
	audioSource: z.enum(['fixture', 'generated']).default('fixture'),
	preparation: z.string().default(''),
	volumePercent: volumePercentSchema.default(100),
	generationMode: generationModeSchema.default('simple'), layers: z.array(layerProgressSchema).max(4).default([]),
	recentEvents: z.array(z.object({description: z.string(), simulatedTime: z.iso.datetime()})).max(3).default([]),
	progress: preparationProgressSchema.nullable().default(null),
	scene: sceneSchema.nullable().default(null),
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
export const sessionLimit = 4;
export const sessionSummarySchema = sessionSchema.pick({
	id: true, title: true, status: true, ready: true, listenerCount: true, createdAt: true, generationMode: true, error: true,
});
export const sessionListSchema = z.object({sessions: z.array(sessionSummarySchema).max(sessionLimit), limit: z.literal(sessionLimit)});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type ListenerSession = z.infer<typeof listenerSessionSchema>;
