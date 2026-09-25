import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {repositoryRoot, type AppConfig} from '../config.js';

export async function captureProvenance(config: AppConfig) {
	const execute = promisify(execFile);
	const provenance = await Promise.allSettled([
		execute('git', ['rev-parse', 'HEAD'], {cwd: repositoryRoot, timeout: 5000}),
		execute('git', ['status', '--porcelain'], {cwd: repositoryRoot, timeout: 5000, maxBuffer: 64 * 1024}),
		execute(config.ffmpegPath, ['-version'], {timeout: 5000, maxBuffer: 64 * 1024}),
		stat(path.join(repositoryRoot, 'apps/server/dist/index.js')),
	]);
	const [revision, dirty, ffmpeg, build] = provenance;
	return {
		sourceRevisionAtRecorderStart: revision.status === 'fulfilled' ? revision.value.stdout.trim() : null,
		sourceDirtyAtRecorderStart: dirty.status === 'fulfilled' ? dirty.value.stdout.trim().length > 0 : null,
		builtEntryModifiedAt: build.status === 'fulfilled' ? build.value.mtime.toISOString() : null,
		ffmpegVersion: ffmpeg.status === 'fulfilled' ? ffmpeg.value.stdout.split('\n')[0] : null,
	};
}
