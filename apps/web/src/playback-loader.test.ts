import {expect, it, vi} from 'vitest';
import {playbackLoader} from './playback-loader.js';

function deferred() {
	let settle!: (value: boolean) => void;
	const promise = new Promise<boolean>((resolve) => {
		settle = resolve;
	});
	return {promise, resolve: settle};
}

function fixture() {
	const transport = {
		loadSource: vi.fn(),
		startLoad: vi.fn(),
		stopLoad: vi.fn(),
	};
	return {transport, loader: playbackLoader(transport, '/stream.m3u8')};
}

it('does not request a paused manifest and waits for the server before first load', async () => {
	const {transport, loader} = fixture();
	const ready = deferred();
	const pending = loader.start(ready.promise);
	await Promise.resolve();
	expect(transport.loadSource).not.toHaveBeenCalled();
	expect(transport.startLoad).not.toHaveBeenCalled();
	ready.resolve(true);
	await pending;
	expect(transport.loadSource).toHaveBeenCalledExactlyOnceWith('/stream.m3u8');
	expect(transport.startLoad).toHaveBeenCalledExactlyOnceWith(-1);
	loader.stop();
	await loader.start(Promise.resolve(true));
	expect(transport.loadSource).toHaveBeenCalledTimes(1);
	expect(transport.startLoad).toHaveBeenCalledTimes(2);
});

it('does not start transport after a rejected server play', async () => {
	const {transport, loader} = fixture();
	await loader.start(Promise.resolve(false));
	expect(transport.loadSource).not.toHaveBeenCalled();
	expect(transport.startLoad).not.toHaveBeenCalled();
});

it('pause or disposal invalidates a pending start even when the server finishes later', async () => {
	const {transport, loader} = fixture();
	const ready = deferred();
	const pending = loader.start(ready.promise);
	loader.stop();
	ready.resolve(true);
	await pending;
	expect(transport.loadSource).not.toHaveBeenCalled();
	expect(transport.startLoad).not.toHaveBeenCalled();
	expect(transport.stopLoad).toHaveBeenCalledTimes(1);
});

it('only the latest play intent starts transport across rapid play-pause-play', async () => {
	const {transport, loader} = fixture();
	const first = deferred();
	const second = deferred();
	const pendingFirst = loader.start(first.promise);
	loader.stop();
	const pendingSecond = loader.start(second.promise);
	first.resolve(true);
	await pendingFirst;
	expect(transport.startLoad).not.toHaveBeenCalled();
	second.resolve(true);
	await pendingSecond;
	expect(transport.loadSource).toHaveBeenCalledTimes(1);
	expect(transport.startLoad).toHaveBeenCalledTimes(1);
});
