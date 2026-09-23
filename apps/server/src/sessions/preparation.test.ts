import {afterEach, expect, it} from 'vitest';
import {Store} from '../persistence/store.js';
import {Preparation} from './preparation.js';

const stores: Store[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});
function setup() {
	const store = new Store();
	stores.push(store);
	let now = 0;
	const progress = new Preparation(store, () => now, 4);
	return {
		store, progress, advance(ms: number) {
			now += ms;
		},
	};
}

it('includes measured remaining generation, validation and buffering', () => {
	const {store, progress, advance} = setup();
	store.recordTiming('cold', 40_000);
	store.recordTiming('warm', 20_000);
	store.recordTiming('validation', 2000);
	store.recordTiming('buffer', 5000);
	progress.plan([{id: 'first', profile: 'cold'}, {id: 'next', profile: 'warm'}, {id: 'validation', profile: 'validation'}, {id: 'buffer', profile: 'buffer'}]);
	progress.begin('first', 'cold', 'loading');
	expect(progress.view(true).estimate).toEqual({lowerMs: 43_550, upperMs: 107_200});
	advance(10_000);
	progress.update('generating', {completed: 2, total: 8});
	expect(progress.view(true)).toMatchObject({estimate: {lowerMs: 33_550, upperMs: 97_200}, completedBeds: 0, step: {completed: 2, total: 8}});
	advance(30_000);
	progress.complete();
	expect(progress.view(true).estimate).toEqual({lowerMs: 17_550, upperMs: 43_200});
	expect(store.timings('cold')).toEqual([40_000, 40_000]);
});

it('uses indeterminate states for missing profiles, queue contention and overruns', () => {
	const {store, progress, advance} = setup();
	store.recordTiming('different-model', 100);
	progress.plan([{id: 'audio', profile: 'medium-mlx-cold'}]);
	progress.begin('audio', 'medium-mlx-cold', 'loading');
	expect(progress.view(true)).toMatchObject({estimate: null, estimateReason: 'learning'});
	store.recordTiming('medium-mlx-cold', 1000);
	expect(progress.view(true, true)).toMatchObject({estimate: null, estimateReason: 'queue'});
	progress.update('queued');
	expect(progress.view(true)).toMatchObject({estimate: null, estimateReason: 'queue'});
	progress.update('generating');
	advance(1600);
	expect(progress.view(true)).toMatchObject({estimate: null, estimateReason: 'overrun'});
	progress.freeze();
	advance(60_000);
	expect(progress.view(false)).toMatchObject({estimate: null, estimateReason: 'paused', elapsedMs: 1600});
	expect(store.timings('medium-mlx-cold')).toEqual([1000]);
});

it('omits reused work and waits for HLS readiness after all beds are complete', () => {
	const {store, progress, advance} = setup();
	store.recordTiming('buffer', 5000);
	progress.plan([{id: 'buffer', profile: 'buffer'}], false);
	expect(progress.view(true).estimate).toBeNull();
	progress.plan([]);
	progress.completedBeds = 4;
	progress.reusedBeds = 4;
	progress.begin('buffer', 'buffer', 'buffering');
	expect(progress.view(true)).toMatchObject({
		stage: 'buffering', completedBeds: 4, reusedBeds: 4, estimate: {lowerMs: 3250, upperMs: 8000},
	});
	advance(4000);
	progress.complete();
	progress.update('ready');
	advance(60_000);
	expect(progress.view(false)).toMatchObject({stage: 'ready', estimate: null, elapsedMs: 4000});
});
