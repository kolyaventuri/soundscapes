import {type Asset} from '../persistence/store.js';
import {type LayerState} from './timeline.js';

type RandomState = {seed: number; recent: string[]};
export function draw(state: {seed: number}) {
	state.seed = (Math.imul(state.seed, 1_664_525) + 1_013_904_223 + 4_294_967_296) % 4_294_967_296;
	return state.seed / 0x1_00_00_00_00;
}

export function chooseAsset(pool: Asset[], state: RandomState, maximumCooldown: number) {
	const cooldown = new Set(state.recent.slice(-Math.min(Math.max(0, pool.length - 1), maximumCooldown)));
	const candidates = pool.length > 1 ? pool.filter(asset => !cooldown.has(asset.id)) : pool;
	const weighted = candidates.map(asset => ({asset, weight: state.recent.includes(asset.id) ? 1 : 4}));
	let remaining = draw(state) * weighted.reduce((sum, item) => sum + item.weight, 0);
	return (weighted.find(item => {
		remaining -= item.weight;
		return remaining < 0;
	}) ?? weighted.at(-1)!).asset;
}

export function appendClip(layer: LayerState, asset: Asset, startMs: number, random: {seed: number}) {
	if (layer.clips.length >= 192) {
		throw new Error('Layer history exceeded its bound');
	}

	const fadeMs = Math.min(layer.policy.fadeSeconds * 1000, asset.durationMs / 4);
	const gain = layer.mixGain * (asset.generation?.layerGain ?? 1) * (1 - layer.policy.variability + (draw(random) * layer.policy.variability * 2));
	layer.clips.push({
		assetId: asset.id, startMs, durationMs: asset.durationMs,
		fadeInMs: startMs === 0 ? Math.min(2000, fadeMs) : fadeMs, fadeOutMs: fadeMs, gain,
	});
	layer.recent = [...layer.recent, asset.id].slice(-6);
	return fadeMs;
}
