import {readFile} from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import {healthResponseJsonSchema, type HealthResponse} from '@soundscapes/shared';
import fastify, {LogController, type FastifyServerOptions} from 'fastify';
import {readConfig, type AppConfig} from './config.js';
import {claimServer, openStore} from './persistence/open.js';
import {SessionManager} from './sessions/manager.js';
import {registerSessionRoutes} from './sessions/routes.js';
import {Diagnostics} from './monitoring/diagnostics.js';
import {Recordings} from './monitoring/recordings.js';
import {collectSample} from './monitoring/sample.js';
import {captureProvenance} from './monitoring/provenance.js';
import {registerRecordingRoutes} from './monitoring/routes.js';

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
		...(config.tls ? {https: {cert: await readFile(config.tls.certificate), key: await readFile(config.tls.key)}} : {}),
		logger, bodyLimit: 16_384, logController: new LogController({disableRequestLogging: true}), ajv: {customOptions: {removeAdditional: false, coerceTypes: false}},
	});
	const release = sessions ? undefined : await claimServer(config.dataDirectory);
	let store: Awaited<ReturnType<typeof openStore>> | undefined;
	try {
		store = sessions ? undefined : await openStore(config.dataDirectory);
	} catch (error) {
		await release?.();
		throw error;
	}

	const manager = sessions ?? new SessionManager({
		...(store ? {store} : {}),
		config,
		onEvent(event, sessionId, detail) {
			diagnostics.record(event, sessionId, detail);
			app.log.info({sessionId, event, detail}, 'Session lifecycle');
		},
	});
	const recordings = new Recordings({
		dataDirectory: config.dataDirectory, session: id => manager.get(id),
		collect: async sessionId => collectSample({
			origin: 'http://localhost', sessionId, dataDirectory: config.dataDirectory,
			local: {runtime: () => diagnostics.snapshot(config), session: () => manager.debug(sessionId)},
		}),
		provenance: async () => captureProvenance(config),
		onError(error) {
			diagnostics.record('recording-error', 'server', String(error));
			app.log.error({err: error}, 'Diagnostic recorder failed');
		},
	});
	try {
		if (!sessions) {
			await manager.initialize();
		}

		await recordings.initialize();
	} catch (error) {
		await manager.close();
		await release?.();
		throw error;
	}

	app.addHook('onClose', async () => {
		diagnostics.record('server-closing');
		try {
			await recordings.close();
		} finally {
			try {
				await manager.close();
			} finally {
				await release?.();
			}
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
	registerRecordingRoutes(app, recordings);
	app.get('/api/debug/monitoring', async () => diagnostics.snapshot(config));

	if (webRoot) {
		await app.register(fastifyStatic, {root: webRoot});
	}

	return app;
}
