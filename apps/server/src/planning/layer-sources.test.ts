import {expect, it} from 'vitest';
import {compileLayerSources} from './layer-sources.js';

const inventory = {
	space: 'open-air',
	continuousEnvironment: [{name: 'Surf', caption: 'Repeated waves break and recede on sand.', prominence: 'background'}],
	humanActivity: {
		name: 'Diners', caption: 'Indistinct dining conversation and tableware movement.', continuity: 'ongoing', prominence: 'primary',
	},
	music: {
		name: 'Caribbean music', caption: 'Instrumental Caribbean music with steel pan, bass and a relaxed syncopated rhythm.', continuity: 'ongoing', prominence: 'background',
	},
	occasionalEffects: [{name: 'Gulls', caption: 'A few distant gull calls.', prominence: 'distant'}],
};

it('preserves continuous surf beneath diners, separate music and occasional gulls', () => {
	const plan = compileLayerSources(inventory);
	expect(plan.layers.map(layer => [layer.id, layer.title])).toEqual([
		['ambience', 'Surf'], ['music', 'Caribbean music'], ['activity', 'Diners'], ['effects', 'Gulls'],
	]);
	expect(plan.layers[0]).toMatchObject({required: true, playback: 'continuous', gapSeconds: {minimum: 0, maximum: 0}});
	expect(plan.layers[1]).toMatchObject({required: true, playback: 'continuous'});
	expect(plan.layers[3]).toMatchObject({required: false, playback: 'sparse'});
	expect(plan.layers.map(layer => layer.gain)).toEqual([0.7, 0.7, 1, 0.45]);
	expect(plan.layers[1]?.prompt).toMatch(/^Caribbean music\./);
	expect(plan.acoustics).not.toMatch(/restaurant|waves|gulls|sun|music/i);
});

it('supports gapped songs and keeps implicit room tone below requested sources', () => {
	const sparse = {
		space: 'small-room', continuousEnvironment: [], humanActivity: null, music: null, occasionalEffects: [],
	};
	const plan = compileLayerSources({...sparse, music: {...inventory.music, continuity: 'occasional'}});
	expect(plan.layers[0]).toMatchObject({gain: 0.12});
	expect(plan.layers[1]).toMatchObject({playback: 'gapped', gapSeconds: {minimum: 15, maximum: 45}});
	expect(compileLayerSources(sparse).layers).toHaveLength(1);
});

it('rejects oversized combined captions rather than silently truncating requested sources', () => {
	expect(() => compileLayerSources({...inventory, continuousEnvironment: ['rain', 'surf', 'wind'].map(name => ({name, caption: 's'.repeat(240), prominence: 'background'}))})).toThrow();
});
