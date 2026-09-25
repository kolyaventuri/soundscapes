import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {sceneSchema} from '@soundscapes/shared';
import {explicitSoundConstraints} from '../planning/scene-constraints.js';
import {loadEnvironment, readConfig} from '../config.js';
import {OllamaPlanner} from '../planning/ollama.js';
import {writeJson} from '../monitoring/storage.js';
import {
	checkLayerPlans, cafePrompt, rainPrompt, creekPrompt,
} from './layer-regression.js';

loadEnvironment();
const config = readConfig();
const planner = new OllamaPlanner(config.planner);
if (process.argv.includes('--scenes')) {
	const {signal} = new AbortController();
	const creek = await planner.parseScene(creekPrompt, signal);
	assert.match(creek.ambiencePrompt, /water|creek|trickl/i);
	assert.doesNotMatch(creek.ambiencePrompt, /bird|chirp|call/i);
	assert.ok(creek.allowedEventCategories.includes('birds'));
	assert.ok(!creek.allowedEventCategories.includes('objects'));
	const cafe = await planner.parseScene(cafePrompt, signal);
	assert.match(cafe.ambiencePrompt, /piano|jazz/i);
	assert.match(cafe.ambiencePrompt, /crowd|conversation|chatter|murmur/i);
	const rain = await planner.parseScene('Inside a quiet bedroom, steady rain patters against a closed window and drips from the eaves. No thunder, voices, traffic or music.', signal);
	assert.match(rain.ambiencePrompt, /rain|droplet/i);
	assert.match(rain.ambiencePrompt, /window|glass/i);
	assert.doesNotMatch(rain.ambiencePrompt, /thunder|voice|traffic|music/i);
	assert.ok(rain.constraints.some(value => /thunder/i.test(value)));
	const file = path.join(config.dataDirectory, 'planner-checks', `${Date.now()}-scenes.json`);
	await mkdir(path.dirname(file), {recursive: true});
	await writeJson(file, {
		model: config.planner.model, creek, cafe, rain,
	});
	console.log(`PASS: real creek event separation, ongoing cafe music/crowd coverage, and window-rain caption/constraints. Evidence: ${file}`);
	// eslint-disable-next-line unicorn/no-process-exit -- All model and file work is awaited.
	process.exit(0);
}

// Focused rerun for layer-caption/policy iterations; the default still exercises
// the full parser/event suite before running these same layer assertions.
if (process.argv.includes('--layers')) {
	const scene = (originalPrompt: string) => sceneSchema.parse({
		title: 'Layer regression', originalPrompt, sleepMode: false, constraints: explicitSoundConstraints(originalPrompt), simulatedStart: '2000-01-01T01:00:00Z',
	});
	const started = performance.now();
	const plans = await checkLayerPlans(planner, new AbortController().signal, scene(cafePrompt), scene(rainPrompt));
	const directory = path.join(config.dataDirectory, 'planner-checks');
	await mkdir(directory, {recursive: true});
	const file = path.join(directory, `${Date.now()}-layers.json`);
	await writeJson(file, {
		at: new Date().toISOString(), model: config.planner.model, elapsedMs: performance.now() - started, ...plans,
	});
	console.log(`PASS: real cafe/rain/band/beach layer coverage, isolation, continuity and beach balance. Evidence: ${file}`);
	// eslint-disable-next-line unicorn/no-process-exit -- Completed CLI subcommand; all requests and file writes are awaited.
	process.exit(0);
}

