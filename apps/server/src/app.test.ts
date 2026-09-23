import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {healthResponseSchema} from '@soundscapes/shared';
import {expect, it} from 'vitest';
import {buildApp} from './app.js';
import {readConfig} from './config.js';

it('serves the shared health contract alongside the built client without hiding API errors', async () => {
	const webRoot = await mkdtemp(path.join(tmpdir(), 'soundscapes-web-'));
	const app = await buildApp({webRoot, config: {...readConfig({}), dataDirectory: webRoot}});

	try {
		await writeFile(path.join(webRoot, 'index.html'), '<h1>Soundscapes</h1>');
		const health = await app.inject('/api/health');
		expect(health.statusCode).toBe(200);
		expect(healthResponseSchema.safeParse(health.json()).success).toBe(true);
		const page = await app.inject('/');
		expect(page.statusCode).toBe(200);
		expect(page.headers['content-type']).toContain('text/html');
		expect(page.body).toContain('Soundscapes');
		const missing = await app.inject('/api/unknown');
		expect(missing.statusCode).toBe(404);
		expect(missing.headers['content-type']).toContain('application/json');
	} finally {
		await app.close();
		await rm(webRoot, {recursive: true, force: true});
	}
});

it.each(['0', '65536', '3000.5', 'not-a-port', ''])('rejects invalid configured port %j before binding', port => {
	expect(() => readConfig({PORT: port})).toThrow();
});

it('reads environment overrides without requiring a local env file', () => {
	expect(readConfig({HOST: '127.0.0.1', PORT: '3010', LOG_LEVEL: 'silent'})).toMatchObject({
		host: '127.0.0.1', port: 3010, logLevel: 'silent',
	});
});
