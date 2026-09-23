import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {type Asset} from '../persistence/store.js';
import {chooseBed, extendTimeline, type TimelineState} from './timeline.js';

const assets: Asset[] = Array.from({length: 4}, (value, index) => ({
	id: randomUUID(), kind: 'ambience', title: `Bed ${index}`, file: `assets/ambience/bed-${index}.wav`, durationMs: 90_000,
	sampleRate: 44_100, channels: 2, peakDb: -22, meanDb: -36, source: 'Test fixture', usageCount: 0, lastUsedAt: null,
}));

it('weights older beds, excludes immediate repeats, and explicitly handles empty/single pools', () => {
	const recent = assets.map(asset => ({
		assetId: asset.id, startMs: 0, durationMs: 90_000, fadeInMs: 0, fadeOutMs: 0,
	}));
	const counts = new Map<string, number>();
	for (let draw = 0; draw < 1000; draw++) {
		const selected = chooseBed(assets, recent, draw / 1000);
		expect(selected.id).not.toBe(assets[3]!.id);
		counts.set(selected.id, (counts.get(selected.id) ?? 0) + 1);
	}

	expect(counts.get(assets[0]!.id)!).toBeGreaterThan(counts.get(assets[2]!.id)!);
	expect(chooseBed([assets[0]!], recent, 0.5)).toEqual(assets[0]);
	expect(() => chooseBed([], [], 0.5)).toThrow('No playable ambience');
});

it('keeps an eight-hour simulated timeline contiguous, bounded, and deterministic across restoration', () => {
	let state: TimelineState = {seed: 1932, beds: []};
	for (let cursor = 0; cursor < 8 * 60 * 60 * 1000; cursor += 30_000) {
		extendTimeline(state, assets, {untilMs: cursor + 120_000, playbackMs: cursor});
		expect(state.beds.length).toBeLessThan(16);
		for (let index = 1; index < state.beds.length; index++) {
			const previous = state.beds[index - 1]!;
			const current = state.beds[index]!;
			expect(current.assetId).not.toBe(previous.assetId);
			expect(current.startMs).toBe(previous.startMs + previous.durationMs - 15_000);
			expect(previous.fadeOutMs).toBe(15_000);
			expect(current.fadeInMs).toBe(15_000);
		}

		if (cursor === 3_600_000) {
			const restored = structuredClone(state);
			extendTimeline(restored, assets, {untilMs: cursor + 200_000, playbackMs: cursor});
			extendTimeline(state, assets, {untilMs: cursor + 200_000, playbackMs: cursor});
			expect(restored).toEqual(state);
			state = restored;
		}
	}
});
