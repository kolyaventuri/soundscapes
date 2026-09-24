import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {sceneSchema, sceneLibrarySchema} from '@soundscapes/shared';
import {expect, it} from 'vitest';
import {claimServer} from './open.js';
import {Store} from './store.js';

it('migrates a v1 database without dropping sessions and bounds preparation timings', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-timing-'));
	const file = path.join(directory, 'test.sqlite');
	const legacy = new DatabaseSync(file);
	legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL); PRAGMA user_version=1;');
	legacy.prepare('INSERT INTO sessions VALUES (?, ?)').run('existing', '{"elapsedMs":42}');
	legacy.close();
	const store = new Store(file);
	try {
		expect(store.loadSessions()).toEqual([{elapsedMs: 42}]);
		for (let index = 0; index < 30; index++) {
			store.recordTiming('model', index);
		}

		expect(store.timings('model')).toHaveLength(20);
		expect(store.timings('model')[0]).toBe(29);
		for (let index = 0; index < 520; index++) {
			store.recordTiming(`profile-${index}`, 10);
		}

		expect(store.timings('model')).toEqual([]);
		expect(store.timings('profile-7')).toEqual([]);
		expect(store.timings('profile-8')).toEqual([10]);
		expect(() => {
			store.recordTiming('bad', Number.NaN);
		}).toThrow();
	} finally {
		store.close();
		await rm(directory, {recursive: true, force: true});
	}
});

it('migrates once, persists sessions and assets, and bounds event history with ownership cleanup', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-db-'));
	const file = path.join(directory, 'test.sqlite');
	let store = new Store(file);
	try {
		store.saveSession('session', {elapsedMs: 42});
		const id = randomUUID();
		store.putAsset({
			id, kind: 'ambience', title: 'Test', file: 'assets/ambience/test.wav', durationMs: 90_000,
			sampleRate: 44_100, channels: 2, peakDb: -20, meanDb: -36, source: 'Local', usageCount: 0, lastUsedAt: null,
		});
		store.useAsset(id, '2026-09-23T00:00:00Z');
		for (let index = 0; index < 100; index++) {
			store.addEvent(randomUUID(), 'session', index * 120_000, {index});
		}

		const expectedHistory = Array.from({length: 30}, (value, index) => ({index: 99 - index}));
		expect(store.events('session')).toEqual(expectedHistory);
		expect(store.events('another-session')).toEqual([]);
		store.close();
		store = new Store(file);
		expect(store.events('session')).toEqual(expectedHistory);
		expect(() => {
			store.transaction(() => {
				store.addEvent(randomUUID(), 'session', 12_000_000, {index: 100});
				store.useAsset(id, 'rolled-back');
				throw new Error('Abort scheduling transaction');
			});
		}).toThrow('Abort scheduling transaction');
		expect(store.events('session')).toEqual(expectedHistory);
		expect(store.loadSessions()).toEqual([{elapsedMs: 42}]);
		expect(store.assets()[0]).toMatchObject({usageCount: 1, lastUsedAt: '2026-09-23T00:00:00Z'});
		store.deleteSession('session');
		expect(store.events('session')).toEqual([]);
		expect(store.assets()).toHaveLength(1);
	} finally {
		store.close();
		await rm(directory, {recursive: true, force: true});
	}
});

it('refuses two servers sharing a data directory and rejects an invalid ownership lock', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-owner-'));
	try {
		const release = await claimServer(directory);
		try {
			await expect(claimServer(directory)).rejects.toThrow('already in use');
		} finally {
			await release();
		}

		await writeFile(path.join(directory, '.server.lock'), 'invalid');
		await expect(claimServer(directory)).rejects.toThrow('Invalid server lock');
	} finally {
		await rm(directory, {recursive: true, force: true});
	}
});

it('migrates v2 and retains searchable, deduplicated scene recipes independently of sessions', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-library-'));
	const file = path.join(directory, 'test.sqlite');
	const legacy = new DatabaseSync(file);
	legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL); PRAGMA user_version=2;');
	legacy.prepare('INSERT INTO sessions VALUES (?, ?)').run('original', '{"elapsedMs":42}');
	legacy.close();
	let store = new Store(file);
	const scene = sceneSchema.parse({
		title: 'Ocean café', originalPrompt: 'Waves beside a café', location: 'Beach', sleepMode: false, simulatedStart: '2000-01-01T01:00:00Z',
	});
	const recipe = {
		scene, generationMode: 'simple' as const, layerPlan: null, savedAt: '2026-09-24T00:00:00Z',
	};
	try {
		expect(store.loadSessions()).toEqual([{elapsedMs: 42}]);
		store.rememberScene(recipe);
		const original = store.scenes().scenes[0]!;
		store.rememberScene({...recipe, scene: {...scene, originalPrompt: `  ${scene.originalPrompt}  `}});
		store.rememberScene({...recipe, generationMode: 'layered'});
		store.rememberScene({...recipe, scene: {...scene, sleepMode: true}});
		expect(store.scenes().total).toBe(3);
		for (let index = 0; index < 15; index++) {
			store.rememberScene({
				...recipe, scene: {
					...scene, originalPrompt: `Forest ${index}`, title: `Forest ${index}`, location: 'Woodland',
				},
			});
		}

		expect(sceneLibrarySchema.parse(store.scenes()).scenes).toHaveLength(12);
		const secondPage = store.scenes('', 12);
		expect(secondPage.scenes).toHaveLength(6);
		expect(new Set([...store.scenes().scenes, ...secondPage.scenes].map(item => item.id)).size).toBe(18);
		expect(store.scenes('BEACH').total).toBe(3);
		expect(store.scenes('waves').total).toBe(3);
		expect(store.scenes('%\' OR 1=1 --').total).toBe(0);
		expect(store.scenes('', 99).scenes).toEqual([]);
		store.deleteSession('original');
		store.close();
		store = new Store(file);
		expect(store.scenes().total).toBe(18);
		expect(store.scenes('waves').scenes).toContainEqual(original);
		expect(store.loadSessions()).toEqual([]);
	} finally {
		store.close();
		await rm(directory, {recursive: true, force: true});
	}
});
