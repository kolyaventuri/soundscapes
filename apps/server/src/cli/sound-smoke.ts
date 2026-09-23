import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {sceneSchema} from '@soundscapes/shared';
import {loadEnvironment, readConfig} from '../config.js';
import {PythonSoundGenerator} from '../generation/python.js';
import {GenerationService} from '../generation/service.js';
import {OllamaPlanner} from '../planning/ollama.js';
import {openStore} from '../persistence/open.js';
import {Preparation} from '../sessions/preparation.js';
import {type SoundGenerator, type SoundProgress} from '../generation/contracts.js';

loadEnvironment();
const config = readConfig();
const directory = path.join(config.dataDirectory, 'sound-checks', String(Date.now()));
const isolated = {...config, dataDirectory: directory, sound: {...config.sound, output: path.join(directory, 'quarantine/sound')}};
const promptIndex = process.argv.indexOf('--prompt');
const customPrompt = promptIndex === -1 ? undefined : process.argv[promptIndex + 1];
if (promptIndex >= 0 && !customPrompt) {
	throw new Error('--prompt needs a scene description');
}

const durationSeconds = process.argv.includes('--bed') ? 90 : 12;
const workerProgress: Array<{id: string; at: number; progress: SoundProgress}> = [];
class ObservedGenerator extends PythonSoundGenerator {
	override async generate(...[request, signal, progress]: Parameters<SoundGenerator['generate']>) {
		return super.generate(request, signal, value => {
			workerProgress.push({id: request.id, at: performance.now(), progress: value});
			progress?.(value);
		});
	}
}

const generator = new ObservedGenerator(isolated.sound);
const store = await openStore(directory);
const generation = new GenerationService(isolated, store, generator);
try {
	if (process.argv.includes('--scene')) {
		const scene = customPrompt
			? await new OllamaPlanner(config.planner).parseScene(customPrompt, new AbortController().signal)
			: sceneSchema.parse({
				title: 'Quiet autumn park', originalPrompt: 'A quiet park at night, cool and dry with a gentle breeze through autumn leaves.',
				description: 'A quiet park at night with a gentle continuous breeze through autumn leaves.', location: 'A park', season: 'autumn', timeOfDay: 'night',
				weather: {temperature: 'cool', precipitation: 'dry', wind: 'gentle'}, sleepMode: true, simulatedStart: '2000-01-01T01:00:00Z', allowedEventCategories: ['wind', 'leaves'],
			});
		const owner = {sessionId: randomUUID(), signal: new AbortController().signal, valid: () => true};
		const started = performance.now();
		const preparation = new Preparation(store, () => performance.now(), 4);
		const beds = await generation.beds(scene, owner, assets => {
			console.log(`Validated ${assets.length}/4 beds`);
		}, preparation);
		const preparationMs = performance.now() - started;
		const event = customPrompt
			? undefined
			: await generation.event(scene, {
				event: 'A soft breeze passing through distant autumn leaves', assetId: null, category: 'leaves', durationSeconds: 12, prominence: 0.1, reason: 'Local smoke test',
			}, owner);
		const reusePreparation = new Preparation(store, () => performance.now(), 4);
		const progressCount = workerProgress.length;
		const reused = await generation.beds(scene, owner, () => undefined, reusePreparation);
		assert.deepEqual(reused.map(asset => asset.id), beds.map(asset => asset.id));
		assert.equal(workerProgress.length, progressCount);
		assert.equal(reusePreparation.reusedBeds, 4);
		for (const bed of beds) {
			const updates = workerProgress.filter(item => item.id === bed.id);
			assert.ok(updates.some(item => item.progress.stage === 'loading'));
			assert.ok(updates.some(item => item.progress.stage === 'generating'));
			if (config.sound.device === 'mlx') {
				assert.deepEqual(updates.filter(item => item.progress.step).map(item => item.progress.step!.completed), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
			}
		}

		await writeFile(path.join(directory, 'scene.json'), `${JSON.stringify({
			scene, beds, event, preparationMs, reused: true, workerProgress, reusedBeds: reusePreparation.reusedBeds,
		}, null, 2)}\n`);
		console.log(`PASS: four generated 90-second beds, normalization and exact-scene reuse${event ? ', plus a generated event' : ''}. Evidence: ${directory}`);
	} else {
		const prompt = customPrompt ?? 'A continuous soft breeze through autumn leaves in a quiet park at night. Very distant city air. Cool dry weather. '
			+ 'Gentle steady background, no voices, music, footsteps or sudden sounds.';
		const result = await generator.generate({
			id: randomUUID(), sessionId: randomUUID(), kind: durationSeconds === 90 ? 'ambience' : 'event', seed: 1932, durationSeconds,
			prompt,
		}, new AbortController().signal);
		assert.equal(result.durationSeconds, durationSeconds);
		await mkdir(directory, {recursive: true});
		await writeFile(path.join(directory, `${Date.now()}.json`), `${JSON.stringify({
			device: config.sound.device, prompt, seed: 1932, ...result,
		}, null, 2)}\n`);
		console.log(JSON.stringify(result, null, 2));
		console.log('PASS: local offline worker generated the requested duration. Raw output is quarantined; not approved for playback.');
	}
} finally {
	await generation.close();
	store.close();
}
