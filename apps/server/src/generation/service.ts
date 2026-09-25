import {createHash, randomInt, randomUUID} from 'node:crypto';
import {
	lstat, mkdir, readFile, readdir, realpath, rename, rm,
} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {type Scene, type LayerPlan, type LayerPolicy} from '@soundscapes/shared';
import {clipSeconds, poolSize, type LayeredState} from '../layers/timeline.js';
import {type AppConfig} from '../config.js';
import {measure, playableAssets} from '../assets/fixtures.js';
import {audioTags, sceneKey} from '../assets/reuse.js';
import {runAudioCommand} from '../audio/process.js';
import {assetSchema, type Asset, type Store} from '../persistence/store.js';
import {type EventProposal} from '../planning/contracts.js';
import {type Preparation} from '../sessions/preparation.js';
import {type GeneratedAudio, type SoundGenerator, type SoundRequest} from './contracts.js';
import {GenerationQueue} from './queue.js';
import {PythonSoundGenerator} from './python.js';

export {sceneKey} from '../assets/reuse.js';

function hash(text: string) {
	return createHash('sha256').update(text).digest('hex');
}

export function soundPrompt(scene: Scene, detail: string, kind: SoundRequest['kind'] = 'ambience') {
	// Lead with identifiable sources inside the encoder's short context window.
	const caption = scene.audioPrompt || scene.originalPrompt || scene.description || scene.title;
	return [...(kind === 'event' ? [detail, caption.slice(0, 650)] : [caption.slice(0, 650), detail]),
		'Natural stereo perspective, distinct sound sources and realistic acoustic depth.',
		...(scene.sleepMode ? ['Relaxed dynamics, gentle transitions, suitable for sleep.'] : []),
		...scene.constraints].join(' ').slice(0, 6000);
}

export function generationAssetKey(scene: Scene, profile: string, description: {
	kind: SoundRequest['kind']; durationSeconds: number; prompt: string; variant?: number | undefined;
}) {
	return hash(JSON.stringify({
		profile, sceneKey: sceneKey(scene), sleepMode: scene.sleepMode, ...description,
	}));
}

export function layerSoundPrompt(scene: Scene, plan: LayerPlan, policy: LayerPolicy) {
	return [policy.prompt,
		// Background placement is a mix policy. Condition music on a clear musical
		// recording, not a restaurant/field recording that can regenerate the crowd.
		policy.id === 'music' ? 'Clear stereo music recording.' : plan.acoustics,
		...(scene.sleepMode ? ['Gentle dynamics, smooth beginning and ending.'] : []),
		...scene.constraints].join(' ').slice(0, 6000);
}

type Owner = {sessionId: string; signal: AbortSignal; valid: () => boolean; deadlineAt?: number};
export class GenerationService {
	readonly queue: GenerationQueue;
	readonly generator: SoundGenerator;
	private readonly config: AppConfig;
	private profile: Promise<string> | undefined;
	constructor(config: AppConfig, private readonly store: Store, generator?: SoundGenerator, private readonly log: (event: string, sessionId: string, detail?: string) => void = () => undefined) {
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

	async beds(scene: Scene, owner: Owner, progress: (assets: Asset[]) => void, preparation?: Preparation) {
		const assets: Asset[] = [];
		const descriptions = Array.from({length: 4}, (value, variant) => ({
			kind: 'ambience' as const, durationSeconds: 90, variant, title: `${scene.title} · bed ${variant + 1}`,
			prompt: soundPrompt(scene, 'A continuous recording of this environment, with its characteristic ongoing activity and natural variation.'),
		}));
		const profile = await this.getProfile();
		const available = await playableAssets(this.config, this.store);
		const cached = descriptions.map(description => available.find(asset => asset.generation?.assetKey === generationAssetKey(scene, profile, description)));
		const timingProfile = `sound:${hash(profile)}:90`;
		let first = true;
		preparation?.plan(descriptions.flatMap((description, index) => {
			if (cached[index]) {
				return [];
			}

			const temperature = first ? this.workerTemperature() : 'warm';
			first = false;
			return [{id: `generate-${index}`, profile: `${timingProfile}:${temperature}`}, {id: `validate-${index}`, profile: `${timingProfile}:validate`}];
		}));
		for (const [variant, description] of descriptions.entries()) {
			// A scene needs four independently seeded beds; sequential work preserves memory headroom.
			// eslint-disable-next-line no-await-in-loop
			const asset = cached[variant] ?? await this.obtain(scene, description, owner, preparation ? {preparation, timingProfile, variant} : undefined);
			owner.signal.throwIfAborted();
			if (!owner.valid()) {
				throw new Error('Sound request owner is idle');
			}

			assets.push(asset);
			if (preparation) {
				preparation.completedBeds = assets.length;
				preparation.reusedBeds += Number(Boolean(cached[variant]));
			}

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
			prompt: soundPrompt(scene, `One subtle event: ${proposal.event}. Distant and understated, with a soft beginning and ending.`, 'event'),
		}, owner);
	}

