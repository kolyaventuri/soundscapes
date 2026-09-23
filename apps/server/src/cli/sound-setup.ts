import {spawn} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {loadEnvironment, repositoryRoot} from '../config.js';

loadEnvironment();
const child = spawn(path.join(repositoryRoot, 'models/sound-runtime/bin/python'), [
	path.join(repositoryRoot, 'workers/sound/download.py'), path.join(repositoryRoot, 'models/stable-audio-3-small-sfx'),
], {stdio: 'inherit', env: process.env});
child.on('error', error => {
	console.error('Install the isolated sound runtime first; see README.', error.message);
	process.exitCode = 1;
});
child.on('exit', code => {
	process.exitCode = code ?? 1;
});
