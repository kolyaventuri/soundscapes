import {z} from 'zod';

export const eventCategorySchema = z.enum(['wind', 'leaves', 'water', 'insects', 'distant-footsteps', 'distant-wheels']);
export const sceneSchema = z.object({
	title: z.string().trim().min(1).max(120), originalPrompt: z.string().max(4000).default(''),
	description: z.string().max(1000).default(''), audioPrompt: z.string().max(650).default(''),
	location: z.string().max(200).default(''), year: z.number().int().min(1).max(9999).nullable().default(null),
	season: z.string().max(80).default(''), timeOfDay: z.string().max(80).default(''),
	weather: z.object({temperature: z.string().max(80), precipitation: z.string().max(80), wind: z.string().max(80)}).default({temperature: '', precipitation: '', wind: ''}),
	activityLevel: z.enum(['very-low', 'low', 'medium', 'high']).default('low'), sleepMode: z.boolean(),
	constraints: z.array(z.string().max(200)).max(16).default([]),
	allowedEventCategories: z.array(eventCategorySchema).max(6).default([]), simulatedStart: z.iso.datetime(),
});
export type Scene = z.infer<typeof sceneSchema>;