	async prepareLayerTasks(state: LayeredState, preparation: Preparation) {
		preparation.totalBeds = state.layers.reduce((sum, layer) => sum + poolSize(layer.policy.id).initial, 0);
		const profile = await this.getProfile();
		preparation.plan(state.layers.flatMap((layer, index) => Array.from({length: poolSize(layer.policy.id).initial}, (value, variant) => {
			const id = (index * 10) + variant;
			const timing = `layer:${hash(profile)}:${clipSeconds(layer.policy.id)}`;
			return [{id: `generate-${id}`, profile: `${timing}:${index === 0 && variant === 0 ? this.workerTemperature() : 'warm'}`},
				{id: `validate-${id}`, profile: `${timing}:validate`}];
		})).flat());
	}

	async layerAsset(scene: Scene, {plan, policy, variant}: {plan: LayerPlan; policy: LayerPolicy; variant: number}, owner: Owner, preparation?: Preparation) {
		const profile = await this.getProfile();
		return this.obtain(scene, {
			kind: policy.id === 'effects' ? 'event' : 'ambience', durationSeconds: clipSeconds(policy.id), variant, layerId: policy.id,
			title: `${scene.title} · ${policy.title} ${variant + 1}`,
			prompt: layerSoundPrompt(scene, plan, policy),
		}, owner, preparation
			? {
				preparation, timingProfile: `layer:${hash(profile)}:${clipSeconds(policy.id)}`,
				variant: (plan.layers.findIndex(layer => layer.id === policy.id) * 10) + variant,
			}
			: undefined);
	}

	async close() {
		await this.queue.close();
	}

