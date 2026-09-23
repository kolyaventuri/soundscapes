import process from 'node:process';
import {z} from 'zod';

const environmentSchema = z.object({
	HOST: z.string().trim().min(1).default('0.0.0.0'),
	PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
	const parsed = environmentSchema.parse(environment);
	return {host: parsed.HOST, port: parsed.PORT, logLevel: parsed.LOG_LEVEL};
}
