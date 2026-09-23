import {randomUUID} from 'node:crypto';
import {sceneSchema} from '@soundscapes/shared';
import {expect, it, vi} from 'vitest';
import {assetSchema} from '../persistence/store.js';
import {
	eventProposalSchema, nextOpportunityDelay, type EventProposal, type Planner, type ScheduledEvent,
} from './contracts.js';
import {EventController, eligibleAssets, type PlanningState} from './controller.js';

const scene = sceneSchema.parse({
	title: 'Quiet park', sleepMode: true, simulatedStart: '1932-10-01T01:00:00Z', allowedEventCategories: ['wind'],
});
const asset = assetSchema.parse({
	id: randomUUID(), kind: 'event', title: 'Soft breeze', file: 'assets/events/test.wav', durationMs: 10_000,
	sampleRate: 44_100, channels: 2, peakDb: -25, meanDb: -40, source: 'Test fixture', event: {category: 'wind', tags: ['wind'], reviewedSleepSafe: true},
});
const proposal: EventProposal = {
	event: 'A gentle breeze', assetId: asset.id, category: 'wind', durationSeconds: 8, prominence: 0.1, reason: 'Quiet air in the park',
};

function harness(propose: Planner['propose'], timeoutMs = 1000, skipProbability = 0, generation?: {
	generate: (proposal: EventProposal, signal: AbortSignal, deadlineAt: number) => Promise<typeof asset>; library?: Array<typeof asset>;
}) {
	const generate = generation?.generate;
	const library = generation?.library ?? [asset];
	let active = true;
	const schedule = vi.fn(async (event: Omit<ScheduledEvent, 'startMs' | 'simulatedTime'>) => ({...event, startMs: 121_000, simulatedTime: scene.simulatedStart}));
	const log = vi.fn();
	const state: PlanningState = {nextOpportunityMs: 0, opportunities: 0, skipped: 0};
	const planner: Planner = {parseScene: async () => scene, propose, busy: false};
	const controller = new EventController({
		state, planner, timeoutMs, skipProbability, delayScale: 1, random: () => 0.5,
		...(generate ? {generate} : {}),
		assets: () => library, active: () => active, changed: vi.fn(), schedule, log,
		context: () => ({
			scene, simulatedTime: scene.simulatedStart, elapsedMs: 0, recentEvents: [], ambientState: ['air'], library: [], earliestPlaybackMs: 121_000,
		}),
	});
	return {
		controller, state, schedule, log, deactivate() {
			active = false;
			controller.cancel();
		},
	};
}

it('uses the specified weighted delay ranges with bounded configurable scaling', () => {
	const buckets = [0, 0, 0, 0];
	for (let index = 0; index < 1000; index++) {
		let call = 0;
		const delay = nextOpportunityDelay(() => call++ === 0 ? index / 1000 : 0.5);
		buckets[[120_000, 300_000, 600_000, 900_001].findIndex(maximum => delay < maximum)]!++;
	}

	expect(buckets).toEqual([200, 450, 250, 100]);
	expect(nextOpportunityDelay(() => 0)).toBe(60_000);
	expect(nextOpportunityDelay(() => 0.999_999)).toBeLessThanOrEqual(900_000);
	expect(nextOpportunityDelay(() => 0, 0.05)).toBe(3000);
});

it('only admits reviewed scene-compatible assets absent from recent history', () => {
	const event: ScheduledEvent = {
		...proposal, id: randomUUID(), assetId: asset.id, description: proposal.event!, category: 'wind', startMs: 60_000,
		durationMs: 8000, gain: 0.2, fadeMs: 1000, pan: 0, lowpassHz: 3500, prominence: 0.1, simulatedTime: scene.simulatedStart,
	};
	expect(eligibleAssets([asset], scene, [event], 120_000)).toEqual([]);
	expect(eligibleAssets([asset], scene, [event], 2_000_000)).toEqual([asset]);
	expect(eligibleAssets([asset], {...scene, allowedEventCategories: []}, [], 0)).toEqual([]);
	expect(eligibleAssets([{...asset, title: 'Nearby loud horn'}], scene, [], 0)).toEqual([]);
});

it('schedules one validated event without allowing the planner to set the next opportunity', async () => {
	const {controller, state, schedule} = harness(async context => {
		expect(context.library).toHaveLength(1);
		expect(context.scene).toEqual(scene);
		return proposal;
	});
	controller.tick(0);
	const next = state.nextOpportunityMs;
	controller.tick(1000);
	await controller.settled();
	expect(schedule).toHaveBeenCalledTimes(1);
	expect(state.nextOpportunityMs).toBe(next);
	expect(state.opportunities).toBe(1);
	expect(schedule.mock.calls[0]![0]).toMatchObject({durationMs: 8000, gain: 0.25});
});

