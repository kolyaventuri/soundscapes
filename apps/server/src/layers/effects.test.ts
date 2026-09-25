import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {assetSchema} from '../persistence/store.js';
import {testPlan} from './fixtures.js';
import {
	createLayeredState, extendLayers, layeredStateSchema, validatePlan,
} from './timeline.js';

function fixture(gaps = [{minimum: 180, maximum: 420}, {minimum: 20, maximum: 45}]) {
	const plan = structuredClone(testPlan);
	const effects = plan.layers.at(-1)!;
	effects.effectSources = gaps.map((gapSeconds, index) => ({
		prompt: `Source ${index}`, durationSeconds: 3, gain: 0.2, gapSeconds,
	}));
	const state = createLayeredState(plan, 32);
	const assets = state.layers.flatMap(layer => Array.from({length: layer.policy.id === 'effects' ? Math.min(6, gaps.length * 2) : 2}, (value, variant) => {
		const id = randomUUID();
		layer.assetIds.push(id);
		layer.state = 'ready';
		return assetSchema.parse({
			id, kind: layer.policy.id === 'effects' ? 'event' : 'ambience', file: `assets/ambience/${id}.wav`, title: layer.policy.title,
			durationMs: layer.policy.id === 'effects' ? 3000 : 90_000, sampleRate: 44_100, channels: 2, peakDb: -18, meanDb: -36, source: 'test',
			generation: {
				model: 'test', revision: 'test', seed: 1, prompt: 'Test', sceneKey: 'a'.repeat(64), assetKey: 'b'.repeat(64),
				createdAt: '2000-01-01T00:00:00Z', validation: 'levels-v2', elapsedMs: 1, layerSource: variant % gaps.length,
			},
		});
	}));
	return {state, assets};
}

const selected = () => undefined;
it('preserves independent rare/frequent clocks across eight hours, pruning and restart', () => {
	const {state, assets} = fixture();
	let restored = structuredClone(state);
	const seen = [new Map<number, string>(), new Map<number, string>()];
	for (let playbackMs = 0; playbackMs < 8 * 3_600_000; playbackMs += 60_000) {
		extendLayers(state, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		extendLayers(restored, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		expect(restored).toEqual(state);
		const layer = state.layers.at(-1)!;
		expect(layer.clips.length).toBeLessThan(45);
		for (const [index, clip] of layer.clips.entries()) {
			seen[assets.find(asset => asset.id === clip.assetId)!.generation!.layerSource!]!.set(clip.startMs, clip.assetId);
			if (index > 0) {
				expect(clip.startMs - layer.clips[index - 1]!.startMs).toBeGreaterThanOrEqual(8000);
			}
		}

		const serialized = JSON.stringify(restored);
		restored = layeredStateSchema.parse(JSON.parse(serialized));
	}

	expect(seen[1]!.size).toBeGreaterThan(seen[0]!.size * 5);
	for (const [source, occurrences] of seen.entries()) {
		const entries = [...occurrences];
		expect(entries[0]![0]).toBeGreaterThanOrEqual(source === 0 ? 180_000 : 20_000);
		for (let index = 1; index < entries.length; index++) {
			const gap = entries[index]![0] - entries[index - 1]![0] - 3000;
			expect(gap).toBeGreaterThanOrEqual(source === 0 ? 180_000 : 20_000);
			// Another source can defer playback by at most its three-second clip plus quiet.
			expect(gap).toBeLessThanOrEqual((source === 0 ? 420_000 : 45_000) + 8000);
			expect(entries[index]![1]).not.toBe(entries[index - 1]![1]);
		}
	}
}, 15_000);

it('never backfills a missing source or changes committed clips when recordings become available', () => {
	const {state, assets} = fixture();
	const missing = assets.filter(asset => asset.kind !== 'event' || asset.generation!.layerSource === 1);
	extendLayers(state, missing, {untilMs: 180_000, playbackMs: 0, selected});
	extendLayers(state, missing, {untilMs: 360_000, playbackMs: 180_000, selected});
	const before = structuredClone(state.layers.at(-1)!.clips);
	extendLayers(state, assets, {untilMs: 540_000, playbackMs: 360_000, selected});
	const after = state.layers.at(-1)!.clips;
	expect(after.slice(0, before.length)).toEqual(before);
	expect(after.slice(before.length).every(clip => clip.startMs >= 360_000)).toBe(true);
	expect(after.some(clip => assets.find(asset => asset.id === clip.assetId)!.generation!.layerSource === 0)).toBe(true);
});

it('bounds maximum density, validates source gaps and leaves legacy saved policies on their original clock', () => {
	const {state, assets} = fixture(Array.from({length: 4}, () => ({minimum: 20, maximum: 20})));
	for (let playbackMs = 0; playbackMs < 3_600_000; playbackMs += 60_000) {
		extendLayers(state, assets, {untilMs: playbackMs + 180_000, playbackMs, selected});
		expect(state.layers.at(-1)!.clips.length).toBeLessThan(110);
	}

	const legacy = createLayeredState(testPlan, 32);
	expect(legacy.layers.at(-1)!.effectSchedule).toBeUndefined();
	const invalid = structuredClone(state.plan);
	invalid.layers.at(-1)!.effectSources![0]!.gapSeconds = {minimum: 100, maximum: 20};
	expect(() => validatePlan(invalid)).toThrow('gap policies');
	delete invalid.layers.at(-1)!.effectSources![0]!.gapSeconds;
	expect(() => validatePlan(invalid)).toThrow('gap policies');
});
