import {
	mkdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {Store} from './store.js';

export async function openStore(directory: string) {
	await mkdir(directory, {recursive: true});
	return new Store(path.join(directory, 'soundscapes.sqlite'));
}

// A server owns the session files. Fixture registration may use a separate DB
// connection, but two servers must never clean up or render into the same root.
export async function claimServer(directory: string) {
	await mkdir(directory, {recursive: true});
	const lock = path.join(directory, '.server.lock');
	try {
		const owner = Number(await readFile(lock, 'utf8'));
		if (!Number.isInteger(owner) || owner <= 0) {
			throw new Error('Invalid server lock; inspect data/.server.lock before removing it');
		}

		try {
			process.kill(owner, 0);
			throw new Error(`Data directory is already in use by server PID ${owner}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
				throw error;
			}
		}

		await rm(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	await writeFile(lock, String(process.pid), {flag: 'wx'});
	return async () => rm(lock, {force: true});
}
