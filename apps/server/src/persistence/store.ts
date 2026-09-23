import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {eventCategorySchema} from '@soundscapes/shared';
import {generationMetadataSchema} from '../generation/contracts.js';

export const assetSchema = z.object({
	id: z.uuid(), kind: z.enum(['ambience', 'event']), title: z.string(),
	file: z.string().regex(/^assets\/(ambience|events)\/[a-z\d-]+\.wav$/),
	durationMs: z.number().positive().max(120_000), sampleRate: z.literal(44_100), channels: z.literal(2),
	peakDb: z.number().max(-12), meanDb: z.number(), source: z.string(),
	usageCount: z.number().int().nonnegative().default(0), lastUsedAt: z.string().nullable().default(null),
	event: z.object({category: eventCategorySchema, tags: z.array(z.string().max(80)).max(12), reviewedSleepSafe: z.boolean()}).optional(),
	generation: generationMetadataSchema.optional(),
});
export type Asset = z.infer<typeof assetSchema>;

export class Store {
	private readonly db: DatabaseSync;
	private closed = false;

	constructor(file = ':memory:') {
		this.db = new DatabaseSync(file);
		this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
		const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
		if (version !== 0 && version !== 1 && version !== 2) {
			this.db.close();
			throw new Error(`Unsupported database version ${String(version)}`);
		}

		if (version === 0) {
			this.db.exec(`BEGIN IMMEDIATE;
				CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
				CREATE TABLE assets (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
				CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, playback_ms INTEGER NOT NULL, data TEXT NOT NULL);
				CREATE INDEX events_by_session ON events(session_id, playback_ms);
				PRAGMA user_version=1; COMMIT;`);
		}

		if (version !== 2) {
			this.db.exec(`BEGIN IMMEDIATE;
				CREATE TABLE preparation_timings (id INTEGER PRIMARY KEY, profile TEXT NOT NULL, elapsed_ms REAL NOT NULL);
				CREATE INDEX timings_by_profile ON preparation_timings(profile, id);
				PRAGMA user_version=2; COMMIT;`);
		}
	}

	recordTiming(profile: string, elapsedMs: number) {
		if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || profile.length > 512) {
			throw new Error('Invalid preparation timing');
		}

		this.db.prepare('INSERT INTO preparation_timings (profile, elapsed_ms) VALUES (?, ?)').run(profile, elapsedMs);
		this.db.prepare(`DELETE FROM preparation_timings WHERE profile=? AND id NOT IN
			(SELECT id FROM preparation_timings WHERE profile=? ORDER BY id DESC LIMIT 20)`).run(profile, profile);
		this.db.exec('DELETE FROM preparation_timings WHERE id NOT IN (SELECT id FROM preparation_timings ORDER BY id DESC LIMIT 512)');
	}

	timings(profile: string): number[] {
		return this.db.prepare('SELECT elapsed_ms FROM preparation_timings WHERE profile=? ORDER BY id DESC LIMIT 20').all(profile).map(row => Number(row.elapsed_ms));
	}

	saveSession(id: string, state: unknown) {
		this.db.prepare('INSERT INTO sessions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(id, JSON.stringify(state));
	}

	transaction(work: () => void) {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			work();
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	loadSessions(): unknown[] {
		return this.db.prepare('SELECT state FROM sessions').all().map(row => JSON.parse(String(row.state)) as unknown);
	}

	deleteSession(id: string) {
		this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
	}

	assets(): Asset[] {
		return this.db.prepare('SELECT metadata FROM assets ORDER BY id').all().map(row => assetSchema.parse(JSON.parse(String(row.metadata))));
	}

	putAsset(asset: Asset) {
		const validated = assetSchema.parse(asset);
		this.db.prepare('INSERT INTO assets VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(validated.id, JSON.stringify(validated));
	}

	useAsset(id: string, at: string) {
		const asset = this.assets().find(item => item.id === id);
		if (!asset) {
			throw new Error('Selected asset is missing from the library');
		}

		this.putAsset({...asset, usageCount: asset.usageCount + 1, lastUsedAt: at});
	}

	addEvent(id: string, sessionId: string, playbackMs: number, data: unknown) {
		this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(id, sessionId, playbackMs, JSON.stringify(data));
		this.db.prepare(`DELETE FROM events WHERE session_id=? AND id NOT IN
			(SELECT id FROM events WHERE session_id=? ORDER BY playback_ms DESC LIMIT 30)`).run(sessionId, sessionId);
	}

	events(sessionId: string): unknown[] {
		return this.db.prepare('SELECT data FROM events WHERE session_id=? ORDER BY playback_ms DESC LIMIT 30').all(sessionId).map(row => JSON.parse(String(row.data)) as unknown);
	}

	close() {
		if (!this.closed) {
			this.closed = true;
			this.db.close();
		}
	}
}
