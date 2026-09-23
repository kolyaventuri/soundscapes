import {createAmbienceFixtures} from '../assets/fixtures.js';
import {loadEnvironment, readConfig} from '../config.js';
import {openStore} from '../persistence/open.js';

loadEnvironment();
const config = readConfig();
const store = await openStore(config.dataDirectory);
try {
	await createAmbienceFixtures(config, store);
	console.log('Registered four normalized 90-second stereo ambience beds.');
	console.table(store.assets().map(({title, durationMs, meanDb, peakDb}) => ({
		title, durationMs, meanDb, peakDb,
	})));
} finally {
	store.close();
}
