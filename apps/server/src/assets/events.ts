import {randomUUID} from 'node:crypto';
import {
	mkdir, rename, rm, stat,
} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {eventCategorySchema} from '@soundscapes/shared';
import {type AppConfig} from '../config.js';
import {runAudioCommand} from '../audio/process.js';
import {assetSchema, type Store} from '../persistence/store.js';
import {unsafeDescription} from '../planning/contracts.js';
import {measure} from './fixtures.js';

export const eventImportSchema = z.strictObject({
	title: z.string().trim().min(1).max(120), category: eventCategorySchema, tags: z.array(z.string().trim().min(1).max(80)).max(12),
	source: z.string().trim().min(1).max(500), reviewedSleepSafe: z.literal(true),
});

export async function importEvent(file: string, metadata: z.infer<typeof eventImportSchema>, config: AppConfig, store: Store) {
	const verified = eventImportSchema.parse(metadata);
	if (unsafeDescription(`${verified.title} ${verified.tags.join(' ')}`)) {
		throw new Error('Event metadata violates the sleep-mode exclusions');
	}

	const info = await stat(file);
	if (!info.isFile() || info.size > 24 * 1024 * 1024 || path.extname(file).toLowerCase() !== '.wav') {
		throw new Error('Import requires a local WAV file under 24 MiB');
	}

	const probe = await runAudioCommand(config.ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
	z.object({format: z.object({duration: z.coerce.number().min(2).max(30)}), streams: z.array(z.object({codec_type: z.literal('audio')})).length(1)}).parse(JSON.parse(probe.stdout));
	const id = randomUUID();
	const relative = `assets/events/${id}.wav`;
	const target = path.join(config.dataDirectory, relative);
	const raw = `${target}.raw.wav`;
	const temporary = `${target}.tmp.wav`;
	await mkdir(path.dirname(target), {recursive: true});
	try {
		await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:a:0', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', raw]);
		const measured = await measure(raw, config);
		await runAudioCommand(config.ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-y',
			'-i',
			raw,
			'-af',
			`volume=${-40 - measured.meanDb}dB,alimiter=limit=0.063:level=false:attack=5:release=50:latency=true`,
			'-c:a',
			'pcm_s16le',
			temporary,
		]);
		const normalized = await measure(temporary, config);
		if (Math.abs(normalized.meanDb + 40) > 2 || normalized.peakDb - normalized.meanDb > 16 || normalized.durationMs > 30_000) {
			throw new Error('Event failed level/transient limits; supply a gentler recording');
		}

		const asset = assetSchema.parse({
			id, kind: 'event', title: verified.title, file: relative, ...normalized, source: verified.source,
			event: {category: verified.category, tags: verified.tags, reviewedSleepSafe: true},
		});
		await rename(temporary, target);
		try {
			store.putAsset(asset);
		} catch (error) {
			await rm(target, {force: true});
			throw error;
		}

		return asset;
	} finally {
		await Promise.all([raw, temporary].map(async file => rm(file, {force: true})));
	}
}
