import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {
	mkdtemp, readFile, readdir, rm,
} from 'node:fs/promises';
import {get} from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';
import {listenerSessionSchema, recordingSchema} from '@soundscapes/shared';
import {buildApp} from '../app.js';
import {createFixture} from '../audio/fixture.js';
import {readConfig, repositoryRoot} from '../config.js';

const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-https-'));
const certificate = path.join(directory, 'certificate.pem');
const key = path.join(directory, 'key.pem');
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
	await promisify(execFile)('openssl', ['req',
		'-x509',
		'-newkey',
		'ec',
		'-pkeyopt',
		'ec_paramgen_curve:prime256v1',
		'-noenc',
		'-days',
		'1',
		'-subj',
		'/CN=localhost',
		'-addext',
		'subjectAltName=DNS:localhost,IP:127.0.0.1',
		'-keyout',
		key,
		'-out',
		certificate], {timeout: 10_000, maxBuffer: 8192});
	const config = readConfig({
		DATA_DIR: directory, TLS_CERT_FILE: certificate, TLS_KEY_FILE: key, SOUND_ENABLED: 'false', IDLE_TIMEOUT_SECONDS: '10',
	});
	await createFixture(config.fixturePath, config.ffmpegPath);
	app = await buildApp({config});
	const address = await app.listen({host: '127.0.0.1', port: 0});
	const ca = await readFile(certificate);
	const result = await new Promise<{status: number | undefined; body: string}>((resolve, reject) => {
		const request = get(`${address}/api/health`, {ca, rejectUnauthorized: true}, response => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk: string) => {
				body += chunk;
			});
			response.on('end', () => {
				resolve({status: response.statusCode, body});
			});
			response.on('error', reject);
		});
		request.setTimeout(5000, () => {
			request.destroy(new Error('HTTPS check timed out'));
		});
		request.on('error', reject);
	});
	assert.equal(result.status, 200);
	assert.equal((JSON.parse(result.body) as {status: string}).status, 'ok');
	async function rejectedTls(options: {ca?: typeof ca; servername?: string}) {
		return new Promise((resolve, reject) => {
			const request = get(`${address}/api/health`, {...options, rejectUnauthorized: true}, response => {
				response.resume();
				resolve(response.statusCode);
			});
			request.setTimeout(5000, () => request.destroy(new Error('TLS rejection check timed out')));
			request.on('error', reject);
		});
	}

	// eslint-disable-next-line unicorn/prefer-top-level-await -- Pass the rejection to assert, rather than throwing it outside the assertion.
	await assert.rejects(rejectedTls({}), /self.signed/i);
	// eslint-disable-next-line unicorn/prefer-top-level-await -- The second check deliberately fails hostname verification.
	await assert.rejects(rejectedTls({ca, servername: 'wrong.invalid'}), {code: 'ERR_TLS_CERT_ALTNAME_INVALID'});
	const creation = await app.inject({method: 'POST', url: '/api/sessions', payload: {mode: 'fixture'}});
	const {session, listenerId} = listenerSessionSchema.parse(creation.json());
	const play = await app.inject({method: 'POST', url: `/api/sessions/${session.id}/play`, payload: {listenerId}});
	assert.equal(play.statusCode, 200);
	const embeddedStart = await app.inject({method: 'POST', url: '/api/recordings', payload: {sessionId: session.id, minutes: 5, device: 'Automated HTTPS check'}});
	assert.equal(embeddedStart.statusCode, 200);
	const embedded = recordingSchema.parse(embeddedStart.json());
	let recorderExit = 0;
	try {
		await promisify(execFile)(process.execPath, [
			'--import',
			'tsx',
			path.join(repositoryRoot, 'apps/server/src/cli/soak-record.ts'),
			'--session',
			session.id,
			'--url',
			address,
			'--hours',
			'0.004',
			'--interval',
			'5',
			'--device',
			'Automated HTTPS recorder check; no physical device',
		], {
			cwd: path.join(repositoryRoot, 'apps/server'), timeout: 30_000, maxBuffer: 64 * 1024,
			env: {...process.env, DATA_DIR: directory, NODE_EXTRA_CA_CERTS: certificate},
		});
	} catch (error) {
		if ((error as {code?: unknown}).code !== 2) {
			throw error;
		}

		recorderExit = 2;
	}

	assert.equal(recorderExit, 2, 'Recorder should flag the deliberately unconsumed session');
	const entries = await readdir(path.join(directory, 'soaks'));
	const runs = entries.filter(name => !name.startsWith('pwa-'));
	assert.equal(runs.length, 1);
	const summary = JSON.parse(await readFile(path.join(directory, 'soaks', runs[0]!, 'summary.json'), 'utf8')) as {
		outcome: string; completeSamples: number; samples: number; issues: Record<string, unknown>;
	};
	assert.equal(summary.outcome, 'completed');
	assert.ok(summary.samples >= 3);
	assert.equal(summary.completeSamples, summary.samples);
	assert.ok(summary.issues['playback-interrupted']);
	const debug = await app.inject(`/api/debug/sessions/${session.id}`);
	assert.equal(debug.json<{producerPid: number | undefined}>().producerPid, null);
	assert.equal(debug.json<{listeners: Array<{state: string}>}>().listeners[0]?.state, 'expired');
	const embeddedStop = await app.inject({method: 'POST', url: `/api/recordings/${embedded.id}/stop`});
	const ended = recordingSchema.parse(embeddedStop.json());
	assert.equal(ended.state, 'interrupted');
	assert.ok(ended.samples >= 3);
	assert.equal(ended.samples, ended.completeSamples);
	assert.ok(ended.issues.some(issue => issue.code === 'playback-interrupted'));
	const download = await app.inject(`/api/recordings/${embedded.id}/summary`);
	assert.equal(download.headers['cache-control'], 'no-store');
	assert.ok(download.body.includes('Review required'));
	console.log('PASS: verified HTTPS; untrusted/mismatched certificates rejected; CLI recorder trusts only its configured CA; CLI and PWA recording observe watchdog expiry without renewing demand.');
} finally {
	await app?.close();
	await rm(directory, {recursive: true, force: true});
}
