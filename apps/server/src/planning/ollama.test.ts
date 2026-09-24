import {sceneSchema} from '@soundscapes/shared';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {readConfig} from '../config.js';
import {OllamaPlanner} from './ollama.js';

afterEach(() => {
	vi.unstubAllGlobals();
});
const scene = sceneSchema.parse({title: 'Quiet park', sleepMode: true, simulatedStart: '1932-10-01T01:00:00Z'});
const context = {
	scene, simulatedTime: scene.simulatedStart, elapsedMs: 0, ambientState: [], recentEvents: [], library: [], earliestPlaybackMs: 90_000,
};
const skip = {
	decision: 'skip', description: '', assetId: '', category: 'none', durationSeconds: 0, prominence: 0, reason: 'No matching asset',
};
const response = (content: unknown, doneReason = 'stop') => new Response(JSON.stringify({done: true, done_reason: doneReason, message: {content: JSON.stringify(content)}}));

it('compiles focused source captions using one constrained local request', async () => {
	const inventory = {
		space: 'small-room', continuousEnvironment: [], occasionalEffects: [],
		music: {
			name: 'Jazz', caption: 'Instrumental jazz piano.', continuity: 'ongoing', prominence: 'background',
		},
		humanActivity: {
			name: 'Conversation', caption: 'Indistinct conversation.', continuity: 'ongoing', prominence: 'primary',
		},
	};
	const fetch = vi.fn(async () => response(inventory));
	vi.stubGlobal('fetch', fetch);
	const planner = new OllamaPlanner(readConfig({}).planner);
	const originalPrompt = 'A café with jazz and conversation.';
	const plan = await planner.planLayers({...scene, originalPrompt}, new AbortController().signal);
	expect(plan.layers.map(layer => layer.id)).toEqual(['ambience', 'music', 'activity']);
	expect(plan.layers[1]).toMatchObject({
		prompt: 'Jazz. Instrumental jazz piano.', playback: 'continuous', fadeSeconds: 3,
	});
	const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
	expect(call[1].body).toContain(originalPrompt);
	expect(call[1].body).toContain('"keep_alive":0');
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(planner.busy).toBe(false);
});

it('uses constrained local requests, unloads after each request, and converts explicit skips to null', async () => {
	const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response(skip));
	vi.stubGlobal('fetch', fetch);
	const planner = new OllamaPlanner(readConfig({}).planner);
	expect(await planner.propose(context, new AbortController().signal)).toMatchObject({event: null, assetId: null});
	expect(fetch.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/api/chat');
	expect(fetch.mock.calls[0]![1]).toMatchObject({method: 'POST', redirect: 'error'});
	expect(fetch.mock.calls[0]![1].body).toContain('"keep_alive":0');
	expect(planner.busy).toBe(false);
});

it.each(['malformed', 'truncated', 'oversized', 'http-error'])('rejects %s model responses and releases the single-flight slot', async mode => {
	vi.stubGlobal('fetch', vi.fn(async () => {
		if (mode === 'http-error') {
			return new Response('', {status: 503});
		}

		if (mode === 'oversized') {
			return new Response('x'.repeat(129 * 1024));
		}

		return response(mode === 'malformed' ? {decision: 'invent'} : skip, mode === 'truncated' ? 'length' : 'stop');
	}));
	const planner = new OllamaPlanner(readConfig({}).planner);
	await expect(planner.propose(context, new AbortController().signal)).rejects.toThrow();
	expect(planner.busy).toBe(false);
});

it('preserves the original prompt, applies missing calendar defaults, and rejects impossible dates', async () => {
	const parsed = {
		...scene, year: 1932, calendar: {
			month: 10, day: null, hour: 1, minute: 0,
		},
	};
	vi.stubGlobal('fetch', vi.fn(async () => response(parsed)));
	const planner = new OllamaPlanner(readConfig({}).planner);
	expect(await planner.parseScene('Park in October 1932', new AbortController().signal)).toMatchObject({
		originalPrompt: 'Park in October 1932', year: 1932, simulatedStart: '1932-10-01T01:00:00Z',
	});
	vi.stubGlobal('fetch', vi.fn(async () => response({
		...parsed, calendar: {
			month: 2, day: 30, hour: 1, minute: 0,
		},
	})));
	await expect(planner.parseScene('February 30 1932', new AbortController().signal)).rejects.toThrow('calendar');
});

it('rejects remote planner origins and invalid opportunity distributions', () => {
	for (const url of ['https://example.com', 'http://127.0.0.1:11434/api', 'http://user:password@localhost:11434']) {
		expect(() => readConfig({OLLAMA_URL: url})).toThrow('local loopback');
	}

	for (const buckets of [[{weight: 0.5, minimumSeconds: 1, maximumSeconds: 2}], [{weight: 1, minimumSeconds: 3, maximumSeconds: 2}]]) {
		expect(() => readConfig({EVENT_DELAY_BUCKETS: JSON.stringify(buckets)})).toThrow();
	}
});

it('keeps requested music and crowds with sleep mode optional', async () => {
	const parsed = {
		...scene, sleepMode: false, audioPrompt: 'A cafe with jazz piano and indistinct crowd chatter.', constraints: ['no jazz piano', 'no crowd conversation'],
		calendar: {
			month: null, day: null, hour: null, minute: null,
		},
	};
	vi.stubGlobal('fetch', vi.fn(async () => response(parsed)));
	const planner = new OllamaPlanner(readConfig({}).planner);
	const result = await planner.parseScene('Cafe with jazz piano and crowd chatter', new AbortController().signal);
	expect(result.sleepMode).toBe(false);
	expect(result.constraints).toEqual([]);
	expect(result.audioPrompt).toContain('jazz piano');
	const excluded = await planner.parseScene('A cafe with jazz piano. No footsteps or wind.', new AbortController().signal);
	expect(excluded.constraints).toEqual(['No footsteps or wind']);
});

it.each([true, false])('honors an explicit sleep mode of %s even if the model disagrees', async sleepMode => {
	const fetch = vi.fn(async () => response({
		...scene, sleepMode: !sleepMode, audioPrompt: 'Jazz piano and crowd murmur', calendar: {
			month: null, day: null, hour: null, minute: null,
		},
	}));
	vi.stubGlobal('fetch', fetch);
	const planner = new OllamaPlanner(readConfig({}).planner);
	const result = await planner.parseScene('A cafe with jazz piano and crowd murmur', new AbortController().signal, sleepMode);
	expect(result.sleepMode).toBe(sleepMode);
	expect(result.constraints.length > 0).toBe(sleepMode);
	expect(result.audioPrompt).toContain('Jazz piano');
});
