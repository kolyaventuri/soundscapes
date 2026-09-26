const cacheName = 'soundscapes-shell-__SHELL_REVISION__';
const shellFiles = ['__SHELL_FILES__'];

globalThis.addEventListener('install', event => {
	event.waitUntil((async () => {
		const cache = await globalThis.caches.open(cacheName);
		await cache.addAll(shellFiles);
	})());
	// Let existing playback tabs keep their current worker until they close.
});

globalThis.addEventListener('activate', event => {
	event.waitUntil((async () => {
		const names = await globalThis.caches.keys();
		await Promise.all(names.filter(name => name.startsWith('soundscapes-shell-') && name !== cacheName).map(async name => globalThis.caches.delete(name)));
		await globalThis.clients.claim();
	})());
});

globalThis.addEventListener('fetch', event => {
	const {request} = event;
	const url = new URL(request.url);
	// Only an explicit build-time app-shell allowlist is handled. Never intercept
	// API requests, HLS, WAVs, cross-origin resources, or playback activity.
	if (request.method !== 'GET' || url.origin !== globalThis.location.origin || url.pathname.startsWith('/api/')) {
		return;
	}

	if (request.mode === 'navigate' && ['/', '/diagnostics'].includes(url.pathname)) {
		event.respondWith((async () => {
			try {
				return await fetch(request);
			} catch {
				const cache = await globalThis.caches.open(cacheName);
				return await cache.match('/') ?? Response.error();
			}
		})());
	} else if (shellFiles.includes(url.pathname) && url.pathname !== '/') {
		event.respondWith((async () => {
			const cache = await globalThis.caches.open(cacheName);
			return await cache.match(url.pathname) ?? fetch(request);
		})());
	}
});
