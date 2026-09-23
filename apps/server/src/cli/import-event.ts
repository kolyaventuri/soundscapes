import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {eventImportSchema, importEvent} from '../assets/events.js';
import {loadEnvironment, readConfig} from '../config.js';
import {openStore} from '../persistence/open.js';

const {values} = parseArgs({options: {file: {type: 'string'}, metadata: {type: 'string'}}});
if (!values.file || !values.metadata) {
	throw new Error('Usage: pnpm event:import --file /absolute/event.wav --metadata /absolute/event.json');
}

loadEnvironment();
const config = readConfig();
const metadata = eventImportSchema.parse(JSON.parse(await readFile(path.resolve(values.metadata), 'utf8')));
const store = await openStore(config.dataDirectory);
try {
	const asset = await importEvent(path.resolve(values.file), metadata, config, store);
	console.log(JSON.stringify(asset, null, 2));
} finally {
	store.close();
}
