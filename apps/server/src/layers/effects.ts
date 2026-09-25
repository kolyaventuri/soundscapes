import {z} from 'zod';
import {type Asset} from '../persistence/store.js';
import {type LayerState} from './timeline.js';
import {appendClip, chooseAsset, draw} from './clips.js';

export const effectScheduleSchema = z.object({
	throughMs: z.number().nonnegative(),
	clocks: z.array(z.object({
		seed: z.number().int().min(0).max(0xFF_FF_FF_FF), nextStartMs: z.number().nonnegative(), recent: z.array(z.uuid()).max(6),
	})).min(1).max(4),
});

export function effectDelay(gap: {minimum: number; maximum: number}, state: {seed: number}) {
	return (gap.minimum + (draw(state) * (gap.maximum - gap.minimum))) * 1000;
}

export function extendEffects(layer: LayerState, pool: Asset[], untilMs: number, selected: (asset: Asset) => void) {
	const schedule = layer.effectSchedule!;
	const sources = layer.policy.effectSources!;
	while (true) {
		// Earliest due source wins. Serialize effects with five seconds of quiet
		// between them, preserving the existing one-effect headroom assumption.
		const next = schedule.clocks.map((clock, index) => ({
			clock, index, pool: pool.filter(asset => asset.generation?.layerSource === index),
			startMs: Math.max(clock.nextStartMs, layer.nextStartMs, schedule.throughMs),
		})).filter(item => item.pool.length > 0 && item.startMs < untilMs)
			.sort((a, b) => a.startMs - b.startMs || a.clock.nextStartMs - b.clock.nextStartMs || a.index - b.index)[0];
		if (!next) {
			break;
		}

		const {clock, index, startMs} = next;
		const asset = chooseAsset(next.pool, clock, 2);
		appendClip(layer, asset, startMs, clock);
		clock.recent = [...clock.recent, asset.id].slice(-6);
		const endMs = startMs + asset.durationMs;
		clock.nextStartMs = endMs + effectDelay(sources[index]!.gapSeconds!, clock);
		layer.nextStartMs = endMs + 5000;
		selected(asset);
	}

	// If a missing source returns or its pool expands, never backfill audio
	// in an already scheduled/committed interval or replay missed occurrences.
	schedule.throughMs = Math.max(schedule.throughMs, untilMs);
}
