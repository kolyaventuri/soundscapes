import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {type Asset} from '../persistence/store.js';
import {type ScheduledEvent} from '../planning/contracts.js';
import {type Bed} from './timeline.js';

const execute = promisify(execFile);
export const chunkMs = 30_000;
export const bytesPerSecond = 44_100 * 2 * 2;

// Each chunk is a slice of the same absolute envelopes, so fades cross chunk
// boundaries without restarting. DSP stays in FFmpeg; one continuous encoder
// applies the output limiter and preserves AAC state between PCM chunks.
type MixOptions = {beds: Bed[]; assets: Asset[]; events?: ScheduledEvent[]; root: string; startMs: number; durationMs: number; output: string};
export function mixArguments({beds, assets, events = [], root, startMs, durationMs, output}: MixOptions) {
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

	const labels = overlap.map((bed, index) => `[a${index}]`);
	for (const event of events.filter(event => event.startMs < startMs + durationMs && event.startMs + event.durationMs > startMs)) {
		const asset = assets.find(asset => asset.id === event.assetId && asset.kind === 'event');
		if (!asset || (event.offsetMs ?? 0) + event.durationMs > asset.durationMs) {
			// Missing optional events must not interrupt the bed.
			continue;
		}

		const index = labels.length;
		args.push('-i', path.join(root, asset.file));
		const offset = Math.max(0, startMs - event.startMs) / 1000;
		const delay = Math.max(0, event.startMs - startMs);
		const fade = Math.min(event.fadeMs, event.durationMs / 2) / 1000;
		const processing = [
			`atrim=start=${(event.offsetMs ?? 0) / 1000}:duration=${event.durationMs / 1000}`,
			'asetpts=PTS-STARTPTS',
			`lowpass=f=${event.lowpassHz}`,
			`volume=${event.gain}`,
			`pan=stereo|c0=${1 - Math.max(0, event.pan)}*c0|c1=${1 + Math.min(0, event.pan)}*c1`,
			`afade=t=in:d=${fade}`,
			`afade=t=out:st=${(event.durationMs / 1000) - fade}:d=${fade}`,
			`atrim=start=${offset}:end=${Math.min(event.durationMs / 1000, offset + (durationMs / 1000))}`,
			'asetpts=PTS-STARTPTS',
			`adelay=${delay}:all=1`,
		];
		filters.push(`[${index}:a]${processing.join(',')}[a${index}]`);
		labels.push(`[a${index}]`);
	}

	// Some FFmpeg builds lose usable timestamps when a crossfading input ends
	// after a fractional seek. Bound by sample count, never by those timestamps.
	const frames = Math.round(durationMs * 44.1);
	filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad=whole_len=${frames},atrim=end_sample=${frames},asetpts=N/SR/TB[out]`);
	return [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', '-f', 's16le', '-fs', String(frames * 4), output];
}

export async function renderChunk(ffmpeg: string, args: string[], signal: AbortSignal) {
	const started = Date.now();
	try {
		await execute(ffmpeg, args, {
			signal, timeout: 30_000, maxBuffer: 8192, killSignal: 'SIGKILL',
		});
	} catch (error) {
		const failure = error as Error & {code?: string | number; signal?: string; killed?: boolean; stderr?: string};
		const detail = `code=${String(failure.code)} signal=${String(failure.signal)} killed=${String(failure.killed)}`;
		throw new Error(`PCM mixer failed after ${Date.now() - started}ms: ${detail} ${failure.stderr ?? failure.message}`, {cause: error});
	}
}
