import fastifyStatic from '@fastify/static';
import {healthResponseJsonSchema, type HealthResponse} from '@soundscapes/shared';
import fastify, {LogController, type FastifyServerOptions} from 'fastify';
import {readConfig, type AppConfig} from './config.js';
import {claimServer, openStore} from './persistence/open.js';
import {SessionManager} from './sessions/manager.js';
import {registerSessionRoutes} from './sessions/routes.js';
import {Diagnostics} from './monitoring/diagnostics.js';

type AppOptions = {
	logger?: FastifyServerOptions['logger'];
	webRoot?: string;
	config?: AppConfig;
	sessions?: SessionManager;
};

export async function buildApp({logger = false, webRoot, config = readConfig(), sessions}: AppOptions = {}) {
	const diagnostics = new Diagnostics();
	diagnostics.record('server-started');
	const app = fastify({
		logger, bodyLimit: 16_384, logController: new LogController({disableRequestLogging: true}), ajv: {customOptions: {removeAdditional: false, coerceTypes: false}},
	});
	const release = sessions ? undefined : await claimServer(config.dataDirectory);
	const store = sessions ? undefined : await openStore(config.dataDirectory);
	const manager = sessions ?? new SessionManager({
		...(store ? {store} : {}),
		config,
		onEvent(event, sessionId, detail) {
			diagnostics.record(event, sessionId, detail);
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
		diagnostics.record('server-closing');
		try {
			await manager.close();
		} finally {
			await release?.();
		}
	});
	app.addHook('onError', async (request, reply, error) => {
		if ((error.statusCode ?? 500) >= 500) {
			diagnostics.record('request-error', 'server', error.message);
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
		stage: 'local-event-planning',
	}));
	registerSessionRoutes(app, manager);
	app.get('/api/debug/monitoring', async () => diagnostics.snapshot(config));

	if (webRoot) {
		await app.register(fastifyStatic, {root: webRoot});
	}

	return app;
}
