import assert from 'node:assert/strict';
import {sceneSchema} from '@soundscapes/shared';
import {generationAssetKey, layerSoundPrompt} from '../generation/service.js';
import {type OllamaPlanner} from '../planning/ollama.js';

export async function checkCrowdPerspective(planner: OllamaPlanner, signal: AbortSignal) {
	const cases = [
		{
			id: 'cafe', prompt: 'Seated inside a relaxed cafe with a small speaker playing instrumental acoustic jazz: piano, upright bass, and brushed drums. '
				+ 'The music plays continuously at a modest background level beneath soft customer conversation and occasional cup clinks. No singing, applause, or outdoor sounds.',
			distance: /across the room|\b(?:metres|meters|distance|distant)\b/i,
		},
		{
			id: 'outdoor', prompt: 'At an outdoor market, a group of shoppers have quiet overlapping conversations several metres away. No music.',
			distance: /\b(?:metres|meters|distance|distant)\b/i,
		},
		{
			id: 'nearby', prompt: 'One person beside me continuously tells a story in a quiet whisper, close to my ear. Keep this individual voice close and clearly in the foreground. No crowd or music.',
			distance: /\b(?:beside|nearby|close|ear)\b/i,
		},
	];
	const results = [];
	for (const item of cases) {
		// eslint-disable-next-line no-await-in-loop -- One bounded local model request at a time.
		const scene = await planner.parseScene(item.prompt, signal);
		assert.match(scene.ambiencePrompt, item.distance, JSON.stringify(scene));
		// eslint-disable-next-line no-await-in-loop
		const plan = await planner.planLayers(scene, signal);
		const activity = plan.layers.find(layer => layer.id === 'activity');
		assert.ok(activity, JSON.stringify(plan));
		assert.match(activity.prompt, item.distance, activity.prompt);
		if (item.id === 'nearby') {
			assert.match(activity.prompt, /whisper/i);
			assert.doesNotMatch(activity.prompt, /diffuse|across the room|crowd/i);
		} else {
			assert.match(activity.prompt, /overlap|blend|diffuse/i);
			assert.doesNotMatch(activity.prompt, /whisper|low.pitched|many low voices/i);
		}

		if (item.id === 'outdoor') {
			assert.doesNotMatch(activity.prompt, /room|indoor/i);
		}

		if (item.id === 'cafe') {
			assert.doesNotMatch(activity.prompt, /jazz|piano|drum|cup|clink/i);
			const oldPrompt = 'soft customer conversation. blended overlapping murmur of many low voices at similar levels '
				+ 'Natural stereo recording with short room reflections. No singing, applause, or outdoor sounds';
			const original = sceneSchema.parse({...scene, originalPrompt: item.prompt});
			const description = {
				kind: 'ambience' as const, durationSeconds: 75, variant: 2, prompt: oldPrompt,
			};
			assert.notEqual(generationAssetKey(original, 'same-model-profile', description), generationAssetKey(original, 'same-model-profile', {
				...description, prompt: layerSoundPrompt(original, plan, activity),
			}), 'New crowd caption must not match the old recording cache key');
		}

		results.push({id: item.id, scene, plan});
	}

	return results;
}