let maximumModelBytes = 0;
let maximumGpuBytes = 0;
let polling = false;
const timer = setInterval(() => {
	if (polling) {
		return;
	}

	polling = true;
	void (async () => {
		try {
			const response = await fetch(`${config.planner.url}/api/ps`, {signal: AbortSignal.timeout(2000)});
			const body = await response.json() as {models?: Array<{size: number; size_vram: number}>};
			maximumModelBytes = Math.max(maximumModelBytes, ...(body.models ?? []).map(model => model.size));
			maximumGpuBytes = Math.max(maximumGpuBytes, ...(body.models ?? []).map(model => model.size_vram));
		} catch {
			// The inference request reports connection failures; telemetry is best effort.
		} finally {
			polling = false;
		}
	})();
}, 500);
const started = performance.now();
try {
	const {signal} = new AbortController();
	const scene = await planner.parseScene('Central Park, New York City, October 1932, around 1 AM. Cool autumn night, light wind, no rain. Sparse distant activity. Intended for sleep.', signal);
	const sceneMs = performance.now() - started;
	assert.equal(scene.year, 1932);
	assert.equal(scene.simulatedStart, '1932-10-01T01:00:00Z');
	const context = {
		scene, simulatedTime: '1932-10-01T01:20:00Z', elapsedMs: 1_200_000, ambientState: ['Soft air'], recentEvents: [], library: [], earliestPlaybackMs: 1_320_000,
	};
	const nullStarted = performance.now();
	const empty = await planner.propose(context, signal);
	assert.equal(empty.event, null, 'An empty library must result in null');
	const nullMs = performance.now() - nullStarted;
	const eventStarted = performance.now();
	const proposal = await planner.propose({
		...context, library: [{
			id: 'a1932000-0000-4000-8000-000000000099', title: 'Gentle breeze through trees', category: 'wind', durationSeconds: 10, tags: ['wind', 'subtle', 'park'],
		}],
	}, signal);
	if (proposal.event !== null) {
		assert.equal(proposal.assetId, 'a1932000-0000-4000-8000-000000000099');
		assert.equal(proposal.category, 'wind');
	}

	const eventMs = performance.now() - eventStarted;
	const generationStarted = performance.now();
	const generatedProposal = await planner.propose({
		...context, canGenerate: true,
		scene: {
			...scene, originalPrompt: 'A quiet park at night. Very occasional distant footsteps on a gravel path beyond the trees. No voices or music.',
			description: 'A quiet park with a distant gravel path where occasional gentle footsteps are welcome.', allowedEventCategories: ['distant-footsteps'],
		},
	}, signal);
	if (generatedProposal.event !== null) {
		assert.equal(generatedProposal.assetId, null);
		assert.equal(generatedProposal.category, 'distant-footsteps');
		assert.ok(generatedProposal.durationSeconds! >= 2);
	}

	const generationProposalMs = performance.now() - generationStarted;
	const defaulted = await planner.parseScene(rainPrompt, signal);
	assert.equal(defaulted.year, null);
	assert.equal(defaulted.simulatedStart, '2000-01-01T01:00:00Z');
	assert.ok(!defaulted.allowedEventCategories.includes('distant-footsteps'));
	assert.ok(!defaulted.allowedEventCategories.includes('insects'));
	assert.ok(!defaulted.allowedEventCategories.includes('wind'));
	const cafe = await planner.parseScene(cafePrompt, signal);
	assert.equal(cafe.sleepMode, false);
	assert.match(cafe.audioPrompt, /piano|jazz/i);
	assert.match(cafe.audioPrompt, /crowd|conversation|chatter|murmur/i);
	assert.match(cafe.ambiencePrompt, /piano|jazz/i);
	assert.match(cafe.ambiencePrompt, /crowd|conversation|chatter|murmur/i);
	assert.deepEqual(cafe.constraints, [], 'Do not invent exclusions for requested sources');
	const sleepCafe = await planner.parseScene('A cafe with jazz piano and crowd murmur.', signal, true);
	assert.equal(sleepCafe.sleepMode, true);
	assert.match(sleepCafe.audioPrompt, /piano|jazz/i);
	assert.match(sleepCafe.audioPrompt, /crowd|conversation|chatter|murmur/i);
	const awakeCafe = await planner.parseScene('A cafe with jazz piano and crowd murmur, a place to fall asleep.', signal, false);
	assert.equal(awakeCafe.sleepMode, false);
	assert.deepEqual(awakeCafe.constraints, []);
	const creek = await planner.parseScene(creekPrompt, signal);
	assert.match(creek.ambiencePrompt, /water|creek|trickl/i);
	assert.doesNotMatch(creek.ambiencePrompt, /bird|chirp|call/i);
	assert.ok(creek.allowedEventCategories.includes('birds'));
	assert.ok(!creek.allowedEventCategories.includes('objects'));
	const layers = await checkLayerPlans(planner, signal, cafe, defaulted);
	const result = {
		at: new Date().toISOString(), model: config.planner.model, sceneMs, nullMs, eventMs,
		maximumModelBytes, maximumGpuBytes, scene, empty, proposal, generatedProposal, generationProposalMs,
		defaulted, cafe, sleepCafe, awakeCafe, creek, ...layers,
		note: 'Real local model calls. Memory is sampled Ollama-reported model/VRAM allocation, not total host usage or an overnight result.',
	};
	const directory = path.join(config.dataDirectory, 'planner-checks');
	await mkdir(directory, {recursive: true});
	const file = path.join(directory, `${Date.now()}.json`);
	await writeJson(file, result);
	console.log(JSON.stringify(result, null, 2));
	console.log(`PASS: scene/date contract, empty-library null, library-only and generation-enabled proposals. Evidence: ${file}`);
} finally {
	clearInterval(timer);
}
