import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {expect, it, vi} from 'vitest';

async function worker() {
	const template = await readFile(
		new URL('../public/sw.js', import.meta.url),
		'utf8',
	);
	const source = template.replace(
		"['__SHELL_FILES__']",
		JSON.stringify(['/', '/assets/app.js', '/icon-192.png']),
	);
	const listeners = new Map<string, (event: unknown) => void>();
	const cache = {
		addAll: vi.fn(async () => undefined),
		match: vi.fn(async () => new Response('cached shell')),
	};
	const caches = {
		open: vi.fn(async () => cache),
		keys: async () => ['unrelated-cache', 'soundscapes-shell-old'],
		delete: vi.fn(async () => true),
	};
	const fetch = vi.fn(async () => new Response('network'));
	runInNewContext(source, {
		URL,
		Response,
		caches,
		fetch,
		location: {origin: 'https://soundscape.local'},
		clients: {claim: async () => undefined},
		addEventListener(name: string, listener: (event: unknown) => void) {
			listeners.set(name, listener);
		},
	});
	return {
		cache,
		caches,
		fetch,
		async dispatch(
			type: string,
			request?: {url: string; method: string; mode: string},
		) {
			let response: Promise<Response> | undefined;
			let work: Promise<void> | undefined;
			listeners.get(type)!({
				request,
				respondWith(value: Promise<Response>) {
					response = value;
				},
				waitUntil(value: Promise<void>) {
					work = value;
				},
			});
			await work;
			return response;
		},
	};
}

it('never intercepts HLS, status/control APIs, WAVs, unknown resources or other origins', async () => {
	const app = await worker();
	for (const [url, method, mode] of [
		['/api/sessions/test', 'GET', 'cors'],
		['/api/sessions/test/stream.m3u8?listenerId=abc', 'GET', 'cors'],
		['/api/sessions/test/hls/run/segment.ts', 'GET', 'cors'],
		['/api/sessions/test/pause', 'POST', 'cors'],
		['/assets/audio.wav', 'GET', 'cors'],
		['/assets/app.js', 'HEAD', 'cors'],
		['/unknown', 'GET', 'navigate'],
		['https://other.example/assets/app.js', 'GET', 'cors'],
	]) {
		expect(
			// eslint-disable-next-line no-await-in-loop -- Exercise each excluded request.
			await app.dispatch('fetch', {
				url: new URL(url!, 'https://soundscape.local').href,
				method: method!,
				mode: mode!,
			}),
		).toBeUndefined();
	}

	expect(app.fetch).not.toHaveBeenCalled();
	expect(app.caches.open).not.toHaveBeenCalled();
});

it('pre-caches only the build allowlist, keeps session IDs out of cache keys and scopes cleanup', async () => {
	const app = await worker();
	await app.dispatch('install');
	expect(app.cache.addAll).toHaveBeenCalledWith([
		'/',
		'/assets/app.js',
		'/icon-192.png',
	]);
	app.fetch.mockRejectedValueOnce(new Error('Offline'));
	const response = await app.dispatch('fetch', {
		url: 'https://soundscape.local/?session=private-session-id',
		method: 'GET',
		mode: 'navigate',
	});
	expect(await response!.text()).toBe('cached shell');
	expect(app.cache.match).toHaveBeenCalledWith('/');
	await app.dispatch('activate');
	expect(app.caches.delete).toHaveBeenCalledExactlyOnceWith(
		'soundscapes-shell-old',
	);
});
