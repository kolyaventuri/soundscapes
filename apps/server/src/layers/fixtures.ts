import {type LayerPlan} from '@soundscapes/shared';

// Synthetic regression policy, never used by production scene planning.
export const testPlan: LayerPlan = {
	acoustics: 'A warm small room, sounds heard naturally from a table.',
	layers: [
		{
			id: 'ambience', title: 'Room', prompt: 'Air in a quiet room, no music or voices.', required: true,
			playback: 'continuous', gapSeconds: {minimum: 0, maximum: 0}, fadeSeconds: 15, gain: 0.6, variability: 0.05,
		},
		{
			id: 'music', title: 'Jazz', prompt: 'Soft jazz piano alone in the room.', required: true,
			playback: 'continuous', gapSeconds: {minimum: 0, maximum: 0}, fadeSeconds: 2, gain: 0.8, variability: 0.04,
		},
		{
			id: 'activity', title: 'Crowd', prompt: 'Indistinct conversation without music.', required: false,
			playback: 'continuous', gapSeconds: {minimum: 0, maximum: 0}, fadeSeconds: 10, gain: 0.4, variability: 0.1,
		},
		{
			id: 'effects', title: 'Cups', prompt: 'One gently set down cup.', required: false,
			playback: 'sparse', gapSeconds: {minimum: 40, maximum: 120}, fadeSeconds: 1, gain: 0.2, variability: 0.2,
			effectSources: [
				{prompt: 'One gently set down cup.', durationSeconds: 3, gain: 0.2},
				{prompt: 'One brief espresso steam hiss.', durationSeconds: 6, gain: 0.1},
			],
		},
	],
};
