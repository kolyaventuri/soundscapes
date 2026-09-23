import {createHash} from 'node:crypto';
import {
	layerPlanSchema, layerPolicySchema, type LayerPlan, type LayerPolicy,
} from '@soundscapes/shared';
import {z} from 'zod';
import {bedSchema, type Bed} from '../ambience/timeline.js';
import {type Asset} from '../persistence/store.js';

export const layerStateSchema = z.object({
	policy: layerPolicySchema, seed: z.number().int().min(0).max(0xFF_FF_FF_FF),
	mixGain: z.number().min(0).max(1),
	assetIds: z.array(z.uuid()).max(6), clips: z.array(bedSchema.extend({gain: z.number().min(0).max(1)})).max(192),
	nextStartMs: z.number().nonnegative(), recent: z.array(z.uuid()).max(6),
	state: z.enum(['waiting', 'generating', 'ready', 'unavailable']), warning: z.string().max(300).nullable(),
	expansionFailed: z.boolean().default(false),
});
export const layeredStateSchema = z.object({plan: layerPlanSchema, layers: z.array(layerStateSchema).min(1).max(4)});
export type LayerState = z.infer<typeof layerStateSchema>;
export type LayeredState = z.infer<typeof layeredStateSchema>;
export type LayerClip = Bed & {gain: number};

export function poolSize(id: LayerPolicy['id']) {
	return id === 'ambience' ? {initial: 4, target: 4} : {initial: 2, target: id === 'effects' ? 6 : 3};
}

export function clipSeconds(id: LayerPolicy['id']) {
	return {
		ambience: 90, music: 120, activity: 75, effects: 10,
	}[id];
}

export function validatePlan(value: unknown): LayerPlan {
	const plan = layerPlanSchema.parse(value);
	const ids = plan.layers.map(layer => layer.id);
	if (new Set(ids).size !== ids.length || !ids.includes('ambience')) {
		throw new Error('Layer plan must have one ambience layer and no duplicate layers');
	}

	for (const layer of plan.layers) {
		if (layer.gapSeconds.minimum > layer.gapSeconds.maximum
			|| (layer.playback === 'continuous' && layer.gapSeconds.maximum !== 0)
			|| (layer.playback !== 'continuous' && layer.gapSeconds.minimum < 5)
			|| (layer.id === 'ambience' && (!layer.required || layer.playback !== 'continuous'))
			|| (layer.id === 'effects' && (layer.playback !== 'sparse' || layer.gapSeconds.minimum < 20 || layer.required))
			|| (layer.id !== 'effects' && layer.playback === 'sparse')
			|| layer.fadeSeconds > {
				ambience: 15, music: 4, activity: 15, effects: 2,
			}[layer.id]) {
			throw new Error(`Invalid continuity or gap policy for ${layer.id}`);
		}
	}

	return plan;
}

export function createLayeredState(value: LayerPlan, seed: number): LayeredState {
	const plan = validatePlan(value);
	// Normalize once, not on every transition/failure. Keep planner policy distinct
	// from mix gain: the sum remains <= 1 even at maximum clip-level variation.
	const normalization = Math.max(1, plan.layers.reduce((sum, layer) => sum + (layer.gain * (1 + layer.variability)), 0));
	return {
		plan, layers: plan.layers.map(policy => {
			const layerSeed = createHash('sha256').update(`${seed}:${policy.id}`).digest().readUInt32LE();
			const layer: LayerState = {
				policy, mixGain: policy.gain / normalization, seed: layerSeed, assetIds: [], clips: [], nextStartMs: 0, recent: [], state: 'waiting', warning: null, expansionFailed: false,
			};
			// All non-ambient layers enter independently, rather than on a transport boundary.
			layer.nextStartMs = policy.id === 'ambience' ? 0 : 7000 + Math.floor(draw(layer) * (policy.id === 'effects' ? 45_000 : 24_000));
			return layer;
		}),
	};
}

function draw(layer: LayerState) {
	layer.seed = (Math.imul(layer.seed, 1_664_525) + 1_013_904_223 + 4_294_967_296) % 4_294_967_296;
	return layer.seed / 0x1_00_00_00_00;
}

export function extendLayers(state: LayeredState, assets: Asset[], {untilMs, playbackMs, selected}: {untilMs: number; playbackMs: number; selected: (asset: Asset) => void}) {
	if (untilMs > playbackMs + 210_000) {
		throw new Error('Layer scheduling exceeds the bounded future horizon');
	}

	for (const layer of state.layers) {
		layer.clips = layer.clips.filter(clip => clip.startMs + clip.durationMs >= playbackMs - 600_000);
		if (layer.state === 'unavailable') {
			continue;
		}

		const pool = layer.assetIds.flatMap(id => {
			const asset = assets.find(asset => asset.id === id);
			return asset ? [asset] : [];
		});
		if (pool.length === 0) {
			if (!layer.policy.required) {
				layer.state = 'unavailable';
				layer.warning = 'The recordings for this optional layer are unavailable. The remaining scene is continuing.';
				continue;
			}

			throw new Error(`No playable assets for ${layer.policy.id}`);
		}

		while (layer.nextStartMs < untilMs) {
			if (layer.clips.length >= 192) {
				throw new Error('Layer history exceeded its bound');
			}

			// A bounded recent-clip cooldown grows with the pool, while always leaving choices.
			const cooldown = new Set(layer.recent.slice(-Math.min(Math.max(0, pool.length - 1), layer.policy.id === 'effects' ? 3 : 2)));
			const candidates = pool.length > 1 ? pool.filter(asset => !cooldown.has(asset.id)) : pool;
			const weighted = candidates.map(asset => ({asset, weight: layer.recent.includes(asset.id) ? 1 : 4}));
			let remaining = draw(layer) * weighted.reduce((sum, item) => sum + item.weight, 0);
			const {asset} = weighted.find(item => {
				remaining -= item.weight;
				return remaining < 0;
			}) ?? weighted.at(-1)!;
			const fadeMs = Math.min(layer.policy.fadeSeconds * 1000, asset.durationMs / 4);
			const gain = layer.mixGain * (1 - layer.policy.variability + (draw(layer) * layer.policy.variability * 2));
			layer.clips.push({
				assetId: asset.id, startMs: layer.nextStartMs, durationMs: asset.durationMs, fadeInMs: fadeMs, fadeOutMs: fadeMs, gain,
			});
			layer.recent = [...layer.recent, asset.id].slice(-6);
			const gap = layer.policy.playback === 'continuous'
				? -fadeMs
				: (layer.policy.gapSeconds.minimum + (draw(layer) * (layer.policy.gapSeconds.maximum - layer.policy.gapSeconds.minimum))) * 1000;
			layer.nextStartMs += asset.durationMs + gap;
			selected(asset);
		}
	}
}

export function layerClips(state: LayeredState) {
	return state.layers.filter(layer => layer.state !== 'unavailable').flatMap(layer => layer.clips);
}
