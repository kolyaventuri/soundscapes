import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {defaultDelayBuckets, delayBucketsSchema} from './planning/contracts.js';

const environmentSchema = z.object({
	HOST: z.string().trim().min(1).default('0.0.0.0'),
	PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
	TLS_CERT_FILE: z.string().min(1).optional(),
	TLS_KEY_FILE: z.string().min(1).optional(),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	DATA_DIR: z.string().min(1).default('data'),
	FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
	FFPROBE_PATH: z.string().min(1).default('ffprobe'),
	IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(300).default(90),
	OLLAMA_URL: z.url().default('http://127.0.0.1:11434'),
	OLLAMA_MODEL: z.string().regex(/^[\w.:/-]+$/).max(120).default('qwen3:8b'),
	PLANNER_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(45),
	EVENT_SKIP_PROBABILITY: z.coerce.number().min(0).max(1).default(0.25),
	EVENT_DELAY_SCALE: z.coerce.number().min(0.05).max(10).default(1),
	EVENT_DELAY_BUCKETS: z.string().optional(),
	ASSET_REUSE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
	SOUND_ENABLED: z.enum(['true', 'false']).default('true'),
	SOUND_PYTHON: z.string().min(1).default('models/sound-runtime/bin/python'),
	SOUND_MODEL: z.enum(['small-sfx', 'small-music', 'medium']).default('small-sfx'),
	SOUND_MODEL_MANIFEST: z.string().min(1).optional(),
	SOUND_DEVICE: z.enum(['cpu', 'mps', 'mlx']).default('cpu'),
	SOUND_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(1800).default(300),
	SOUND_IDLE_UNLOAD_SECONDS: z.coerce.number().int().min(0).max(1800).default(1800),
});

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function loadEnvironment() {
	const file = path.join(repositoryRoot, '.env');
	if (existsSync(file)) {
		process.loadEnvFile(file);
	}
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
	const parsed = environmentSchema.parse(environment);
	if (Boolean(parsed.TLS_CERT_FILE) !== Boolean(parsed.TLS_KEY_FILE)) {
		throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
	}

	const ollamaUrl = new URL(parsed.OLLAMA_URL);
	const local = ollamaUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(ollamaUrl.hostname);
	if (!local || ollamaUrl.username || ollamaUrl.password || ollamaUrl.pathname !== '/' || ollamaUrl.search || ollamaUrl.hash) {
		throw new Error('OLLAMA_URL must be a local loopback HTTP origin');
	}

	const dataDirectory = path.resolve(repositoryRoot, parsed.DATA_DIR);
	return {
		host: parsed.HOST, port: parsed.PORT, logLevel: parsed.LOG_LEVEL,
		tls: parsed.TLS_CERT_FILE && parsed.TLS_KEY_FILE
			? {
				certificate: path.resolve(repositoryRoot, parsed.TLS_CERT_FILE), key: path.resolve(repositoryRoot, parsed.TLS_KEY_FILE),
			}
			: undefined,
		dataDirectory,
		fixturePath: path.join(dataDirectory, 'assets/fixtures/pink-noise.wav'),
		ffmpegPath: parsed.FFMPEG_PATH,
		ffprobePath: parsed.FFPROBE_PATH,
		idleTimeoutMs: parsed.IDLE_TIMEOUT_SECONDS * 1000,
		sound: {
			enabled: parsed.SOUND_ENABLED === 'true', python: path.resolve(repositoryRoot, parsed.SOUND_PYTHON),
			model: `stable-audio-3-${parsed.SOUND_MODEL}`,
			manifest: path.resolve(repositoryRoot, parsed.SOUND_MODEL_MANIFEST ?? `models/stable-audio-3-${parsed.SOUND_MODEL}${parsed.SOUND_DEVICE === 'mlx' ? '-mlx' : ''}/manifest.json`),
			device: parsed.SOUND_DEVICE,
			worker: path.join(repositoryRoot, 'workers/sound/worker.py'), output: path.join(dataDirectory, 'quarantine/sound'),
			timeoutMs: parsed.SOUND_TIMEOUT_SECONDS * 1000, idleUnloadMs: parsed.SOUND_IDLE_UNLOAD_SECONDS * 1000,
		},
		planner: {
			reuseThreshold: parsed.ASSET_REUSE_THRESHOLD,
			url: ollamaUrl.origin, model: parsed.OLLAMA_MODEL, timeoutMs: parsed.PLANNER_TIMEOUT_SECONDS * 1000, skipProbability: parsed.EVENT_SKIP_PROBABILITY, delayScale: parsed.EVENT_DELAY_SCALE,
			delayBuckets: delayBucketsSchema.parse(parsed.EVENT_DELAY_BUCKETS ? JSON.parse(parsed.EVENT_DELAY_BUCKETS) : defaultDelayBuckets),
		},
	};
}

export type AppConfig = ReturnType<typeof readConfig>;
