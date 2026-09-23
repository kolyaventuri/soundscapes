import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {importEvent} from '../assets/events.js';
import {playableAssets} from '../assets/fixtures.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';
import {openStore} from '../persistence/open.js';

loadEnvironment();
const config = readConfig();
const store = await openStore(config.dataDirectory);
const temporary = await mkdtemp(path.join(tmpdir(), 'soundscapes-event-fixture-'));
const source = 'Local synthetic breeze fixture; filtered pink noise, no speech/music; numeric checks only, listening acceptance pending';
try {
	const existing = await playableAssets(config, store, 'event');
	let asset = existing.find(asset => asset.source === source);
	if (!asset) {
		const file = path.join(temporary, 'breeze.wav');
		await runAudioCommand(config.ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-y',
			'-f',
			'lavfi',
			'-i',
			'anoisesrc=color=pink:amplitude=0.1:duration=12:seed=777',
			'-af',
			'lowpass=f=900',
			'-ac',
			'2',
			file,
		]);
		asset = await importEvent(file, {
			title: 'Gentle synthetic breeze', category: 'wind', tags: ['wind', 'breeze', 'subtle'], source, reviewedSleepSafe: true,
		}, config, store);
	}

	console.log(`Ready: ${asset.title} (${asset.id}). Synthetic test clip; not a field recording or listening acceptance.`);
} finally {
	store.close();
	await rm(temporary, {recursive: true, force: true});
}
