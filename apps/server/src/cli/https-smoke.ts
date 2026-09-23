import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {get} from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {buildApp} from '../app.js';
import {readConfig} from '../config.js';

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
	const config = readConfig({DATA_DIR: directory, TLS_CERT_FILE: certificate, TLS_KEY_FILE: key});
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
	console.log('PASS: HTTPS API with certificate and hostname verification; temporary trust scoped to the test client.');
} finally {
	await app?.close();
	await rm(directory, {recursive: true, force: true});
}
