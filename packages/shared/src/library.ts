import {z} from 'zod';
import {sceneSchema} from './scene.js';
import {generationModeSchema, layerPlanSchema} from './layers.js';

export const savedSceneSchema = z.object({
	id: z.uuid(), scene: sceneSchema, generationMode: generationModeSchema,
	layerPlan: layerPlanSchema.nullable(), savedAt: z.iso.datetime(),
});
export const sceneLibraryPageSize = 12;
export const sceneLibrarySchema = z.object({
	scenes: z.array(savedSceneSchema).max(sceneLibraryPageSize), total: z.number().int().nonnegative(),
	offset: z.number().int().nonnegative(), limit: z.literal(sceneLibraryPageSize),
});
export type SavedScene = z.infer<typeof savedSceneSchema>;

export const sceneDeletionResultSchema = z.object({
	id: z.uuid(), cleanup: z.enum(['complete', 'sessions-open', 'pending']),
	closedSessionIds: z.array(z.uuid()).default([]),
});
