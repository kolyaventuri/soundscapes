import fastifyStatic from '@fastify/static';
import {healthResponseJsonSchema, type HealthResponse} from '@soundscapes/shared';
import fastify, {LogController, type FastifyServerOptions} from 'fastify';
import {readConfig, type AppConfig} from './config.js';
import {claimServer, openStore} from './persistence/open.js';
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
	const release = sessions ? undefined : await claimServer(config.dataDirectory);
	const store = sessions ? undefined : await openStore(config.dataDirectory);
	const manager = sessions ?? new SessionManager({
		...(store ? {store} : {}),
		config,
		onEvent(event, sessionId, detail) {
			app.log.info({sessionId, event, detail}, 'Session lifecycle');
		},
	});
	try {
		if (!sessions) {
			await manager.initialize();
		}
	} catch (error) {
		await manager.close();
		await release?.();
		throw error;
	}

	app.addHook('onClose', async () => {
		try {
			await manager.close();
		} finally {
			await release?.();
		}
	});
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
		stage: 'procedural-ambience',
	}));
	registerSessionRoutes(app, manager);

	if (webRoot) {
		await app.register(fastifyStatic, {root: webRoot});
	}

	return app;
}
