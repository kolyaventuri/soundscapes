import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const environmentSchema = z.object({
	HOST: z.string().trim().min(1).default('0.0.0.0'),
	PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	DATA_DIR: z.string().min(1).default('data'),
	FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
	FFPROBE_PATH: z.string().min(1).default('ffprobe'),
	IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(300).default(90),
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
	const dataDirectory = path.resolve(repositoryRoot, parsed.DATA_DIR);
	return {
		host: parsed.HOST, port: parsed.PORT, logLevel: parsed.LOG_LEVEL,
		dataDirectory,
		fixturePath: path.join(dataDirectory, 'assets/fixtures/pink-noise.wav'),
		ffmpegPath: parsed.FFMPEG_PATH,
		ffprobePath: parsed.FFPROBE_PATH,
		idleTimeoutMs: parsed.IDLE_TIMEOUT_SECONDS * 1000,
	};
}

export type AppConfig = ReturnType<typeof readConfig>;
