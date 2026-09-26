import {createHash, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {
	eventCategorySchema, sceneSchema, savedSceneSchema, sceneLibraryPageSize, type SavedScene,
} from '@soundscapes/shared';
import {generationMetadataSchema} from '../generation/contracts.js';
import {sceneKey} from '../assets/reuse.js';

function recipeFingerprint(value: Pick<SavedScene, 'scene' | 'generationMode'>) {
	return createHash('sha256').update(JSON.stringify([
		value.scene.originalPrompt.trim(), value.scene.sleepMode, value.generationMode,
	])).digest('hex');
}

export const assetSchema = z.object({
	id: z.uuid(), kind: z.enum(['ambience', 'event']), title: z.string(),
	file: z.string().regex(/^assets\/(ambience|events)\/[a-z\d-]+\.wav$/),
	durationMs: z.number().positive().max(120_000), sampleRate: z.literal(44_100), channels: z.literal(2),
	peakDb: z.number().max(-12), meanDb: z.number(), source: z.string(),
	usageCount: z.number().int().nonnegative().default(0), lastUsedAt: z.string().nullable().default(null),
	event: z.object({category: eventCategorySchema, tags: z.array(z.string().max(80)).max(12), reviewedSleepSafe: z.boolean()}).optional(),
	affinity: sceneSchema.pick({
		location: true, year: true, season: true, timeOfDay: true, weather: true,
	}).optional(),
	generation: generationMetadataSchema.optional(),
});
export type Asset = z.infer<typeof assetSchema>;

const historicalReferencesSchema = z.object({
	scene: sceneSchema, generationMode: z.enum(['simple', 'layered']).default('simple'),
	assetIds: z.array(z.string()).default([]),
	timeline: z.object({beds: z.array(z.object({assetId: z.string()}))}).default({beds: []}),
	scheduledEvents: z.array(z.object({assetId: z.string()})).default([]),
	layered: z.object({layers: z.array(z.object({assetIds: z.array(z.string())}))}).optional(),
});

export class Store {
	private readonly db: DatabaseSync;
	private closed = false;

	constructor(file = ':memory:') {
		this.db = new DatabaseSync(file);
		this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
		const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
		if (![0, 1, 2, 3, 4, 5].includes(Number(version))) {
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

		if (version === 0 || version === 1) {
			this.db.exec(`BEGIN IMMEDIATE;
				CREATE TABLE preparation_timings (id INTEGER PRIMARY KEY, profile TEXT NOT NULL, elapsed_ms REAL NOT NULL);
				CREATE INDEX timings_by_profile ON preparation_timings(profile, id);
				PRAGMA user_version=2; COMMIT;`);
		}

		if (Number(version) < 3) {
			this.db.exec(`BEGIN IMMEDIATE;
				CREATE TABLE saved_scenes (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, saved_at TEXT NOT NULL, data TEXT NOT NULL);
				CREATE INDEX scenes_by_date ON saved_scenes(saved_at DESC, id);
				PRAGMA user_version=3; COMMIT;`);
		}

		if (Number(version) < 4) {
			this.transaction(() => {
				this.db.exec(`
					CREATE TABLE IF NOT EXISTS scene_assets (
						scene_id TEXT NOT NULL REFERENCES saved_scenes(id) ON DELETE CASCADE,
						asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
						PRIMARY KEY (scene_id, asset_id));
					CREATE INDEX IF NOT EXISTS scenes_by_asset ON scene_assets(asset_id);
					CREATE TABLE IF NOT EXISTS orphan_candidates (asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE);
					CREATE TABLE IF NOT EXISTS deleted_scene_prompts (key TEXT PRIMARY KEY);
					CREATE TABLE IF NOT EXISTS asset_deletions (file TEXT PRIMARY KEY);
					PRAGMA user_version=4;`);
				// Generation provenance establishes ownership by the original prompt.
				const assets = this.assets();
				for (const saved of this.sceneRecipes()) {
					const key = sceneKey(saved.scene);
					this.linkSceneAssets(saved.id, assets.filter(asset => asset.generation?.sceneKey === key).map(asset => asset.id));
				}
			});
		}

		if (Number(version) < 5) {
			this.transaction(() => {
				this.db.exec(`CREATE TABLE IF NOT EXISTS asset_reuse_exclusions (
					scene_key TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
					PRIMARY KEY (scene_key, asset_id)); PRAGMA user_version=5;`);
				// Preserve existing references: v4 did not distinguish inferred links
				// from genuine reuse by sessions whose history has since been removed.
				// Backfill retained usage without inferring new acoustic matches.
				for (const value of this.loadSessions()) {
					const parsed = historicalReferencesSchema.safeParse(value);
					if (parsed.success) {
						const session = parsed.data;
						const id = this.findScene(session);
						if (id) {
							this.linkSceneAssets(id, [
								...session.assetIds,
								...session.timeline.beds.map(bed => bed.assetId),
								...session.scheduledEvents.map(event => event.assetId),
								...session.layered?.layers.flatMap(layer => layer.assetIds) ?? [],
							]);
						}
					}
				}

				// Honor deletions queued by v4 even if an unrelated session kept the
				// files on disk or the same prompt has since been saved again.
				this.db.exec(`INSERT OR IGNORE INTO asset_reuse_exclusions
					SELECT key, id FROM deleted_scene_prompts JOIN assets ON json_extract(metadata, '$.generation.sceneKey')=key`);
			});
		}
	}

	scene(id: string) {
		const row = this.db.prepare('SELECT data FROM saved_scenes WHERE id=?').get(id);
		return row ? savedSceneSchema.parse(JSON.parse(String(row.data))) : undefined;
	}

	sceneRecipes(): SavedScene[] {
		return this.db.prepare('SELECT data FROM saved_scenes ORDER BY id').all()
			.map(row => savedSceneSchema.parse(JSON.parse(String(row.data))));
	}

	findScene(value: Pick<SavedScene, 'scene' | 'generationMode'>) {
		const row = this.db.prepare('SELECT id FROM saved_scenes WHERE fingerprint=?').get(recipeFingerprint(value));
		return row ? String(row.id) : undefined;
	}

	linkSceneAssets(id: string, assetIds: string[]) {
		const link = this.db.prepare(`INSERT OR IGNORE INTO scene_assets SELECT ?, id FROM assets
			WHERE id=? AND EXISTS (SELECT 1 FROM saved_scenes WHERE id=?)`);
		for (const assetId of new Set(assetIds)) {
			link.run(id, assetId, id);
		}
	}

	deleteScene(id: string) {
		this.transaction(() => {
			const saved = this.scene(id);
			if (!saved) {
				return;
			}

			const key = sceneKey(saved.scene);
			const recipes = this.sceneRecipes().filter(recipe => sceneKey(recipe.scene) === key);
			for (const recipe of recipes) {
				this.db.prepare(`INSERT OR IGNORE INTO asset_reuse_exclusions
					SELECT ?, asset_id FROM scene_assets WHERE scene_id=?`).run(key, recipe.id);
			}

			this.db.prepare(`INSERT OR IGNORE INTO asset_reuse_exclusions
				SELECT ?, id FROM assets WHERE json_extract(metadata, '$.generation.sceneKey')=?`).run(key, key);
			this.db.prepare(`INSERT OR IGNORE INTO orphan_candidates SELECT id FROM assets
				JOIN asset_reuse_exclusions ON asset_id=id WHERE scene_key=? AND json_extract(metadata, '$.generation') IS NOT NULL`).run(key);
			for (const recipe of recipes) {
				this.db.prepare('DELETE FROM saved_scenes WHERE id=?').run(recipe.id);
			}

			for (const row of this.db.prepare('SELECT id, json_extract(state, \'$.scene.originalPrompt\') AS prompt FROM sessions').all()) {
				if (typeof row.prompt === 'string' && sceneKey({...saved.scene, originalPrompt: row.prompt}) === key) {
					this.deleteSession(String(row.id));
				}
			}
		});
	}

	isReusableAsset(id: string, key: string) {
		return Boolean(this.db.prepare(`SELECT 1 FROM assets WHERE id=?
			AND NOT EXISTS (SELECT 1 FROM asset_reuse_exclusions WHERE asset_id=assets.id AND scene_key=?)
			AND (NOT EXISTS (SELECT 1 FROM orphan_candidates WHERE asset_id=assets.id)
				OR EXISTS (SELECT 1 FROM scene_assets WHERE asset_id=assets.id))`).get(id, key));
	}

	hasPendingCleanup() {
		return Boolean(this.db.prepare(`SELECT 1 FROM asset_deletions UNION ALL SELECT 1 FROM deleted_scene_prompts
			UNION ALL SELECT 1 FROM orphan_candidates WHERE NOT EXISTS (SELECT 1 FROM scene_assets WHERE scene_assets.asset_id=orphan_candidates.asset_id) LIMIT 1`).get());
	}

	retireOrphanedAssets(held = new Set<string>()) {
		this.transaction(() => {
			// Finish legacy v4 cleanup requests. New deletions snapshot candidates
			// after their own sessions and generation have settled.
			this.db.exec(`INSERT OR IGNORE INTO orphan_candidates SELECT id FROM assets
				WHERE json_extract(metadata, '$.generation.sceneKey') IN (SELECT key FROM deleted_scene_prompts)`);
			const assets = this.db.prepare(`SELECT metadata FROM assets JOIN orphan_candidates ON assets.id=asset_id
				WHERE NOT EXISTS (SELECT 1 FROM scene_assets WHERE scene_assets.asset_id=assets.id)`)
				.all().map(row => assetSchema.parse(JSON.parse(String(row.metadata))));
			for (const asset of assets) {
				if (held.has(asset.id)) {
					continue;
				}

				this.db.prepare('DELETE FROM assets WHERE id=?').run(asset.id);
				if (!this.db.prepare('SELECT 1 FROM assets WHERE json_extract(metadata, \'$.file\')=?').get(asset.file)) {
					this.db.prepare('INSERT OR IGNORE INTO asset_deletions VALUES (?)').run(asset.file);
				}
			}

			this.db.exec('DELETE FROM deleted_scene_prompts');
		});
	}

	pendingAssetDeletions() {
		return this.db.prepare('SELECT file FROM asset_deletions ORDER BY file').all().map(row => assetSchema.shape.file.parse(row.file));
	}

	finishAssetDeletion(file: string) {
		this.db.prepare('DELETE FROM asset_deletions WHERE file=?').run(file);
	}

	referencesFile(file: string) {
		return Boolean(this.db.prepare('SELECT 1 FROM assets WHERE json_extract(metadata, \'$.file\')=?').get(file));
	}

	rememberScene(value: Omit<SavedScene, 'id'>) {
		const saved = savedSceneSchema.parse({...value, id: randomUUID()});
		const fingerprint = recipeFingerprint(saved);
		this.db.prepare('INSERT INTO saved_scenes VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO NOTHING')
			.run(saved.id, fingerprint, saved.savedAt, JSON.stringify(saved));
		return this.findScene(saved)!;
	}

	scenes(query = '', offset = 0) {
		const where = `instr(lower(json_extract(data, '$.scene.title') || ' ' || json_extract(data, '$.scene.originalPrompt')
			|| ' ' || json_extract(data, '$.scene.location')), lower(?)) > 0`;
		return {
			scenes: this.db.prepare(`SELECT data FROM saved_scenes WHERE ${where} ORDER BY saved_at DESC, id LIMIT ? OFFSET ?`)
				.all(query, sceneLibraryPageSize, offset).map(row => savedSceneSchema.parse(JSON.parse(String(row.data)))),
			total: Number(this.db.prepare(`SELECT count(*) AS total FROM saved_scenes WHERE ${where}`).get(query)!.total),
			offset, limit: sceneLibraryPageSize,
		};
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