it('intentionally skips without invoking inference and still advances the opportunity clock', async () => {
	const propose = vi.fn(async () => proposal);
	const {controller, state} = harness(propose, 1000, 1);
	controller.tick(0);
	await controller.settled();
	expect(propose).not.toHaveBeenCalled();
	expect(state.skipped).toBe(1);
	expect(state.nextOpportunityMs).toBeGreaterThan(0);
});

it.each([
	{...proposal, event: null},
	{...proposal, event: 'A nearby horn'},
	{...proposal, assetId: randomUUID()},
	{...proposal, durationSeconds: 20},
	{...proposal, prominence: 0.9},
	{events: [proposal, proposal]},
])('skips null, unsafe, mismatched, excessive, or malformed proposals: %j', async value => {
	const {controller, schedule, state} = harness(async () => value as EventProposal);
	controller.tick(0);
	await controller.settled();
	expect(schedule).not.toHaveBeenCalled();
	expect(state.skipped).toBe(1);
	expect(eventProposalSchema.safeParse({...proposal, durationSeconds: 1000}).success).toBe(false);
});

it('drops timed-out and cancelled results even when an adapter ignores abort', async () => {
	let finish: (value: EventProposal) => void = () => undefined;
	const waiting = new Promise<EventProposal>(resolve => {
		finish = resolve;
	});
	const test = harness(async () => waiting, 15);
	test.controller.tick(0);
	await test.controller.settled();
	expect(test.state.skipped).toBe(1);
	finish(proposal);
	await Promise.resolve();
	expect(test.schedule).not.toHaveBeenCalled();
	const cancelled = harness(async () => new Promise(() => {/* Deliberately uncooperative adapter. */}));
	cancelled.controller.tick(0);
	cancelled.deactivate();
	await cancelled.controller.settled();
	expect(cancelled.schedule).not.toHaveBeenCalled();
	expect(cancelled.controller.busy).toBe(false);
});

it('generates a missing event only after validation and passes a fixed future deadline', async () => {
	const generate = vi.fn(async () => asset);
	const {controller, schedule} = harness(async () => ({...proposal, assetId: null}), 1000, 0, {generate, library: []});
	controller.tick(0);
	await controller.settled();
	expect(generate).toHaveBeenCalledTimes(1);
	expect(schedule).toHaveBeenCalledTimes(1);
	expect(schedule).toHaveBeenCalledWith(expect.objectContaining({assetId: asset.id}), expect.any(AbortSignal), 181_000);
});

it('reuses a selected asset without inference and rejects unsafe requests before generation', async () => {
	const generate = vi.fn(async () => asset);
	const reused = harness(async () => proposal, 1000, 0, {generate});
	reused.controller.tick(0);
	await reused.controller.settled();
	expect(reused.schedule).toHaveBeenCalledTimes(1);
	const unsafe = harness(async () => ({...proposal, assetId: null, event: 'A loud nearby alarm'}), 1000, 0, {generate});
	unsafe.controller.tick(0);
	await unsafe.controller.settled();
	expect(unsafe.schedule).not.toHaveBeenCalled();
	expect(generate).not.toHaveBeenCalled();
});

it('reuses a high-scoring match even when the planner asks to generate an effect', async () => {
	const generate = vi.fn(async () => asset);
	const {controller, schedule} = harness(async () => ({...proposal, assetId: null}), 1000, 0, {generate});
	controller.tick(0);
	await controller.settled();
	expect(generate).not.toHaveBeenCalled();
	expect(schedule).toHaveBeenCalledWith(expect.objectContaining({assetId: asset.id, offsetMs: 1000}), expect.any(AbortSignal), 181_000);
});

it('discards generation finishing after pause, even if an adapter ignores cancellation', async () => {
	let complete!: (value: typeof asset) => void;
	const generate = vi.fn(async () => new Promise<typeof asset>(resolve => {
		complete = resolve;
	}));
	const {controller, schedule, deactivate} = harness(async () => ({...proposal, assetId: null}), 1000, 0, {generate, library: []});
	controller.tick(0);
	await vi.waitFor(() => {
		expect(generate).toHaveBeenCalledTimes(1);
	});
	deactivate();
	await controller.settled();
	complete(asset);
	await Promise.resolve();
	expect(schedule).not.toHaveBeenCalled();
});
