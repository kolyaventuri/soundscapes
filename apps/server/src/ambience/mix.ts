import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {type Asset} from '../persistence/store.js';
import {type Bed} from './timeline.js';

const execute = promisify(execFile);
export const chunkMs = 30_000;
export const bytesPerSecond = 44_100 * 2 * 2;

// Each chunk is a slice of the same absolute envelopes, so fades cross chunk
// boundaries without restarting. DSP stays in FFmpeg; one continuous encoder
// applies the output limiter and preserves AAC state between PCM chunks.
export function mixArguments({beds, assets, root, startMs, durationMs, output}: {beds: Bed[]; assets: Asset[]; root: string; startMs: number; durationMs: number; output: string}) {
	const overlap = beds.filter(bed => bed.startMs < startMs + durationMs && bed.startMs + bed.durationMs > startMs);
	if (overlap.length === 0) {
		throw new Error('Timeline has no audio at the requested position');
	}

	// One graph worker bounds DSP concurrency and avoids cross-input scheduling stalls.
	const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1'];
	const filters: string[] = [];
	for (const [index, bed] of overlap.entries()) {
		const asset = assets.find(item => item.id === bed.assetId);
		if (!asset) {
			throw new Error('Timeline references a missing ambience asset');
		}

		args.push('-i', path.join(root, asset.file));
		const offset = Math.max(0, startMs - bed.startMs) / 1000;
		const delay = Math.max(0, bed.startMs - startMs);
		const fadeIn = bed.fadeInMs > 0 ? `afade=t=in:d=${bed.fadeInMs / 1000}:curve=qsin,` : '';
		const fadeOut = bed.fadeOutMs > 0 ? `afade=t=out:st=${(bed.durationMs - bed.fadeOutMs) / 1000}:d=${bed.fadeOutMs / 1000}:curve=qsin,` : '';
		filters.push(`[${index}:a]${fadeIn}${fadeOut}atrim=start=${offset}:duration=${durationMs / 1000},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[a${index}]`);
	}

	filters.push(`${overlap.map((bed, index) => `[a${index}]`).join('')}amix=inputs=${overlap.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${durationMs / 1000}[out]`);
	return [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', '-f', 's16le', output];
}

export async function renderChunk(ffmpeg: string, args: string[], signal: AbortSignal) {
	const started = Date.now();
	try {
		await execute(ffmpeg, args, {
			signal, timeout: 30_000, maxBuffer: 8192, killSignal: 'SIGKILL',
		});
	} catch (error) {
		const failure = error as Error & {code?: string | number; signal?: string; killed?: boolean; stderr?: string};
		throw new Error(`PCM mixer failed after ${Date.now() - started}ms: code=${String(failure.code)} signal=${String(failure.signal)} killed=${String(failure.killed)} ${failure.stderr ?? failure.message}`, {cause: error});
	}
}
