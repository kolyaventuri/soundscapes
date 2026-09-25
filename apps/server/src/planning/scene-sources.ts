import {z} from 'zod';
import {eventCategorySchema} from '@soundscapes/shared';

// One inventory supplies both captions, preventing a separate bed summary from
// silently dropping requested ongoing sounds. Eight 80-character captions fit 650.
export const sceneSourcesSchema = z.array(z.strictObject({
	caption: z.string().trim().min(1).max(80),
	timing: z.enum(['ongoing', 'occasional']),
	category: eventCategorySchema.or(z.literal('none')),
})).min(1).max(8);

export function compileSceneSources(value: unknown) {
	const sources = sceneSourcesSchema.parse(value);
	return {
		audioPrompt: sources.map(source => source.caption).join(' '),
		ambiencePrompt: sources.filter(source => source.timing === 'ongoing').map(source => source.caption).join(' ') || 'Faint steady air in a quiet acoustic space.',
		allowedEventCategories: [...new Set(sources.flatMap(source => source.category === 'none' ? [] : [source.category]))],
	};
}
