import {randomUUID} from 'node:crypto';
import {mkdir, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {runAudioCommand} from './process.js';

export async function createFixture(target: string, ffmpeg = 'ffmpeg') {
	await mkdir(path.dirname(target), {recursive: true});
	const temporary = `${target}.${randomUUID()}.tmp.wav`;
	try {
		await runAudioCommand(ffmpeg, [
			'-hide_banner',
			'-loglevel',
			'error',
			'-nostdin',
			'-y',
			'-f',
			'lavfi',
			'-i',
			'anoisesrc=color=pink:amplitude=0.025:sample_rate=44100:duration=60:seed=1932',
			'-af',
			'lowpass=f=1600,alimiter=limit=0.063:level=false:attack=5:release=50',
			'-ar',
			'44100',
			'-ac',
			'2',
			'-c:a',
			'pcm_s16le',
			temporary,
		]);
		await rename(temporary, target);
	} finally {
		await rm(temporary, {force: true});
	}
}
