import {z} from 'zod';
import {type Asset} from '../persistence/store.js';

export const bedSchema = z.object({
	assetId: z.uuid(), startMs: z.number().nonnegative(), durationMs: z.number().positive(), fadeInMs: z.number().nonnegative(), fadeOutMs: z.number().nonnegative(),
});
export const timelineSchema = z.object({seed: z.number().int().nonnegative(), beds: z.array(bedSchema).max(64)});
export type Bed = z.infer<typeof bedSchema>;
export type TimelineState = z.infer<typeof timelineSchema>;

export function chooseBed(assets: Asset[], history: Bed[], random: number): Asset {
	if (assets.length === 0) {
		throw new Error('No playable ambience assets. Run pnpm ambience:create.');
	}

	const current = history.at(-1)?.assetId;
	const candidates = assets.length === 1 ? assets : assets.filter(asset => asset.id !== current);
	const recent = history.slice(-8).reverse();
	const weighted = candidates.map(asset => {
		const age = recent.findIndex(bed => bed.assetId === asset.id);
		return {asset, weight: age === -1 ? 4 : 1 + (age / 2)};
	});
	let draw = Math.max(0, Math.min(0.999_999, random)) * weighted.reduce((sum, item) => sum + item.weight, 0);
	for (const item of weighted) {
		draw -= item.weight;
		if (draw < 0) {
			return item.asset;
		}
	}

	return weighted.at(-1)!.asset;
}

export function extendTimeline(state: TimelineState, assets: Asset[], {untilMs, playbackMs, selected = () => undefined}: {untilMs: number; playbackMs: number; selected?: (asset: Asset) => void}) {
	// Retain ten minutes of selection history and every unplayed bed.
	state.beds = state.beds.filter(bed => bed.startMs + bed.durationMs >= playbackMs - 600_000);
	while ((state.beds.at(-1)?.startMs ?? 0) + (state.beds.at(-1)?.durationMs ?? 0) < untilMs + 20_000) {
		state.seed = (Math.imul(state.seed, 1_664_525) + 1_013_904_223 + 4_294_967_296) % 4_294_967_296;
		const asset = chooseBed(assets, state.beds, state.seed / 0x1_00_00_00_00);
		if (asset.durationMs < 60_000) {
			throw new Error('Ambience beds must be at least 60 seconds');
		}

		const previous = state.beds.at(-1);
		const fadeMs = previous ? 15_000 : 0;
		if (previous) {
			previous.fadeOutMs = fadeMs;
		}

		state.beds.push({
			assetId: asset.id, startMs: previous ? previous.startMs + previous.durationMs - fadeMs : 0, durationMs: asset.durationMs, fadeInMs: fadeMs, fadeOutMs: 0,
		});
		selected(asset);
	}
}
