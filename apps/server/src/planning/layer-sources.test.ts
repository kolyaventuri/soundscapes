import {expect, it} from 'vitest';
import {layerPolicySchema, sceneSchema} from '@soundscapes/shared';
import {createLayeredState, layeredStateSchema} from '../layers/timeline.js';
import {layerSoundPrompt} from '../generation/service.js';
import {soundRequestSchema} from '../generation/contracts.js';
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

it('preserves four maximum-sized sources through compilation, saved state and the sound request', () => {
	const sources = ['rain', 'surf', 'wind', 'leaves'].map(name => ({name: name.padEnd(60, 'n'), caption: name.padEnd(240, 'c'), prominence: 'background'}));
	const plan = compileLayerSources({...inventory, continuousEnvironment: sources, occasionalEffects: sources});
	const saved = JSON.stringify(createLayeredState(plan, 42));
	const restored = layeredStateSchema.parse(JSON.parse(saved));
	const scene = sceneSchema.parse({
		title: 'Four sources', originalPrompt: 'Four sources', sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
	});
	for (const id of ['ambience', 'effects']) {
		const policy = restored.plan.layers.find(layer => layer.id === id)!;
		expect(policy.prompt).toHaveLength(1211);
		expect(policy.prompt).toBe(sources.map(source => `${source.name}. ${source.caption}`).join(' '));
		const prompt = layerSoundPrompt(scene, plan, policy);
		expect(prompt).toContain(policy.prompt);
		expect(soundRequestSchema.shape.prompt.parse(prompt)).toBe(prompt);
	}
});

it('keeps source and compiled layer inputs bounded', () => {
	expect(() => compileLayerSources({...inventory, continuousEnvironment: [{name: 'Rain', caption: 'x'.repeat(241), prominence: 'background'}]})).toThrow();
	expect(() => compileLayerSources({...inventory, continuousEnvironment: Array.from({length: 5}, () => inventory.continuousEnvironment[0])})).toThrow();
	const policy = compileLayerSources(inventory).layers[0]!;
	expect(() => layerPolicySchema.parse({...policy, prompt: 'x'.repeat(1251)})).toThrow();
});
