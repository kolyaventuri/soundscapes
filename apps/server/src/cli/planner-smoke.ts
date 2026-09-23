import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {loadEnvironment, readConfig} from '../config.js';
import {OllamaPlanner} from '../planning/ollama.js';
import {writeJson} from '../monitoring/storage.js';

loadEnvironment();
const config = readConfig();
const planner = new OllamaPlanner(config.planner);
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
	const defaulted = await planner.parseScene('A sheltered woodland at night in autumn. Steady soft rain on leaves, mild temperature, no wind. '
		+ 'No people, voices, music, animals, thunder or sharp sounds.', signal);
	assert.equal(defaulted.year, null);
	assert.equal(defaulted.simulatedStart, '2000-01-01T01:00:00Z');
	assert.ok(!defaulted.allowedEventCategories.includes('distant-footsteps'));
	assert.ok(!defaulted.allowedEventCategories.includes('insects'));
	assert.ok(!defaulted.allowedEventCategories.includes('wind'));
	const cafe = await planner.parseScene('Inside a busy cafe: espresso machine, clinking cups, indistinct crowd conversation and soft jazz piano played in the room.', signal);
	assert.equal(cafe.sleepMode, false);
	assert.match(cafe.audioPrompt, /piano|jazz/i);
	assert.match(cafe.audioPrompt, /crowd|conversation|chatter|murmur/i);
	assert.deepEqual(cafe.constraints, [], 'Do not invent exclusions for requested sources');
	const sleepCafe = await planner.parseScene('A cafe with jazz piano and crowd murmur.', signal, true);
	assert.equal(sleepCafe.sleepMode, true);
	assert.match(sleepCafe.audioPrompt, /piano|jazz/i);
	assert.match(sleepCafe.audioPrompt, /crowd|conversation|chatter|murmur/i);
	const awakeCafe = await planner.parseScene('A cafe with jazz piano and crowd murmur, a place to fall asleep.', signal, false);
	assert.equal(awakeCafe.sleepMode, false);
	assert.deepEqual(awakeCafe.constraints, []);
	const result = {
		at: new Date().toISOString(), model: config.planner.model, sceneMs, nullMs, eventMs,
		maximumModelBytes, maximumGpuBytes, scene, empty, proposal, generatedProposal, generationProposalMs, defaulted, cafe, sleepCafe, awakeCafe,
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
