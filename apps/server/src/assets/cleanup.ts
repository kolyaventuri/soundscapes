import {realpath, rm} from 'node:fs/promises';
import path from 'node:path';
import {type Store} from '../persistence/store.js';

// Metadata retirement and this durable file queue let cleanup resume after a
// crash or filesystem error. Never walk directories or remove imported audio.
export async function cleanupDeletedAssets(store: Store, directory: string) {
	for (const file of store.pendingAssetDeletions()) {
		try {
			if (!store.referencesFile(file)) {
				// eslint-disable-next-line no-await-in-loop -- Finish each journal entry independently.
				await removeManagedFile(directory, file);
			}

			store.finishAssetDeletion(file);
		} catch {
			// Retain the entry for retry on the next deletion, last Close or restart.
		}
	}

	return store.pendingAssetDeletions().length;
}

async function removeManagedFile(directory: string, file: string) {
	try {
		const root = await realpath(directory);
		const parent = path.join(root, path.dirname(file));
		if (await realpath(parent) !== parent) {
			throw new Error('Refusing audio cleanup through a directory symlink');
		}

		await rm(path.join(parent, path.basename(file)), {force: true});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}
