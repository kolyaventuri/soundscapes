import {z} from 'zod';
import {type LayerPolicy} from '@soundscapes/shared';
import {validatePlan} from '../layers/timeline.js';

// Keep the model focused on audible content. Acoustic context is closed
// vocabulary so it cannot reintroduce all the other sources into every stem.
const sourceSchema = z.strictObject({
	name: z.string().trim().min(1).max(60), caption: z.string().trim().min(1).max(240),
	prominence: z.enum(['primary', 'background', 'distant']),
});
type Source = z.infer<typeof sourceSchema>;
const passageSchema = sourceSchema.extend({continuity: z.enum(['ongoing', 'occasional'])});
export const layerSourcesSchema = z.strictObject({
	space: z.enum(['open-air', 'small-room', 'large-room']),
	continuousEnvironment: z.array(sourceSchema).max(4), music: passageSchema.nullable(), humanActivity: passageSchema.nullable(),
	occasionalEffects: z.array(sourceSchema).max(4),
});

const acoustics = {
	'open-air': 'Open-air stereo recording, little reverberation.',
	'small-room': 'Natural stereo recording with short room reflections.',
	'large-room': 'Natural stereo recording with spacious reverberation.',
};

function sourcePolicy(id: LayerPolicy['id'], sources: Source[], continuous: boolean): LayerPolicy {
	return {
		id, title: sources.map(source => source.name).join(' · ').slice(0, 80) || 'Quiet acoustic space',
		// The shared layer budget accommodates all four bounded sources without truncation.
		prompt: sources.map(source => `${source.name}. ${source.caption}`).join(' ') || 'Faint steady air in a quiet acoustic space.',
		required: id !== 'effects', playback: continuous ? 'continuous' : (id === 'effects' ? 'sparse' : 'gapped'),
		gapSeconds: continuous ? {minimum: 0, maximum: 0} : (id === 'effects' ? {minimum: 45, maximum: 120} : {minimum: 15, maximum: 45}),
		fadeSeconds: id === 'music' ? 3 : (id === 'effects' ? 1 : 10),
		gain: sources.length === 0 ? 0.12 : Math.max(...sources.map(source => ({primary: 1, background: 0.7, distant: 0.45})[source.prominence])),
		variability: id === 'effects' ? 0.15 : 0.08,
	};
}

export function compileLayerSources(value: unknown) {
	const inventory = layerSourcesSchema.parse(value);
	const groups = {
		ambience: inventory.continuousEnvironment,
		music: inventory.music ? [inventory.music] : [],
		activity: inventory.humanActivity ? [inventory.humanActivity] : [],
		effects: inventory.occasionalEffects,
	};
	const layers: LayerPolicy[] = [];
	for (const id of ['ambience', 'music', 'activity', 'effects'] as const) {
		const sources = groups[id];
		if (id !== 'ambience' && sources.length === 0) {
			continue;
		}

		const continuous = id === 'ambience' || (id === 'music' && inventory.music?.continuity === 'ongoing')
			|| (id === 'activity' && inventory.humanActivity?.continuity === 'ongoing');
		layers.push(sourcePolicy(id, sources, continuous));
	}

	return validatePlan({acoustics: acoustics[inventory.space], layers});
}
