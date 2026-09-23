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

	const result = {
		at: new Date().toISOString(), model: config.planner.model, sceneMs, nullMs, eventMs: performance.now() - eventStarted,
		maximumModelBytes, maximumGpuBytes, scene, empty, proposal,
		note: 'Real local model calls. Memory is sampled Ollama-reported model/VRAM allocation, not total host usage or an overnight result.',
	};
	const directory = path.join(config.dataDirectory, 'planner-checks');
	await mkdir(directory, {recursive: true});
	const file = path.join(directory, `${Date.now()}.json`);
	await writeJson(file, result);
	console.log(JSON.stringify(result, null, 2));
	console.log(`PASS: scene/date contract, empty-library null and library-only proposal. Evidence: ${file}`);
} finally {
	clearInterval(timer);
}
