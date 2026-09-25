import {z} from 'zod';
import {type LayerPolicy} from '@soundscapes/shared';
import {validatePlan} from '../layers/timeline.js';
import {excludesSound} from './scene-constraints.js';

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
	occasionalEffects: z.array(sourceSchema.extend({
		durationSeconds: z.number().int().min(2).max(10).default(4), frequency: z.enum(['rare', 'occasional', 'frequent']).default('occasional'),
	})).max(4),
});

const acoustics = {
	'open-air': 'Open-air stereo recording, little reverberation.',
	'small-room': 'Natural stereo recording with short room reflections.',
	'large-room': 'Natural stereo recording with spacious reverberation.',
};

function sourceGain(id: LayerPolicy['id'], source: Source) {
	// Broad environmental beds mask diners even when ordered correctly. Keep
	// music/activity balance intact while giving background environment depth.
	return (id === 'ambience' ? {primary: 1, background: 0.4, distant: 0.2} : {primary: 1, background: 0.7, distant: 0.45})[source.prominence];
}

function sourcePolicy(id: LayerPolicy['id'], sources: Source[], continuous: boolean): LayerPolicy {
	return {
		id, title: sources.map(source => source.name).join(' · ').slice(0, 80) || 'Quiet acoustic space',
		// The shared layer budget accommodates all four bounded sources without truncation.
		prompt: sources.map(source => `${source.name}. ${source.caption}`).join(' ') || 'Faint steady air in a quiet acoustic space.',
		required: id !== 'effects', playback: continuous ? 'continuous' : (id === 'effects' ? 'sparse' : 'gapped'),
		gapSeconds: continuous ? {minimum: 0, maximum: 0} : (id === 'effects' ? {minimum: 45, maximum: 120} : {minimum: 15, maximum: 45}),
		fadeSeconds: id === 'music' ? 3 : (id === 'effects' ? 1 : 10),
		gain: sources.length === 0 ? 0.12 : Math.max(...sources.map(source => sourceGain(id, source))),
		variability: id === 'effects' ? 0.15 : 0.08,
	};
}

export function compileLayerSources(value: unknown, prompt = '') {
	const inventory = layerSourcesSchema.parse(value);
	const permitted = (source: Source) => !excludesSound(prompt, `${source.name}. ${source.caption}`);
	inventory.continuousEnvironment = inventory.continuousEnvironment.filter(source => permitted(source));
	inventory.occasionalEffects = inventory.occasionalEffects.filter(source => permitted(source));
	if (inventory.music && !permitted(inventory.music)) {
		inventory.music = null;
	}

	if (inventory.humanActivity && !permitted(inventory.humanActivity)) {
		inventory.humanActivity = null;
	}

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
		const policy = sourcePolicy(id, sources, continuous);
		if (id === 'effects') {
			policy.effectSources = inventory.occasionalEffects.map(source => ({
				prompt: `${source.name}. ${source.caption}`, durationSeconds: source.durationSeconds, gain: sourceGain(id, source),
				gapSeconds: {
					rare: {minimum: 180, maximum: 420}, occasional: {minimum: 45, maximum: 120}, frequent: {minimum: 20, maximum: 45},
				}[source.frequency],
			}));
		}

		layers.push(policy);
	}

	return validatePlan({acoustics: acoustics[inventory.space], layers});
}
