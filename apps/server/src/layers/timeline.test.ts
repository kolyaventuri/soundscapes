import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {assetSchema} from '../persistence/store.js';
import {testPlan} from './fixtures.js';
import {
	createLayeredState, extendLayers, clipSeconds, layeredStateSchema, validatePlan,
} from './timeline.js';

function setup(plan = testPlan) {
	const state = createLayeredState(validatePlan(plan), 1932);
	const assets = state.layers.flatMap(layer => Array.from({length: 3}, () => {
		const id = randomUUID();
		layer.assetIds.push(id);
		layer.state = 'ready';
		return assetSchema.parse({
			id, kind: layer.policy.id === 'effects' ? 'event' : 'ambience', file: `assets/ambience/${id}.wav`, title: layer.policy.title,
			durationMs: clipSeconds(layer.policy.id) * 1000, sampleRate: 44_100, channels: 2, peakDb: -18, meanDb: -36, source: 'test',
		});
	}));
	return {state, assets};
}

const selected = () => undefined;

it('keeps layer clocks independent, leaves complete music passages across ambience fades, and preserves headroom', () => {
	const {state, assets} = setup();
	extendLayers(state, assets, {untilMs: 180_000, playbackMs: 0, selected});
	const ambience = state.layers[0]!;
	const music = state.layers[1]!;
	expect(ambience.clips[1]?.startMs).toBe(75_000);
	expect(music.clips[0]!.startMs).toBeGreaterThan(0);
	expect(music.clips[0]!.startMs + music.clips[0]!.durationMs).toBeGreaterThan(90_000);
	expect(music.clips.every(clip => clip.durationMs === 120_000)).toBe(true);
	expect(music.clips[1]!.startMs % 30_000).not.toBe(0);
	expect(state.layers.reduce((sum, layer) => sum + (layer.mixGain * (1 + layer.policy.variability)), 0)).toBeLessThanOrEqual(1.000_001);
});

it('bounds eight hours of scheduling, restores the exact random state and never changes already scheduled envelopes', () => {
	const {state, assets} = setup();
	let restored = structuredClone(state);
	for (let playbackMs = 0; playbackMs < 8 * 3_600_000; playbackMs += 30_000) {
		const before = state.layers.flatMap(layer => layer.clips).filter(clip => clip.startMs + clip.durationMs >= playbackMs - 600_000);
		extendLayers(state, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		extendLayers(restored, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		expect(restored).toEqual(state);
		for (const clip of before) {
			expect(state.layers.flatMap(layer => layer.clips)).toContainEqual(clip);
		}

		expect(state.layers.every(layer => layer.clips.length < 40)).toBe(true);
		const serialized = JSON.stringify(restored);
		restored = layeredStateSchema.parse(JSON.parse(serialized));
	}
});

it('does not reshuffle music when effects are added and preserves intentional live-band gaps', () => {
	const plan = structuredClone(testPlan);
	plan.layers[1]!.playback = 'gapped';
	plan.layers[1]!.gapSeconds = {minimum: 15, maximum: 45};
	const {state, assets} = setup(plan);
	const other = structuredClone(state);
	other.layers = other.layers.filter(layer => layer.policy.id !== 'effects');
	for (let playbackMs = 0; playbackMs < 600_000; playbackMs += 30_000) {
		extendLayers(state, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		extendLayers(other, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
	}

	expect(state.layers[1]).toEqual(other.layers[1]);
	const {clips} = (state.layers[1]!);
	for (let index = 1; index < clips.length; index++) {
		const gap = clips[index]!.startMs - clips[index - 1]!.startMs - clips[index - 1]!.durationMs;
		expect(gap).toBeGreaterThanOrEqual(15_000);
		expect(gap).toBeLessThanOrEqual(45_000);
		expect(clips[index]!.assetId).not.toBe(clips[index - 1]!.assetId);
		if (index >= 2) {
			expect(clips[index]!.assetId).not.toBe(clips[index - 2]!.assetId);
		}
	}
});

it('rejects duplicate layers, inverted gaps and an unbounded scheduling horizon', () => {
	expect(() => validatePlan({...testPlan, layers: [testPlan.layers[0]!, testPlan.layers[0]!]})).toThrow('duplicate');
	const plan = structuredClone(testPlan);
	plan.layers[3]!.gapSeconds = {minimum: 90, maximum: 30};
	expect(() => validatePlan(plan)).toThrow('gap');
	const {state, assets} = setup();
	expect(() => {
		extendLayers(state, assets, {untilMs: 3_600_000, playbackMs: 0, selected});
	}).toThrow('horizon');
});
