import {createHash} from 'node:crypto';
import {type Scene} from '@soundscapes/shared';
import {type Asset} from '../persistence/store.js';
import {type EventProposal} from '../planning/contracts.js';

export function sceneKey(scene: Scene) {
	return createHash('sha256').update(scene.originalPrompt.trim().replaceAll(/\s+/g, ' ').toLowerCase()).digest('hex');
}

const ignored = new Set('a an the of in on at to and with through from by one some sound sounds gentle soft subtle distant quiet background natural realistic stereo event'.split(' '));
const aliases: Record<string, string> = {
	breeze: 'wind', breezes: 'wind', footsteps: 'footstep', leaves: 'leaf', rustling: 'leaf', crickets: 'cricket', wheels: 'wheel',
};
export function audioTags(text: string) {
	return [...new Set((text.toLowerCase().match(/[a-z\d]+/g) ?? []).filter(word => !ignored.has(word)).map(word => aliases[word] ?? word))].slice(0, 12);
}

function normalized(text: string) {
	return text.trim().toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function compatibleField(left: string, right: string) {
	return !left || !right || normalized(left) === normalized(right);
}

export function contextCompatible(asset: Asset, scene: Scene) {
	const {affinity} = asset;
	if (!affinity) {
		// Old generated assets only have exact-scene provenance. Unscoped imports
		// remain available for reviewed natural sounds; transport needs context.
		return asset.generation
			? asset.generation.sceneKey === sceneKey(scene)
			: Boolean(asset.event && ['wind', 'leaves', 'water', 'insects'].includes(asset.event.category));
	}

	return (affinity.year === null || scene.year === null || affinity.year === scene.year)
		&& compatibleField(affinity.location, scene.location)
		&& compatibleField(affinity.season, scene.season)
		&& compatibleField(affinity.timeOfDay, scene.timeOfDay)
		&& compatibleField(affinity.weather.precipitation, scene.weather.precipitation)
		&& compatibleField(affinity.weather.wind, scene.weather.wind)
		&& compatibleField(affinity.weather.temperature, scene.weather.temperature);
}

// Call only after eligibility checks (review/validation, exclusions and recent
// session history). Recency/randomness cannot rescue a poor acoustic match.
export function rankReusableAssets(assets: Asset[], scene: Scene, proposal: EventProposal, {threshold = 0.75, now = Date.now(), random = Math.random} = {}) {
	const requested = audioTags(proposal.event ?? '');
	if (requested.length === 0) {
		return [];
	}

	return assets.flatMap(asset => {
		if (asset.event?.category !== proposal.category || !contextCompatible(asset, scene)
			|| asset.durationMs < (proposal.durationSeconds ?? 0) * 1000) {
			return [];
		}

		const tokens = new Set(audioTags(`${asset.title} ${asset.event.tags.join(' ')}`));
		const fit = requested.filter(word => tokens.has(word)).length / requested.length;
		if (fit < 0.6) {
			return [];
		}

		const sinceUse = asset.lastUsedAt ? now - Date.parse(asset.lastUsedAt) : Number.POSITIVE_INFINITY;
		if (Number.isNaN(sinceUse) || sinceUse < 30 * 60_000) {
			return [];
		}

		const recency = Math.min(1, sinceUse / (24 * 60 * 60_000));
		const rarity = 1 / (1 + asset.usageCount);
		const score = (fit * 0.4) + (recency * 0.3) + (rarity * 0.2) + (Math.max(0, Math.min(1, random())) * 0.1);
		return score >= threshold ? [{asset, score, fit}] : [];
	}).sort((left, right) => right.score - left.score);
}
