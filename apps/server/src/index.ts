import {existsSync} from 'node:fs';
import process, {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {buildApp} from './app.js';
import {readConfig} from './config.js';

const environmentFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentFile)) {
	loadEnvFile(environmentFile);
}

const config = readConfig();
const serveWeb = process.argv.includes('--serve-web');
const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (serveWeb && !existsSync(new URL('../../web/dist/index.html', import.meta.url))) {
	throw new Error('Build the web client with pnpm build before pnpm start.');
}

const app = await buildApp({
	logger: {level: config.logLevel},
	...(serveWeb ? {webRoot} : {}),
});

async function shutdown() {
	try {
		await app.close();
	} catch (error) {
		app.log.error(error, 'Shutdown failed');
		process.exitCode = 1;
	}
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		void shutdown();
	});
}

try {
	await app.listen({host: config.host, port: config.port});
} catch (error) {
	app.log.error(error, 'Server failed to start');
	await app.close();
	process.exitCode = 1;
}
