import {
	recordingListSchema, recordingSchema, startRecordingSchema, type StartRecording,
} from '@soundscapes/shared';
import {type FastifyInstance} from 'fastify';
import {z} from 'zod';
import {recordingText, type Recordings} from './recordings.js';

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, {target: 'draft-7'});
const parameters = jsonSchema(z.strictObject({id: z.uuid()}));
const response = {200: jsonSchema(recordingSchema)};

export function registerRecordingRoutes(app: FastifyInstance, recordings: Recordings) {
	app.get('/api/recordings', {schema: {response: {200: jsonSchema(recordingListSchema)}}}, async () => recordings.list());
	app.post<{Body: StartRecording}>('/api/recordings', {
		schema: {body: jsonSchema(startRecordingSchema), response},
	}, async request => recordings.start(request.body));
	app.get<{Params: {id: string}}>('/api/recordings/:id', {schema: {params: parameters, response}}, async request => recordings.get(request.params.id));
	app.post<{Params: {id: string}}>('/api/recordings/:id/stop', {schema: {params: parameters, response}}, async request => recordings.stop(request.params.id));
	app.get<{Params: {id: string}}>('/api/recordings/:id/summary', {schema: {params: parameters}}, async (request, reply) => {
		const view = recordings.get(request.params.id);
		return reply.header('Content-Disposition', `attachment; filename="soundscapes-${view.id}.txt"`).type('text/plain; charset=utf-8').send(recordingText(view));
	});
}
