import {createHash, randomInt, randomUUID} from 'node:crypto';
import {
	lstat, mkdir, readdir, realpath, rename, rm,
} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {type Scene} from '@soundscapes/shared';
import {type AppConfig} from '../config.js';
import {measure, playableAssets} from '../assets/fixtures.js';
import {runAudioCommand} from '../audio/process.js';
import {assetSchema, type Asset, type Store} from '../persistence/store.js';
import {type EventProposal} from '../planning/contracts.js';
import {type GeneratedAudio, type SoundGenerator, type SoundRequest} from './contracts.js';
import {GenerationQueue} from './queue.js';
import {PythonSoundGenerator} from './python.js';

export function sceneKey(scene: Scene) {
	return hash(scene.originalPrompt.trim().replaceAll(/\s+/g, ' ').toLowerCase());
}

function hash(text: string) {
	return createHash('sha256').update(text).digest('hex');
}

export function soundPrompt(scene: Scene, detail: string) {
	// The encoder has a short context window: lead with acoustics, keep the setting concise.
	return [detail,
		`${scene.location}; ${scene.year ?? ''} ${scene.season} ${scene.timeOfDay}.`,
		`Weather: ${Object.values(scene.weather).filter(Boolean).join(', ')}.`,
		scene.description.slice(0, 350),
		'Quiet, distant, gentle sleep ambience. No voices, speech, music, abrupt changes or impacts.',
		...scene.constraints].join(' ').slice(0, 6000);
}

type Owner = {sessionId: string; signal: AbortSignal; valid: () => boolean; deadlineAt?: number};
export class GenerationService {
	readonly queue: GenerationQueue;
	readonly generator: SoundGenerator;
	private readonly config: AppConfig;
	constructor(config: AppConfig, private readonly store: Store, generator?: SoundGenerator) {
		this.config = {...config, sound: {...config.sound, output: path.join(config.dataDirectory, 'quarantine/sound')}};
		this.generator = generator ?? new PythonSoundGenerator(this.config.sound);
		this.queue = new GenerationQueue(this.generator);
	}

	async initialize() {
		await mkdir(this.config.sound.output, {recursive: true});
		const leftovers = await readdir(this.config.sound.output);
		await Promise.all(leftovers.filter(file => /^[a-f\d-]{36}\.wav(?:\.(?:normalized|adjusted)\.wav)?$/.test(file))
			.map(async file => rm(path.join(this.config.sound.output, file), {force: true})));
	}

	async beds(scene: Scene, owner: Owner, progress: (assets: Asset[]) => void) {
		const assets: Asset[] = [];
		for (let variant = 0; variant < 4; variant++) {
			// A scene needs four independently seeded beds; sequential work preserves memory headroom.
			// eslint-disable-next-line no-await-in-loop
			assets.push(await this.obtain(scene, {
				kind: 'ambience', durationSeconds: 90, variant, title: `${scene.title} · bed ${variant + 1}`,
				prompt: soundPrompt(scene, 'Continuous, stable environmental background texture. No isolated foreground events. Subtle natural variation throughout.'),
			}, owner));
			progress([...assets]);
		}

		return assets;
	}

	async event(scene: Scene, proposal: EventProposal, owner: Owner) {
		if (!proposal.event || !proposal.category || !proposal.durationSeconds) {
			throw new Error('Cannot generate an incomplete event proposal');
		}

		return this.obtain(scene, {
			kind: 'event', durationSeconds: Math.ceil(proposal.durationSeconds), title: proposal.event.slice(0, 120), category: proposal.category,
			prompt: soundPrompt(scene, `One subtle event: ${proposal.event}. Distant and understated, with a soft beginning and ending.`),
		}, owner);
	}

	async close() {
		await this.queue.close();
	}

	private async obtain(scene: Scene, description: {
		kind: SoundRequest['kind']; durationSeconds: number; title: string; prompt: string; variant?: number | undefined; category?: NonNullable<EventProposal['category']> | undefined;
	}, owner: Owner) {
		const key = sceneKey(scene);
		const assetKey = hash(JSON.stringify({
			profile: 'stable-audio-3-small-sfx/levels-v1', sceneKey: key, kind: description.kind, duration: description.durationSeconds, variant: description.variant,
			event: description.kind === 'event' ? description.title.toLowerCase() : undefined, category: description.category,
		}));
		owner.signal.throwIfAborted();
		if (!owner.valid()) {
			throw new Error('Sound request owner is idle');
		}

		const available = await playableAssets(this.config, this.store, description.kind);
		const existing = available.find(asset => asset.generation?.assetKey === assetKey);
		if (existing) {
			return existing;
		}

		const request: SoundRequest = {
			id: randomUUID(), sessionId: owner.sessionId, kind: description.kind, prompt: description.prompt,
			durationSeconds: description.durationSeconds, seed: randomInt(2_147_483_647),
		};
		const quarantine = path.join(this.config.sound.output, `${request.id}.wav`);
		try {
			const audio = await this.queue.submit(request, {
				...owner, deadlineAt: owner.deadlineAt ?? Date.now() + this.config.sound.timeoutMs,
			});
			const asset = await this.validate(audio, request, owner.signal, {
				title: description.title, sceneKey: key, assetKey, variant: description.variant, category: description.category,
			});
			owner.signal.throwIfAborted();
			if (!owner.valid() || (owner.deadlineAt !== undefined && Date.now() >= owner.deadlineAt)) {
				throw new Error('Sound finished after its owner or opportunity expired');
			}

			return asset;
		} finally {
			await rm(quarantine, {force: true});
		}
	}

