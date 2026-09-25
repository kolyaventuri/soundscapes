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

export const cafePrompt = 'Inside a busy cafe: a continuously humming espresso machine, clinking cups, indistinct crowd conversation and soft jazz piano played in the room.';
export const neighborhoodPrompt = 'Seated at a table inside a small neighborhood cafe during a moderately busy afternoon. '
	+ 'A steady murmur of overlapping conversations fills the room, with occasional nearby cup and saucer clinks and brief espresso machine sounds behind the counter. '
	+ 'No music. No individual conversation should dominate.';
export const creekPrompt = 'Sitting beside a small creek in a leafy forest on a calm afternoon. '
	+ 'Water trickles steadily over stones nearby. Leaves rustle softly overhead, with occasional birds calling further away. '
	+ 'No rain, wind gusts, people, or music.';
export const cruisePrompt = 'Relaxing on the pool deck of a cruise ship on a calm day at sea. You can hear people in the distance having conversation, '
	+ 'there\'s light music playing but it\'s pretty quiet. Every now and then however, the still is broken by the ships absolutely deafening fog horn.';
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
	const neighborhood = await planner.planLayers({...cafe, originalPrompt: neighborhoodPrompt}, signal);
	assert.doesNotMatch(neighborhood.layers.find(layer => layer.id === 'ambience')!.prompt, /espresso|steam|grind|hiss/i);
	assert.ok(!neighborhood.layers.some(layer => layer.id === 'music'));
	const sources = neighborhood.layers.find(layer => layer.id === 'effects')!.effectSources!;
	assert.ok(sources.some(source => /espresso|steam/i.test(source.prompt) && !/cup|saucer|clink/i.test(source.prompt)));
	assert.ok(sources.some(source => /cup|saucer|clink/i.test(source.prompt) && !/espresso|steam/i.test(source.prompt) && source.durationSeconds <= 4));
	assert.doesNotMatch(layeredBeach.layers.find(layer => layer.id === 'music')!.prompt, /jazz/i);
	const cruise = await planner.planLayers({...cafe, originalPrompt: cruisePrompt}, signal);
	assert.doesNotMatch(cruise.layers.find(layer => layer.id === 'ambience')!.prompt, /horn|blast/i);
	assert.equal(cruise.layers.find(layer => layer.id === 'activity')?.playback, 'continuous');
	assert.equal(cruise.layers.find(layer => layer.id === 'music')?.playback, 'continuous');
	const horn = cruise.layers.find(layer => layer.id === 'effects')!;
	assert.equal(horn.playback, 'sparse');
	assert.ok(horn.gapSeconds.minimum >= 45);
	assert.ok(horn.effectSources?.some(source => /horn/i.test(source.prompt)));
	assert.doesNotMatch(horn.prompt, /conversation|chatter|music/i);
	return {
		layeredCafe, layeredRain, layeredBand, layeredBeach, neighborhood, cruise,
	};
}
