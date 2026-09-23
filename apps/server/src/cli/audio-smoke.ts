import assert from 'node:assert/strict';
import {
	mkdtemp, readFile, readdir, rm,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {createFixture} from '../audio/fixture.js';
import {runAudioCommand} from '../audio/process.js';
import {loadEnvironment, readConfig} from '../config.js';

loadEnvironment();
const config = readConfig();
const directory = await mkdtemp(path.join(tmpdir(), 'soundscapes-aac-'));
try {
	const fixture = path.join(directory, 'fixture.wav');
	await createFixture(fixture, config.ffmpegPath);
	const playlistPath = path.join(directory, 'stream.m3u8');
	await runAudioCommand(config.ffmpegPath, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-nostdin',
		'-i',
		fixture,
		'-t',
		'19',
		'-vn',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-ar',
		'44100',
		'-ac',
		'2',
		'-f',
		'hls',
		'-hls_time',
		'6',
		'-hls_list_size',
		'3',
		'-hls_flags',
		'temp_file+delete_segments',
		'-hls_segment_filename',
		path.join(directory, 'segment-%06d.ts'),
		playlistPath,
	]);
	const playlist = await readFile(playlistPath, 'utf8');
	assert.match(playlist, /#EXTM3U/);
	const segments = playlist.split('\n').filter(line => line.endsWith('.ts'));
	assert.equal(segments.length, 3);
	const files = await readdir(directory);
	assert.ok(!files.some(name => name.endsWith('.tmp')));
	const {stdout} = await runAudioCommand(config.ffprobePath, [
		'-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', playlistPath,
	]);
	const probe = z.object({
		streams: z.array(z.object({
			codec_name: z.string(), sample_rate: z.string(), channels: z.number(),
		})).min(1),
	}).parse(JSON.parse(stdout));
	assert.ok(probe.streams.every(stream => stream.codec_name === 'aac' && stream.sample_rate === '44100' && stream.channels === 2));
	await runAudioCommand(config.ffmpegPath, ['-v', 'error', '-nostdin', '-i', playlistPath, '-f', 'null', '-']);
	console.log('PASS: 44.1 kHz stereo AAC, 6-second HLS segments, sliding playlist, atomic publication, and playlist decoding.');
} finally {
	await rm(directory, {recursive: true, force: true});
}
