import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {claimServer} from './open.js';
import {Store} from './store.js';

it('migrates once, persists sessions and assets, and bounds event history with ownership cleanup', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-db-'));
	const file = path.join(directory, 'test.sqlite');
	let store = new Store(file);
	try {
		store.saveSession('session', {elapsedMs: 42});
		const id = randomUUID();
		store.putAsset({
			id, kind: 'ambience', title: 'Test', file: 'assets/ambience/test.wav', durationMs: 90_000, sampleRate: 44_100, channels: 2, peakDb: -20, meanDb: -36, source: 'Local', usageCount: 0, lastUsedAt: null,
		});
		store.useAsset(id, '2026-09-23T00:00:00Z');
		for (let index = 0; index < 100; index++) {
			store.addEvent(randomUUID(), 'session', index * 120_000, {index});
		}

		expect(store.events('session').length).toBeLessThanOrEqual(31);
		store.close();
		store = new Store(file);
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