	private async validate(audio: GeneratedAudio, request: SoundRequest, signal: AbortSignal, metadata: {
		title: string; sceneKey: string; assetKey: string; variant?: number | undefined; category?: NonNullable<EventProposal['category']> | undefined;
	}) {
		const expected = await checkOutputPath(this.config.sound.output, request.id, audio.path);

		const run = async (binary: string, args: string[]) => runAudioCommand(binary, args, 30_000, signal);
		const probe = await run(this.config.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', expected]);
		const stream = z.object({
			streams: z.array(z.object({
				codec_name: z.enum(['pcm_f32le', 'pcm_s16le']), sample_rate: z.literal('44100'), channels: z.literal(2), duration: z.coerce.number().min(2).max(120),
			})).length(1),
		}).parse(JSON.parse(probe.stdout)).streams[0]!;
		if (Math.abs(stream.duration - request.durationSeconds) > 0.05) {
			throw new Error('Generated output duration differs from its request');
		}

		const analysis = await run(this.config.ffmpegPath, ['-hide_banner', '-nostdin', '-xerror', '-i', expected, '-af', 'astats=reset=0,volumedetect', '-f', 'null', '-']);
		const meanDb = Number(/mean_volume: (-?[\d.]+) dB/.exec(analysis.stderr)?.[1]);
		const invalid = [...analysis.stderr.matchAll(/Number of (?:NaNs|Infs): ([\d.]+)/g)].some(match => Number(match[1]) > 0);
		if (!Number.isFinite(meanDb) || meanDb < -65 || invalid) {
			throw new Error('Generated output is silent, invalid or non-finite');
		}

		const file = `assets/${request.kind === 'ambience' ? 'ambience' : 'events'}/${request.id}.wav`;
		const target = path.join(this.config.dataDirectory, file);
		const temporary = `${expected}.normalized.wav`;
		const adjusted = `${expected}.adjusted.wav`;
		const mean = request.kind === 'ambience' ? -36 : -40;
		// FFmpeg's limiter floor is 0.0625. Limit at 0.125, then attenuate events by 7 dB.
		const attenuation = request.kind === 'event' ? 7 : 0;
		try {
			await run(this.config.ffmpegPath, [
				'-v',
				'error',
				'-nostdin',
				'-y',
				'-i',
				expected,
				'-af',
				`volume=${mean - meanDb + attenuation}dB,alimiter=limit=0.125:level=false:attack=5:release=50:latency=true,volume=${-attenuation}dB`,
				'-ar',
				'44100',
				'-ac',
				'2',
				'-c:a',
				'pcm_s16le',
				temporary,
			]);
			let levels = await measure(temporary, this.config);
			// Limiting a highly uneven source can lower its RMS. Permit one bounded
			// correction, then enforce the same limits; don't keep amplifying silence.
			const correction = mean - levels.meanDb;
			if (correction > 1 && correction <= 6) {
				await run(this.config.ffmpegPath, [
					'-v',
					'error',
					'-nostdin',
					'-y',
					'-i',
					temporary,
					'-af',
					`volume=${correction + attenuation}dB,alimiter=limit=0.125:level=false:attack=5:release=50:latency=true,volume=${-attenuation}dB`,
					'-c:a',
					'pcm_s16le',
					adjusted,
				]);
				levels = await measure(adjusted, this.config);
				await rename(adjusted, temporary);
			}

			signal.throwIfAborted();
			if (Math.abs(levels.meanDb - mean) > 2 || levels.peakDb - levels.meanDb > (request.kind === 'ambience' ? 20 : 16)) {
				throw new Error(`Generated output failed loudness or transient limits (mean ${levels.meanDb} dBFS, peak ${levels.peakDb} dBFS)`);
			}

			const asset = assetSchema.parse({
				id: request.id, kind: request.kind, title: metadata.title, file, ...levels,
				source: `Stable Audio 3 Small-SFX ${audio.revision}; automated level checks; listening acceptance pending`,
				generation: {
					...metadata, model: audio.model, revision: audio.revision, seed: request.seed, prompt: request.prompt,
					createdAt: new Date().toISOString(), validation: 'levels-v1', elapsedMs: audio.elapsedMs,
				},
				...(metadata.category ? {event: {category: metadata.category, tags: [metadata.category], reviewedSleepSafe: false}} : {}),
			});
			await mkdir(path.dirname(target), {recursive: true});
			await rename(temporary, target);
			try {
				this.store.putAsset(asset);
			} catch (error) {
				await rm(target, {force: true});
				throw error;
			}

			return asset;
		} finally {
			await Promise.all([temporary, adjusted].map(async file => rm(file, {force: true})));
		}
	}
}

async function checkOutputPath(root: string, id: string, output: string) {
	const expected = path.join(root, `${id}.wav`);
	if (output !== expected) {
		throw new Error('Generated output is outside its managed quarantine path');
	}

	const info = await lstat(expected);
	if (!info.isFile() || info.isSymbolicLink() || info.size < 44 || info.size > 48 * 1024 * 1024
		|| await realpath(expected) !== path.join(await realpath(root), `${id}.wav`)) {
		throw new Error('Generated output failed file bounds');
	}

	return expected;
}
