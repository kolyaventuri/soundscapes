import {
	createSessionSchema, listenerControlSchema, listenerSessionSchema, sessionIdSchema, sessionSchema,
} from '@soundscapes/shared';
import {type FastifyInstance} from 'fastify';
import {z} from 'zod';
import {segmentNamePattern} from '../audio/hls.js';
import {type SessionManager} from './manager.js';

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, {target: 'draft-7'});
const parametersSchema = jsonSchema(z.strictObject({id: sessionIdSchema}));
const controlSchema = jsonSchema(listenerControlSchema);
const listenerQuerySchema = jsonSchema(z.strictObject({listenerId: sessionIdSchema}));
const sessionResponse = jsonSchema(sessionSchema);
const listenerResponse = jsonSchema(listenerSessionSchema);
type SessionParameters = {id: string};
type ListenerBody = {listenerId: string};

export function registerSessionRoutes(app: FastifyInstance, manager: SessionManager) {
	app.get<{Querystring: {offset?: string; limit?: string}}>('/api/debug/assets', {
		schema: {querystring: jsonSchema(z.strictObject({offset: z.string().regex(/^\d{1,8}$/).optional(), limit: z.enum(['10', '25', '50', '100']).optional()}))},
	}, async request => manager.assetsDebug(Number(request.query.offset ?? 0), Number(request.query.limit ?? 25)));

	app.post<{Body: {mode: 'fixture' | 'ambience'; prompt?: string}}>('/api/sessions', {
		schema: {body: jsonSchema(createSessionSchema), response: {202: listenerResponse}},
	}, async (request, reply) => reply.code(202).send(manager.create(request.body.mode, request.body.prompt)));

	app.get<{Params: SessionParameters}>('/api/sessions/:id', {
		schema: {params: parametersSchema, response: {200: sessionResponse}},
	}, async request => manager.get(request.params.id));

	app.post<{Params: SessionParameters}>('/api/sessions/:id/listeners', {
		schema: {params: parametersSchema, response: {201: listenerResponse}},
	}, async (request, reply) => reply.code(201).send(manager.join(request.params.id)));

	for (const action of ['play', 'pause'] as const) {
		app.post<{Params: SessionParameters; Body: ListenerBody}>(`/api/sessions/:id/${action}`, {
			schema: {params: parametersSchema, body: controlSchema, response: {200: sessionResponse}},
		}, async request => manager[action](request.params.id, request.body.listenerId));
	}

	app.post<{Params: SessionParameters; Body: ListenerBody}>('/api/sessions/:id/prepare', {
		schema: {params: parametersSchema, body: controlSchema, response: {202: sessionResponse}},
	}, async (request, reply) => reply.code(202).send(manager.resumePreparation(request.params.id, request.body.listenerId)));

	app.post<{Params: SessionParameters}>('/api/sessions/:id/stop', {
		schema: {params: parametersSchema, response: {200: sessionResponse}},
	}, async request => manager.stop(request.params.id));

	app.get<{Params: SessionParameters}>('/api/debug/sessions/:id', {
		schema: {params: parametersSchema},
	}, async request => manager.debug(request.params.id));

	app.get<{Params: SessionParameters; Querystring: ListenerBody}>('/api/sessions/:id/stream.m3u8', {
		schema: {params: parametersSchema, querystring: listenerQuerySchema},
	}, async (request, reply) => {
		const playlist = await manager.playlist(request.params.id, request.query.listenerId, request.method === 'GET');
		return reply.type('application/vnd.apple.mpegurl').send(playlist);
	});

	app.get<{Params: SessionParameters & {runId: string; name: string}; Querystring: ListenerBody}>('/api/sessions/:id/hls/:runId/:name', {
		schema: {
			params: jsonSchema(z.strictObject({id: sessionIdSchema, runId: sessionIdSchema, name: z.string().regex(segmentNamePattern)})),
			querystring: listenerQuerySchema,
		},
	}, async (request, reply) => {
		const {id, runId, name} = request.params;
		const bytes = await manager.segment(id, request.query.listenerId, {runId, name, consumption: request.method === 'GET'});
		return reply.type('video/mp2t').send(bytes);
	});
}
