import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function dataDirectory(override) {
	if (existsSync(path.join(root, '.env'))) {
		process.loadEnvFile(path.join(root, '.env'));
	}

	return path.resolve(root, override ?? process.env.DATA_DIR ?? 'data');
}

export function readReport(directory, id) {
	const database = path.join(directory, 'soundscapes.sqlite');
	if (!existsSync(database)) {
		throw new Error(`Database not found: ${database}`);
	}

	const db = new DatabaseSync(database, {readOnly: true});
	try {
		// One snapshot keeps pool membership and asset metadata consistent during generation.
		db.exec('BEGIN');
		const row = id === undefined
			? db.prepare('SELECT id, state FROM sessions ORDER BY CAST(json_extract(state, \'$.createdAt\') AS REAL) DESC, id DESC LIMIT 1').get()
			: db.prepare('SELECT id, state FROM sessions WHERE id = ?').get(id);
		if (!row) {
			if (id === undefined) {
				throw new Error(`No saved sessions found in ${database}.`);
			}

			throw new Error(`Session ${id} not found in ${database}. Stopped sessions may have been removed.`);
		}

		const state = JSON.parse(row.state);
		const groups = state.layered?.layers?.map(layer => ({
			id: layer.policy.id, policy: layer.policy, assetIds: layer.assetIds, clips: layer.clips,
		})) ?? [{id: 'ambience', assetIds: state.assetIds ?? [], clips: state.timeline?.beds ?? []}];
		if (state.scheduledEvents?.length) {
			groups.push({id: 'scheduled-events', assetIds: state.scheduledEvents.map(event => event.assetId), clips: state.scheduledEvents});
		}

		const query = db.prepare('SELECT rowid AS wavNumber, metadata FROM assets WHERE id = ?');
		return {
			id: row.id, database, status: state.status, mode: state.generationMode ?? 'simple', scene: state.scene,
			acoustics: state.layered?.plan?.acoustics,
			groups: groups.map(group => ({
				...group,
				assets: [...new Set(group.assetIds)].map(assetId => {
					const assetRow = query.get(assetId);
					if (!assetRow) {
						return {id: assetId, missingMetadata: true};
					}

					const asset = JSON.parse(assetRow.metadata);
					const absoluteFile = path.resolve(directory, asset.file);
					return {
						...asset, wavNumber: assetRow.wavNumber, absoluteFile, fileExists: existsSync(absoluteFile),
					};
				}),
			})),
		};
	} finally {
		db.close();
	}
}

