type Transport = {
	loadSource: (url: string) => void;
	startLoad: (position: number) => void;
	stopLoad: () => void;
};

// Attaching MediaSource is safe before Play; loading an empty, paused live
// playlist is not. Wait for the server's current encoder run before loading.
export function playbackLoader(transport: Transport, url: string) {
	let revision = 0;
	let loaded = false;
	return {
		async start(ready: Promise<boolean>) {
			const attempt = ++revision;
			if (!(await ready) || attempt !== revision) {
				return;
			}

			if (!loaded) {
				transport.loadSource(url);
				loaded = true;
			}

			transport.startLoad(-1);
		},
		stop() {
			revision++;
			transport.stopLoad();
		},
	};
}
