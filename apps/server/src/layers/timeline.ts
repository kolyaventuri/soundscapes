import {createHash} from 'node:crypto';
import {
	layerPlanSchema, layerPolicySchema, type LayerPlan, type LayerPolicy,
} from '@soundscapes/shared';
import {z} from 'zod';
import {bedSchema, type Bed} from '../ambience/timeline.js';
import {type Asset} from '../persistence/store.js';
import {appendClip, chooseAsset, draw} from './clips.js';
import {effectScheduleSchema, effectDelay, extendEffects} from './effects.js';

export const layerStateSchema = z.object({
	policy: layerPolicySchema, seed: z.number().int().min(0).max(0xFF_FF_FF_FF),
	mixGain: z.number().min(0).max(1),
	assetIds: z.array(z.uuid()).max(6), clips: z.array(bedSchema.extend({gain: z.number().min(0).max(1)})).max(192),
	nextStartMs: z.number().nonnegative(), recent: z.array(z.uuid()).max(6),
	state: z.enum(['waiting', 'generating', 'ready', 'unavailable']), warning: z.string().max(300).nullable(),
	expansionFailed: z.boolean().default(false),
	effectSchedule: effectScheduleSchema.optional(),
});
export const layeredStateSchema = z.object({plan: layerPlanSchema, layers: z.array(layerStateSchema).min(1).max(4)});
export type LayerState = z.infer<typeof layerStateSchema>;
export type LayeredState = z.infer<typeof layeredStateSchema>;
export type LayerClip = Bed & {gain: number};

export function poolSize(policy: LayerPolicy | LayerPolicy['id']) {
	const id = typeof policy === 'string' ? policy : policy.id;
	const sourceCount = typeof policy === 'string' ? 0 : (policy.effectSources?.length ?? 0);
	return id === 'ambience' ? {initial: 4, target: 4} : {initial: Math.max(2, sourceCount), target: id === 'effects' ? 6 : 3};
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
		validateEffectSources(layer);
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

function validateEffectSources(layer: LayerPolicy) {
	if (layer.effectSources && (layer.id !== 'effects' || layer.effectSources.some(source => source.gain > layer.gain))) {
		throw new Error('Isolated effect sources require an effects layer with sufficient gain headroom');
	}

	const gaps = layer.effectSources?.map(source => source.gapSeconds) ?? [];
	if (gaps.some(Boolean) && (gaps.some(gap => !gap) || gaps.some(gap => gap!.minimum > gap!.maximum))) {
		throw new Error('Effect source gap policies must be complete and ordered');
	}
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
			// Ongoing sources form the scene immediately. Their different durations
			// and fades still keep subsequent boundaries independent.
			layer.nextStartMs = policy.playback === 'continuous' ? 0 : 7000 + Math.floor(draw(layer) * (policy.id === 'effects' ? 45_000 : 24_000));
			if (policy.effectSources?.every(source => source.gapSeconds)) {
				layer.nextStartMs = 0;
				layer.effectSchedule = {
					throughMs: 0, clocks: policy.effectSources.map((source, index) => {
						const clock = {seed: createHash('sha256').update(`${seed}:effect:${index}`).digest().readUInt32LE(), nextStartMs: 0, recent: []};
						clock.nextStartMs = effectDelay(source.gapSeconds!, clock);
						return clock;
					}),
				};
			}

			return layer;
		}),
	};
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

		if (layer.effectSchedule) {
			extendEffects(layer, pool, untilMs, selected);
			continue;
		}

		while (layer.nextStartMs < untilMs) {
			const asset = chooseAsset(pool, layer, layer.policy.id === 'effects' ? 3 : 2);
			const fadeMs = appendClip(layer, asset, layer.nextStartMs, layer);
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
