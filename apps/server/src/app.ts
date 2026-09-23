import fastifyStatic from '@fastify/static';
import {healthResponseJsonSchema, type HealthResponse} from '@soundscapes/shared';
import fastify, {type FastifyServerOptions} from 'fastify';

type AppOptions = {
	logger?: FastifyServerOptions['logger'];
	webRoot?: string;
};

export async function buildApp({logger = false, webRoot}: AppOptions = {}) {
	const app = fastify({logger});

	app.get('/api/health', {
		schema: {response: {200: healthResponseJsonSchema}},
	}, async (): Promise<HealthResponse> => ({
		status: 'ok',
		service: 'soundscapes',
		stage: 'scaffolding',
	}));

	if (webRoot) {
		await app.register(fastifyStatic, {root: webRoot});
	}

	return app;
}
