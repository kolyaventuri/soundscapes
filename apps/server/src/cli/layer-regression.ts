import assert from 'node:assert/strict';
import {type LayerPlan, type Scene} from '@soundscapes/shared';
import {type OllamaPlanner} from '../planning/ollama.js';

// Exact reported scene; keep this out of production planning and generation.
export const beachPrompt = 'Restaurant on the beach, mid-day. The sound of crashing waves can be heard, under the sounds of the patrons eating. '
	+ 'Some light caribbean style music is playing in the background as the sun beats down. You can also hear some seagulls off in the distance';

export function assertBeachPlan(plan: LayerPlan) {
	assert.deepEqual(plan.layers.map(layer => layer.id), ['ambience', 'music', 'activity', 'effects']);
	const [ambience, music, activity, effects] = plan.layers;
	assert.equal(ambience!.playback, 'continuous');
	assert.equal(ambience!.required, true);
	assert.match(ambience!.prompt, /waves|surf|breakers/i);
	assert.doesNotMatch(ambience!.prompt, /patrons|diners|restaurant|gulls|music/i);
	assert.equal(music!.playback, 'continuous');
	assert.equal(music!.required, true);
	assert.match(music!.prompt, /caribbean/i);
	assert.match(music!.prompt, /pan|drum|percussion|guitar|bass|piano|rhythm/i);
	assert.doesNotMatch(music!.prompt, /gulls|waves|surf|restaurant|patrons|diners/i);
	assert.equal(activity!.playback, 'continuous');
	assert.ok(ambience!.gain < activity!.gain, 'Waves heard under the patrons must be mixed below the patrons');
	assert.ok(music!.gain < activity!.gain, 'Background music must remain below the foreground dining activity');
	assert.match(activity!.prompt, /patrons|eating|diner|conversation/i);
	assert.doesNotMatch(activity!.prompt, /gulls|waves|surf|caribbean|music/i);
	assert.equal(effects!.playback, 'sparse');
	assert.match(effects!.prompt, /gull/i);
	assert.doesNotMatch(effects!.prompt, /waves|surf|restaurant|music/i);
	assert.doesNotMatch(plan.acoustics, /restaurant|sun|gulls|waves|music/i);
}

export const cafePrompt = 'Inside a busy cafe: espresso machine, clinking cups, indistinct crowd conversation and soft jazz piano played in the room.';
export const rainPrompt = 'A sheltered woodland at night in autumn. Steady soft rain on leaves, mild temperature, no wind. '
	+ 'No people, voices, music, animals, thunder or sharp sounds.';

export async function checkLayerPlans(planner: OllamaPlanner, signal: AbortSignal, cafe: Scene, defaulted: Scene) {
	const layeredCafe = await planner.planLayers(cafe, signal);
	assert.deepEqual(layeredCafe.layers.map(layer => layer.id), ['ambience', 'music', 'activity', 'effects']);
	assert.equal(layeredCafe.layers.find(layer => layer.id === 'music')?.playback, 'continuous');
	assert.match(layeredCafe.layers.find(layer => layer.id === 'ambience')!.prompt, /espresso|steam|gurgle|gurgling/i);
	assert.doesNotMatch(layeredCafe.layers.find(layer => layer.id === 'ambience')!.prompt, /piano|jazz|conversation|crowd|clink/i);
	assert.doesNotMatch(layeredCafe.layers.find(layer => layer.id === 'music')!.prompt, /espresso|conversation|crowd|clink/i);
	assert.doesNotMatch(layeredCafe.layers.find(layer => layer.id === 'activity')!.prompt, /clink|cup|tableware/i);
	assert.match(layeredCafe.layers.find(layer => layer.id === 'activity')!.prompt, /conversation|murmur|crowd/i);
	assert.match(layeredCafe.layers.find(layer => layer.id === 'effects')!.prompt, /cup|clink/i);
	assert.doesNotMatch(layeredCafe.layers.find(layer => layer.id === 'effects')!.prompt, /conversation|murmur|crowd|diner/i);
	const layeredRain = await planner.planLayers(defaulted, signal);
	assert.deepEqual(layeredRain.layers.map(layer => layer.id), ['ambience']);
	assert.match(layeredRain.layers[0]!.prompt, /rain/i);
	const layeredBand = await planner.planLayers({...cafe, originalPrompt: 'A live jazz band in a small club, with pauses between songs and a murmuring audience.'}, signal);
	assert.equal(layeredBand.layers.find(layer => layer.id === 'music')?.playback, 'gapped');
	assert.ok(layeredBand.layers.some(layer => layer.id === 'activity'));
	assert.doesNotMatch(layeredBand.layers.find(layer => layer.id === 'ambience')!.prompt, /audience|murmur|conversation|jazz|band|clink/i);
	const layeredBeach = await planner.planLayers({...cafe, originalPrompt: beachPrompt}, signal);
	assertBeachPlan(layeredBeach);
	return {
		layeredCafe, layeredRain, layeredBand, layeredBeach,
	};
}
