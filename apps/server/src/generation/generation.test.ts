import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
	afterEach, expect, it, vi,
} from 'vitest';
import {readConfig} from '../config.js';
import {type GeneratedAudio, type SoundGenerator, type SoundRequest} from './contracts.js';
import {GenerationQueue} from './queue.js';
import {PythonSoundGenerator} from './python.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map(async close => close()));
});
const request = (kind: SoundRequest['kind'] = 'event', prompt = 'gentle breeze'): SoundRequest => ({
	id: randomUUID(), sessionId: randomUUID(), kind, prompt, durationSeconds: 12, seed: 1,
});
const audio = (request: SoundRequest): GeneratedAudio => ({
	id: request.id, path: `/managed/${request.id}.wav`, model: 'stable-audio-3-small-sfx', revision: 'a'.repeat(40),
	durationSeconds: request.durationSeconds, sampleRate: 44_100, channels: 2, elapsedMs: 1, loadMs: 0, peakRssBytes: 100,
});

function queueHarness(capacity = 8) {
	let finish: () => void = () => undefined;
	const generate = vi.fn<SoundGenerator['generate']>(async (request, signal) => new Promise((resolve, reject) => {
		const cancel = () => {
			reject(signal.reason as Error);
		};

		signal.addEventListener('abort', cancel, {once: true});
		finish = () => {
			signal.removeEventListener('abort', cancel);
			resolve(audio(request));
		};
	}));
	const queue = new GenerationQueue({generate, close: async () => undefined, diagnostics: () => ({pid: null, busy: false, loaded: false})}, Date.now, capacity);
	cleanup.push(async () => queue.close());
	const options = {signal: new AbortController().signal, valid: () => true, deadlineAt: Date.now() + 10_000};
	return {
		queue, generate, options, finish() {
			finish();
		},
	};
}

it('serializes inference, prioritizes waiting ambience, and bounds queue size', async () => {
	const {queue, generate, options, finish} = queueHarness(3);
	const first = request();
	const laterEvent = request();
	const bed = request('ambience');
	const one = queue.submit(first, options);
	const two = queue.submit(laterEvent, options);
	const three = queue.submit(bed, options);
	await expect(queue.submit(request(), options)).rejects.toThrow('full');
	expect(generate).toHaveBeenCalledTimes(1);
	finish();
	await one;
	await vi.waitFor(() => {
		expect(generate).toHaveBeenCalledTimes(2);
	});
	expect(generate.mock.calls[1]![0].id).toBe(bed.id);
	finish();
	await three;
	await vi.waitFor(() => {
		expect(generate).toHaveBeenCalledTimes(3);
	});
	finish();
	await two;
	expect(queue.jobs).toEqual([]);
});

it('drops queued idle/expired/cancelled jobs and cancels in-flight inference', async () => {
	const {queue, generate, options, finish} = queueHarness();
	const abort = new AbortController();
	const first = queue.submit(request(), options);
	let valid = true;
	const stale = queue.submit(request(), {...options, valid: () => valid});
	const cancelled = queue.submit(request(), {...options, signal: abort.signal});
	const staleCheck = expect(stale).rejects.toThrow('expired');
	const cancelCheck = expect(cancelled).rejects.toThrow();
	valid = false;
	abort.abort();
	await cancelCheck;
	finish();
	await first;
	await staleCheck;
	expect(generate).toHaveBeenCalledTimes(1);
	const activeAbort = new AbortController();
	const active = queue.submit(request(), {...options, signal: activeAbort.signal});
	const activeCheck = expect(active).rejects.toThrow();
	await vi.waitFor(() => {
		expect(generate).toHaveBeenCalledTimes(2);
	});
	activeAbort.abort();
	await activeCheck;
	await expect(queue.submit(request(), {...options, deadlineAt: Date.now() - 1})).rejects.toThrow('deadline');
	expect(queue.jobs).toEqual([]);
});

it('rejects late adapter results rather than applying them after an owner becomes idle', async () => {
	const {queue, options, generate, finish} = queueHarness();
	let active = true;
	const result = queue.submit(request(), {...options, valid: () => active});
	const check = expect(result).rejects.toThrow('Stale');
	await vi.waitFor(() => {
		expect(generate).toHaveBeenCalledTimes(1);
	});
	active = false;
	finish();
	await check;
});

async function workerHarness(idleUnloadMs = 10_000) {
	const directory = await mkdtemp(path.join(tmpdir(), 'sound-worker-'));
	const worker = path.join(directory, 'fake.mjs');
	await writeFile(worker, `
import readline from 'node:readline';
console.log(JSON.stringify({type:'ready',protocol:1,network:'disabled'}));
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);
 if(r.prompt==='hang')return;
 if(r.prompt==='crash')process.exit(7);
 if(r.prompt==='malformed'){console.log('invalid json');return;}
 if(r.prompt==='oversized'){console.log('a'.repeat(40000));return;}
 console.log(JSON.stringify({type:'result',audio:{id:r.id,path:r.prompt==='wrong-path'?'/tmp/foreign.wav':process.env.SOUNDSCAPES_SOUND_OUTPUT+'/'+r.id+'.wav',
 model:'stable-audio-3-small-sfx',revision:'a'.repeat(40),durationSeconds:r.durationSeconds,sampleRate:44100,channels:2,elapsedMs:1,loadMs:0,peakRssBytes:100}}));
});`);
	const generator = new PythonSoundGenerator({
		...readConfig().sound, python: process.execPath, worker, manifest: worker, output: directory, idleUnloadMs, timeoutMs: 1000,
	});
	cleanup.push(async () => {
		await generator.close();
		await rm(directory, {recursive: true, force: true});
	});
	return generator;
}

it.each(['crash', 'malformed', 'oversized', 'wrong-path', 'hang'])('reaps a %s worker and permits a clean subsequent request', async mode => {
	const generator = await workerHarness();
	await expect(generator.generate(request('event', mode), new AbortController().signal)).rejects.toThrow();
	expect(generator.diagnostics()).toEqual({pid: null, loaded: false, busy: false});
	await expect(generator.generate(request(), new AbortController().signal)).resolves.toMatchObject({durationSeconds: 12});
});

it('kills cancelled inference and unloads a retained idle worker', async () => {
	const generator = await workerHarness(50);
	const abort = new AbortController();
	const result = generator.generate(request('event', 'hang'), abort.signal);
	const check = expect(result).rejects.toThrow();
	await vi.waitFor(() => {
		expect(generator.diagnostics().pid).not.toBeNull();
	});
	abort.abort();
	await check;
	expect(generator.diagnostics().pid).toBeNull();
	await generator.generate(request(), new AbortController().signal);
	expect(generator.diagnostics().loaded).toBe(true);
	await vi.waitFor(() => {
		expect(generator.diagnostics().pid).toBeNull();
	});
});
