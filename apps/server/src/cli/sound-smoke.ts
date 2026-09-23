import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {sceneSchema} from '@soundscapes/shared';
import {loadEnvironment, readConfig} from '../config.js';
import {PythonSoundGenerator} from '../generation/python.js';
import {GenerationService} from '../generation/service.js';
import {openStore} from '../persistence/open.js';

loadEnvironment();
const config = readConfig();
const directory = path.join(config.dataDirectory, 'sound-checks', String(Date.now()));
const isolated = {...config, dataDirectory: directory, sound: {...config.sound, output: path.join(directory, 'quarantine/sound')}};
const durationSeconds = process.argv.includes('--bed') ? 90 : 12;
const generator = new PythonSoundGenerator(isolated.sound);
const store = await openStore(directory);
const generation = new GenerationService(isolated, store, generator);
try {
	if (process.argv.includes('--scene')) {
		const scene = sceneSchema.parse({
			title: 'Quiet autumn park', originalPrompt: 'A quiet park at night, cool and dry with a gentle breeze through autumn leaves.',
			description: 'A quiet park at night with a gentle continuous breeze through autumn leaves.', location: 'A park', season: 'autumn', timeOfDay: 'night',
			weather: {temperature: 'cool', precipitation: 'dry', wind: 'gentle'}, sleepMode: true, simulatedStart: '2000-01-01T01:00:00Z', allowedEventCategories: ['wind', 'leaves'],
		});
		const owner = {sessionId: randomUUID(), signal: new AbortController().signal, valid: () => true};
		const started = performance.now();
		const beds = await generation.beds(scene, owner, assets => {
			console.log(`Validated ${assets.length}/4 beds`);
		});
		const preparationMs = performance.now() - started;
		const event = await generation.event(scene, {
			event: 'A soft breeze passing through distant autumn leaves', assetId: null, category: 'leaves', durationSeconds: 12, prominence: 0.1, reason: 'Local smoke test',
		}, owner);
		const reused = await generation.beds(scene, owner, () => undefined);
		assert.deepEqual(reused.map(asset => asset.id), beds.map(asset => asset.id));
		await writeFile(path.join(directory, 'scene.json'), `${JSON.stringify({
			scene, beds, event, preparationMs, reused: true,
		}, null, 2)}\n`);
		console.log(`PASS: four generated 90-second beds, a generated event, normalization and exact-scene reuse. Evidence: ${directory}`);
	} else {
		const result = await generator.generate({
			id: randomUUID(), sessionId: randomUUID(), kind: durationSeconds === 90 ? 'ambience' : 'event', seed: 1932, durationSeconds,
			prompt: 'A continuous soft breeze through autumn leaves in a quiet park at night. Very distant city air. Cool dry weather. '
				+ 'Gentle steady background, no voices, music, footsteps or sudden sounds.',
		}, new AbortController().signal);
		assert.equal(result.durationSeconds, durationSeconds);
		await mkdir(directory, {recursive: true});
		await writeFile(path.join(directory, `${Date.now()}.json`), `${JSON.stringify({device: config.sound.device, ...result}, null, 2)}\n`);
		console.log(JSON.stringify(result, null, 2));
		console.log('PASS: local offline worker generated the requested duration. Raw output is quarantined; not approved for playback.');
	}
} finally {
	await generation.close();
	store.close();
}
