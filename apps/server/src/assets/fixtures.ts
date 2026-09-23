import {
	mkdir, rename, rm, stat,
} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {runAudioCommand} from '../audio/process.js';
import {type AppConfig} from '../config.js';
import {assetSchema, type Store, type Asset} from '../persistence/store.js';

const probeSchema = z.object({
	streams: z.array(z.object({
		codec_name: z.literal('pcm_s16le'), sample_rate: z.literal('44100'), channels: z.literal(2), duration: z.coerce.number().min(2).max(120),
	})).length(1),
});

export async function measure(file: string, config: AppConfig) {
	const metadata = await stat(file);
	if (!metadata.isFile() || metadata.size > 24 * 1024 * 1024) {
		throw new Error('Ambience WAV exceeds the managed file limit');
	}

	const probe = await runAudioCommand(config.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', file]);
	const audio = probeSchema.parse(JSON.parse(probe.stdout)).streams[0]!;
	const levels = await runAudioCommand(config.ffmpegPath, ['-hide_banner', '-nostdin', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
	const meanDb = Number(/mean_volume: (-?[\d.]+) dB/.exec(levels.stderr)?.[1]);
	const peakDb = Number(/max_volume: (-?[\d.]+) dB/.exec(levels.stderr)?.[1]);
	if (!Number.isFinite(meanDb) || !Number.isFinite(peakDb)) {
		throw new TypeError('Unable to measure ambience levels');
	}

	return {
		durationMs: Math.round(audio.duration * 1000), sampleRate: 44_100 as const, channels: 2 as const, peakDb, meanDb,
	};
}

export async function createAmbienceFixtures(config: AppConfig, store: Store) {
	const directory = path.join(config.dataDirectory, 'assets/ambience');
	await mkdir(directory, {recursive: true});
	await mkdir(path.join(config.dataDirectory, 'assets/events'), {recursive: true});
	const variants = [
		{title: 'Soft air', cutoff: 1300, seed: 1932},
		{title: 'Warm air', cutoff: 1100, seed: 4021},
		{title: 'Open air', cutoff: 1600, seed: 7013},
		{title: 'Light air', cutoff: 1900, seed: 9011},
	];
	for (const [index, variant] of variants.entries()) {
		// Process one bed at a time to bound offline normalization work.
		// eslint-disable-next-line no-await-in-loop
		await createOne(index, variant, config, store);
	}
}

async function createOne(index: number, variant: {title: string; cutoff: number; seed: number}, config: AppConfig, store: Store) {
	const id = `a1932000-0000-4000-8000-00000000000${index + 1}`;
	const file = `assets/ambience/${id}.wav`;
	const target = path.join(config.dataDirectory, file);
	const raw = `${target}.raw.wav`;
	const temporary = `${target}.tmp.wav`;
	try {
		const source = `anoisesrc=color=pink:amplitude=0.2:sample_rate=44100:duration=90:seed=${variant.seed}`;
		await runAudioCommand(config.ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-y',
			'-f',
			'lavfi',
			'-i',
			source,
			'-af',
			`lowpass=f=${variant.cutoff}`,
			'-ac',
			'2',
			'-c:a',
			'pcm_s16le',
			raw,
		]);
		const measured = await measure(raw, config);
		await runAudioCommand(config.ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-y',
			'-i',
			raw,
			'-af',
			`volume=${-36 - measured.meanDb}dB,alimiter=limit=0.125:level=false:attack=5:release=50:latency=true`,
			'-ar',
			'44100',
			'-ac',
			'2',
			'-c:a',
			'pcm_s16le',
			temporary,
		]);
		const normalized = await measure(temporary, config);
		if (Math.abs(normalized.meanDb + 36) > 1 || normalized.peakDb - normalized.meanDb > 20) {
			throw new Error('Ambience failed loudness or transient validation');
		}

		const previous = store.assets().find(asset => asset.id === id);
		const asset = assetSchema.parse({
			id, kind: 'ambience', title: variant.title, file, ...normalized,
			source: `Local FFmpeg pink-noise synthesis; seed ${variant.seed}; lowpass ${variant.cutoff} Hz; normalized to -36 dBFS RMS`,
			usageCount: previous?.usageCount ?? 0, lastUsedAt: previous?.lastUsedAt ?? null,
		});
		await rename(temporary, target);
		store.putAsset(asset);
	} finally {
		await Promise.all([raw, temporary].map(async file => rm(file, {force: true})));
	}
}

export async function playableAssets(config: AppConfig, store: Store, kind: Asset['kind'] = 'ambience'): Promise<Asset[]> {
	const available: Asset[] = [];
	for (const asset of store.assets().filter(asset => asset.kind === kind)) {
		try {
			// eslint-disable-next-line no-await-in-loop -- The library is small; don't flood the filesystem.
			const file = await stat(path.join(config.dataDirectory, asset.file));
			if (file.isFile() && file.size > 44 && file.size <= 24 * 1024 * 1024) {
				available.push(asset);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	return available;
}
