import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {sceneSchema} from '@soundscapes/shared';
import {assetSchema} from '../persistence/store.js';
import {type EventProposal, scheduledEventSchema} from '../planning/contracts.js';
import {eligibleAssets} from '../planning/controller.js';
import {contextCompatible, rankReusableAssets} from './reuse.js';

const scene = sceneSchema.parse({
	title: 'Park', originalPrompt: 'A dry park in autumn', location: 'Park', year: 1932, season: 'autumn',
	timeOfDay: 'night', weather: {temperature: 'cool', precipitation: 'dry', wind: 'light'}, sleepMode: true, simulatedStart: '1932-10-01T01:00:00Z', allowedEventCategories: ['wind'],
});
const asset = assetSchema.parse({
	id: randomUUID(), kind: 'event', title: 'A soft breeze', file: 'assets/events/test.wav',
	durationMs: 12_000, sampleRate: 44_100, channels: 2, meanDb: -40, peakDb: -25, source: 'Reviewed', affinity: scene,
	event: {category: 'wind', tags: ['wind'], reviewedSleepSafe: true},
});
const proposal: EventProposal = {
	event: 'A gentle breeze', assetId: null, category: 'wind', durationSeconds: 8, prominence: 0.1, reason: 'Compatible',
};
const now = Date.parse('2026-09-23T12:00:00Z');

it('ranks reusable acoustic matches using recency and rarity without changing their metadata', () => {
	const used = {
		...asset, id: randomUUID(), usageCount: 10, lastUsedAt: new Date(now - 86_400_000).toISOString(),
	};
	const ranked = rankReusableAssets([used, asset], scene, proposal, {now, random: () => 0.5});
	expect(ranked.map(item => item.asset.id)).toEqual([asset.id, used.id]);
	expect(asset.usageCount).toBe(0);
	expect(rankReusableAssets([asset], scene, proposal, {threshold: 0.99, random: () => 0.5})).toEqual([]);
	expect(rankReusableAssets([asset], scene, {...proposal, event: 'Rain dripping onto a metal roof'}, {threshold: 0, random: () => 1})).toEqual([]);
});

it('rejects mismatched context, excessive duration, unsafe and recently used sounds before scoring', () => {
	for (const changed of [{year: 2026}, {location: 'Train station'}, {season: 'winter'}, {timeOfDay: 'day'}, {weather: {...scene.weather, precipitation: 'rain'}}]) {
		expect(contextCompatible(asset, {...scene, ...changed})).toBe(false);
	}

	expect(rankReusableAssets([asset], scene, {...proposal, durationSeconds: 20})).toEqual([]);
	expect(rankReusableAssets([{...asset, lastUsedAt: new Date(now - 60_000).toISOString()}], scene, proposal, {now, threshold: 0, random: () => 1})).toEqual([]);
	expect(eligibleAssets([{...asset, title: 'A nearby loud horn'}], scene, [], 0)).toEqual([]);
	expect(eligibleAssets([{...asset, event: {...asset.event!, reviewedSleepSafe: false}}], scene, [], 0)).toEqual([]);
	expect(eligibleAssets([asset], {...scene, originalPrompt: 'A park without wind'}, [], 0)).toEqual([]);
});

it('requires explicit context for imported transport and bounds saved variation parameters', () => {
	const transport = {...asset, affinity: undefined, event: {...asset.event!, category: 'distant-wheels' as const}};
	expect(contextCompatible(transport, scene)).toBe(false);
	const base = {
		id: randomUUID(), assetId: asset.id, description: 'Breeze', category: 'wind', startMs: 100_000, durationMs: 8000,
		gain: 0.25, fadeMs: 1000, pan: 0, lowpassHz: 3500, prominence: 0.1, simulatedTime: scene.simulatedStart,
	};
	for (const changed of [{gain: 1}, {pan: 1}, {fadeMs: 0}, {lowpassHz: 20_000}, {offsetMs: -1}, {offsetMs: 120_000}]) {
		expect(scheduledEventSchema.safeParse({...base, ...changed}).success).toBe(false);
	}
});
