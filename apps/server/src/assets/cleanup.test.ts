import {randomUUID} from 'node:crypto';
import {
	mkdtemp, mkdir, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {sceneSchema, type Scene} from '@soundscapes/shared';
import {afterEach, expect, it} from 'vitest';
import {Store, assetSchema} from '../persistence/store.js';
import {sceneKey} from './reuse.js';
import {cleanupDeletedAssets} from './cleanup.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map(async cleanup => cleanup())));

function recipe(prompt: string) {
	return {
		scene: sceneSchema.parse({
			title: prompt, originalPrompt: prompt, sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
		}),
		generationMode: 'simple' as const, layerPlan: null, savedAt: '2026-09-24T00:00:00Z',
	};
}

function generated(scene: Scene) {
	const id = randomUUID();
	return assetSchema.parse({
		id, kind: 'ambience', title: 'Generated bed', file: `assets/ambience/${id}.wav`,
		durationMs: 90_000, sampleRate: 44_100, channels: 2, peakDb: -20, meanDb: -36, source: 'Generated',
		generation: {
			model: 'test', revision: 'test', seed: 1, prompt: scene.originalPrompt, sceneKey: sceneKey(scene), assetKey: 'a'.repeat(64),
			createdAt: '2026-09-24T00:00:00Z', validation: 'levels-v2', elapsedMs: 1,
		},
	});
}

async function setup() {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-deletion-'));
	const database = path.join(directory, 'test.sqlite');
	const store = new Store(database);
	await mkdir(path.join(directory, 'assets/ambience'), {recursive: true});
	cleanups.push(async () => {
		store.close();
		await rm(directory, {recursive: true, force: true});
	});
	return {store, directory, database};
}

it('keeps shared recordings until the last scene is deleted, including reuse from another prompt', async () => {
	const {store, directory} = await setup();
	const first = recipe('Cafe');
	const second = recipe('Restaurant');
	const firstId = store.rememberScene(first);
	const secondId = store.rememberScene(second);
	const shared = generated(first.scene);
	const exclusive = generated(first.scene);
	const unrelated = generated(recipe('Forest').scene);
	const imported = {...generated(first.scene), generation: undefined};
	for (const asset of [shared, exclusive, unrelated, imported]) {
		store.putAsset(asset);
		// eslint-disable-next-line no-await-in-loop -- Small, independent fixture files.
		await writeFile(path.join(directory, asset.file), asset.id);
	}

	store.linkSceneAssets(firstId, [shared.id, exclusive.id, imported.id]);
	store.linkSceneAssets(secondId, [shared.id]);
	store.deleteScene(firstId);
	store.retireOrphanedAssets();
	expect(await cleanupDeletedAssets(store, directory)).toBe(0);
	expect(await readFile(path.join(directory, shared.file), 'utf8')).toBe(shared.id);
	await expect(readFile(path.join(directory, exclusive.file))).rejects.toMatchObject({code: 'ENOENT'});
	expect(store.assets().map(asset => asset.id).sort()).toEqual([shared.id, unrelated.id, imported.id].sort());
	store.deleteScene(secondId);
	store.retireOrphanedAssets();
	expect(await cleanupDeletedAssets(store, directory)).toBe(0);
	await expect(readFile(path.join(directory, shared.file))).rejects.toMatchObject({code: 'ENOENT'});
	expect(await readFile(path.join(directory, imported.file), 'utf8')).toBe(imported.id);
	expect(await readFile(path.join(directory, unrelated.file), 'utf8')).toBe(unrelated.id);
});

it('recovers file cleanup after restart and tolerates already missing WAVs', async () => {
	const {store, directory, database} = await setup();
	const saved = recipe('Rain');
	const id = store.rememberScene(saved);
	const existing = generated(saved.scene);
	const missing = generated(saved.scene);
	store.putAsset(existing);
	store.putAsset(missing);
	await writeFile(path.join(directory, existing.file), 'audio');
	store.deleteScene(id);
	// A cancelled worker may publish its final result while sessions close.
	const late = generated(saved.scene);
	store.putAsset(late);
	store.retireOrphanedAssets();
	expect(store.pendingAssetDeletions()).toHaveLength(3);
	store.close();
	const restored = new Store(database);
	try {
		expect(restored.scenes().total).toBe(0);
		expect(restored.assets()).toEqual([]);
		expect(await cleanupDeletedAssets(restored, directory)).toBe(0);
		await expect(readFile(path.join(directory, existing.file))).rejects.toMatchObject({code: 'ENOENT'});
	} finally {
		restored.close();
	}
});

it('preserves a WAV still referenced by another asset and retries unsafe directory layouts', async () => {
	const {store, directory} = await setup();
	const saved = recipe('Wind');
	const id = store.rememberScene(saved);
	const asset = generated(saved.scene);
	store.putAsset(asset);
	const alias = {...asset, id: randomUUID(), generation: undefined};
	store.putAsset(alias);
	await writeFile(path.join(directory, asset.file), 'shared path');
	store.deleteScene(id);
	store.retireOrphanedAssets();
	expect(await cleanupDeletedAssets(store, directory)).toBe(0);
	expect(await readFile(path.join(directory, asset.file), 'utf8')).toBe('shared path');

	const next = store.rememberScene(saved);
	const unsafe = generated(saved.scene);
	store.putAsset(unsafe);
	await rm(path.join(directory, 'assets/ambience'), {recursive: true});
	const elsewhere = path.join(directory, 'elsewhere');
	await mkdir(elsewhere);
	await writeFile(path.join(elsewhere, path.basename(unsafe.file)), 'keep');
	await symlink(elsewhere, path.join(directory, 'assets/ambience'));
	store.deleteScene(next);
	store.retireOrphanedAssets();
	expect(await cleanupDeletedAssets(store, directory)).toBe(1);
	expect(await readFile(path.join(elsewhere, path.basename(unsafe.file)), 'utf8')).toBe('keep');
	await rm(path.join(directory, 'assets/ambience'));
	await mkdir(path.join(directory, 'assets/ambience'));
	expect(await cleanupDeletedAssets(store, directory)).toBe(0);
});

it('migrates legacy provenance conservatively across saved modes and previously reused events', async () => {
	const {store, database} = await setup();
	const saved = recipe('A Cafe');
	const simple = store.rememberScene(saved);
	const layered = store.rememberScene({...saved, generationMode: 'layered'});
	const other = store.rememberScene(recipe('Another cafe'));
	const bed = generated(saved.scene);
	const event = assetSchema.parse({
		...generated(saved.scene), kind: 'event', usageCount: 1, affinity: saved.scene,
		event: {category: 'water', tags: ['water'], reviewedSleepSafe: false},
	});
	store.putAsset(bed);
	store.putAsset(event);
	store.close();
	const legacy = new DatabaseSync(database);
	legacy.exec('DROP TABLE scene_assets; DROP TABLE orphan_candidates; DROP TABLE deleted_scene_prompts; DROP TABLE asset_deletions; PRAGMA user_version=3;');
	legacy.close();
	const restored = new Store(database);
	try {
		restored.deleteScene(simple);
		restored.retireOrphanedAssets();
		expect(restored.assets()).toHaveLength(2);
		restored.deleteScene(layered);
		restored.retireOrphanedAssets();
		expect(restored.assets().map(asset => asset.id)).toEqual([event.id]);
		restored.deleteScene(other);
		restored.retireOrphanedAssets();
		expect(restored.assets()).toEqual([]);
	} finally {
		restored.close();
	}
});
