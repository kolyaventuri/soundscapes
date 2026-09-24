import {spawn} from 'node:child_process';
import process from 'node:process';
import {parseArgs, stripVTControlCharacters} from 'node:util';
import {dataDirectory, readReport} from './lib/session-report.mjs';

try {
	const {values} = parseArgs({
		options: {
			session: {type: 'string'}, latest: {type: 'boolean'}, wav: {type: 'string'},
			'data-dir': {type: 'string'}, 'print-path': {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
		},
	});
	if (values.help) {
		console.log('Usage: pnpm wav:play <--session ID|--latest> --wav NUMBER [--data-dir PATH] [--print-path]\n\n'
			+ 'Use the WAV number shown by pnpm session:prompts. Plays one normalized, unmixed recording.\n'
			+ 'Uses afplay on macOS, ffplay elsewhere. Ctrl-C stops playback. No streaming-session changes.\n'
			+ '--print-path resolves the selection without playing it. --latest selects the newest saved session.');
	} else {
		if (Boolean(values.session) === Boolean(values.latest) || !/^[1-9]\d*$/.test(values.wav ?? '') || !Number.isSafeInteger(Number(values.wav))) {
			throw new Error('Supply either --session ID or --latest, and a positive --wav NUMBER from session:prompts.');
		}

		const report = readReport(dataDirectory(values['data-dir']), values.session);
		const asset = report.groups.flatMap(group => group.assets).find(asset => asset.wavNumber === Number(values.wav));
		if (!asset) {
			throw new Error(`WAV ${values.wav} is not in session ${report.id}. Run pnpm session:prompts ${report.id} to see available numbers.`);
		}

		if (!asset.fileExists) {
			throw new Error(`WAV file is missing: ${asset.absoluteFile}`);
		}

		if (values['print-path']) {
			console.log(asset.absoluteFile);
		} else {
			console.log(stripVTControlCharacters(`Playing WAV ${asset.wavNumber}: ${asset.title}\nSession: ${report.id}\n${asset.absoluteFile}\nCtrl-C to stop.`));
			await play(asset.absoluteFile);
		}
	}
} catch (error) {
	console.error(`Unable to play WAV: ${error.message}`);
	process.exitCode = 1;
}

async function play(file) {
	const player = process.platform === 'darwin' ? 'afplay' : 'ffplay';
	const args = player === 'afplay' ? [file] : ['-nodisp', '-autoexit', '-hide_banner', '-loglevel', 'error', file];
	const child = spawn(player, args, {stdio: 'inherit'});
	const interrupt = () => child.kill('SIGINT');
	const terminate = () => child.kill('SIGTERM');
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', terminate);
	try {
		const result = await new Promise((resolve, reject) => {
			child.once('error', error => reject(new Error(`Could not start ${player}: ${error.message}`)));
			child.once('close', (code, signal) => {
				resolve({code, signal});
			});
		});
		process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 143);
	} finally {
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', terminate);
	}
}
