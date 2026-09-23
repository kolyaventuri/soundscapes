import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {expect, it, vi} from 'vitest';
import {startRenderer} from './hls.js';

it.each(['missing', 'exit'])('cleans up a real child-process %s failure before playback', async kind => {
	const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-process-'));
	const onFailure = vi.fn();
	// Node exits on FFmpeg-specific flags; no FFmpeg installation is needed in CI.
	const renderer = await startRenderer({
		directory, runId: randomUUID(), fixturePath: path.join(directory, 'fixture.wav'),
		ffmpegPath: kind === 'missing' ? path.join(directory, 'missing-command') : process.execPath,
		onFailure,
	});
	try {
		await expect(renderer.ready()).rejects.toThrow();
		expect(onFailure).toHaveBeenCalledOnce();
		expect(renderer.running).toBe(false);
	} finally {
		await renderer.stop();
		await rm(directory, {recursive: true, force: true});
	}
});
