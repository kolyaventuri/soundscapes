import {spawn} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {loadEnvironment, readConfig, repositoryRoot} from '../config.js';

loadEnvironment();
const config = readConfig();
const child = spawn(config.sound.python, [
	path.join(repositoryRoot, 'workers/sound/download.py'), config.sound.manifest, config.sound.model, config.sound.device,
], {stdio: 'inherit', env: process.env});
child.on('error', error => {
	console.error('Install the isolated sound runtime first; see README.', error.message);
	process.exitCode = 1;
});
child.on('exit', code => {
	process.exitCode = code ?? 1;
});