	private async obtain(scene: Scene, description: {
		kind: SoundRequest['kind']; durationSeconds: number; title: string; prompt: string; variant?: number | undefined; layerId?: LayerPolicy['id'];
		category?: NonNullable<EventProposal['category']> | undefined;
	}, owner: Owner, tracking?: {preparation: Preparation; timingProfile: string; variant: number}) {
		const key = sceneKey(scene);
		const assetKey = generationAssetKey(scene, await this.getProfile(), description);
		owner.signal.throwIfAborted();
		if (!owner.valid()) {
			throw new Error('Sound request owner is idle');
		}

		const available = await playableAssets(this.config, this.store, description.kind);
		const existing = available.find(asset => asset.generation?.assetKey === assetKey);
		if (existing) {
			if (tracking) {
				tracking.preparation.skip(`generate-${tracking.variant}`);
				tracking.preparation.skip(`validate-${tracking.variant}`);
				tracking.preparation.reusedBeds++;
			}

			this.log('sound-cache-reused', owner.sessionId, description.kind);
			return existing;
		}

		const request: SoundRequest = {
			id: randomUUID(), sessionId: owner.sessionId, kind: description.kind, prompt: description.prompt,
			durationSeconds: description.durationSeconds, seed: randomInt(2_147_483_647),
		};
		const quarantine = path.join(this.config.sound.output, `${request.id}.wav`);
		try {
			tracking?.preparation.update('queued');
			const audio = await this.queue.submit(request, {
				...owner, deadlineAt: owner.deadlineAt ?? Date.now() + this.config.sound.timeoutMs,
				onStart: () => {
					this.log('sound-generation-started', owner.sessionId, description.kind);
					tracking?.preparation.begin(`generate-${tracking.variant}`, `${tracking.timingProfile}:${this.workerTemperature()}`, 'loading');
				},
				onProgress: value => tracking?.preparation.update(value.stage, value.step),
			});
			if (tracking) {
				tracking.preparation.complete();
				tracking.preparation.begin(`validate-${tracking.variant}`, `${tracking.timingProfile}:validate`, 'validating');
			}

			const asset = await this.validate(audio, request, owner.signal, {
				title: description.title, sceneKey: key, assetKey, variant: description.variant, layerId: description.layerId, category: description.category, affinity: scene,
			});
			owner.signal.throwIfAborted();
			if (!owner.valid() || (owner.deadlineAt !== undefined && Date.now() >= owner.deadlineAt)) {
				throw new Error('Sound finished after its owner or opportunity expired');
			}

			tracking?.preparation.complete();
			this.log('sound-generated', owner.sessionId, description.kind);
			return asset;
		} catch (error) {
			if (!owner.signal.aborted) {
				this.log('sound-generation-failed', owner.sessionId, String(error).slice(0, 1000));
			}

			throw error;
		} finally {
			await rm(quarantine, {force: true});
		}
	}

	private workerTemperature() {
		const state = this.generator.diagnostics();
		return state.pid && (this.config.sound.device === 'mlx' || state.loaded) ? 'warm' : 'cold';
	}

	private async getProfile() {
		this.profile ??= (async () => {
			const manifest = this.generator instanceof PythonSoundGenerator
				? z.object({revision: z.string(), runtimeRevision: z.string().optional()}).parse(JSON.parse(await readFile(this.config.sound.manifest, 'utf8')))
				: {revision: 'injected-adapter'};
			return JSON.stringify({
				model: this.config.sound.model, device: this.config.sound.device, ...manifest, prompt: 'scene-v2', levels: 'levels-v2',
			});
		})();
		return this.profile;
	}

	private async validate(audio: GeneratedAudio, request: SoundRequest, signal: AbortSignal, metadata: {
		title: string; sceneKey: string; assetKey: string; variant?: number | undefined; layerId?: LayerPolicy['id'] | undefined;
		category?: NonNullable<EventProposal['category']> | undefined; affinity: Scene;
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
		if (!Number.isFinite(meanDb) || invalid) {
			throw new Error('Generated output is invalid or non-finite');
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
				`volume=${Math.min(30, mean - meanDb) + attenuation}dB,alimiter=limit=0.125:level=false:attack=5:release=50:latency=true,volume=${-attenuation}dB`,
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
			// correction, then keep the peak-limited result even if RMS misses its target.
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
			const warning = Math.abs(levels.meanDb - mean) > 2 || levels.peakDb - levels.meanDb > (request.kind === 'ambience' ? 20 : 16)
				? 'This recording was kept with peak protection, but may sound quieter or more dynamic than the target.'
				: undefined;

			const asset = assetSchema.parse({
				id: request.id, kind: request.kind, title: metadata.title, file, ...levels, affinity: metadata.affinity,
				source: `${audio.model} ${audio.revision}; automated level checks; listening acceptance pending`,
				generation: {
					...metadata, model: audio.model, revision: audio.revision, seed: request.seed, prompt: request.prompt,
					createdAt: new Date().toISOString(), validation: 'levels-v2', warning, elapsedMs: audio.elapsedMs,
				},
				...(metadata.category ? {event: {category: metadata.category, tags: [...new Set([metadata.category, ...audioTags(metadata.title)])].slice(0, 12), reviewedSleepSafe: false}} : {}),
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
