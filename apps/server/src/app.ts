import fastifyStatic from '@fastify/static';
import {healthResponseJsonSchema, type HealthResponse} from '@soundscapes/shared';
import fastify, {LogController, type FastifyServerOptions} from 'fastify';
import {readConfig, type AppConfig} from './config.js';
import {SessionManager} from './sessions/manager.js';
import {registerSessionRoutes} from './sessions/routes.js';

type AppOptions = {
	logger?: FastifyServerOptions['logger'];
	webRoot?: string;
	config?: AppConfig;
	sessions?: SessionManager;
};

export async function buildApp({logger = false, webRoot, config = readConfig(), sessions}: AppOptions = {}) {
	const app = fastify({
		logger, bodyLimit: 16_384, logController: new LogController({disableRequestLogging: true}), ajv: {customOptions: {removeAdditional: false, coerceTypes: false}},
	});
	const manager = sessions ?? new SessionManager({
		config,
		onEvent(event, sessionId, detail) {
			app.log.info({sessionId, event, detail}, 'Session lifecycle');
		},
	});
	app.addHook('onClose', async () => manager.close());
	app.addHook('onSend', async (request, reply, payload) => {
		if (request.url.startsWith('/api/')) {
			void reply.header('Cache-Control', 'no-store');
			void reply.header('X-Content-Type-Options', 'nosniff');
		}

		return payload;
	});

	app.get('/api/health', {
		schema: {response: {200: healthResponseJsonSchema}},
	}, async (): Promise<HealthResponse> => ({
		status: 'ok',
		service: 'soundscapes',
		stage: 'static-streaming',
	}));
	registerSessionRoutes(app, manager);

	if (webRoot) {
		await app.register(fastifyStatic, {root: webRoot});
	}

	return app;
}
