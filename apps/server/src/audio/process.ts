import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);

export async function runAudioCommand(binary: string, args: string[]) {
	return execute(binary, args, {timeout: 60_000, maxBuffer: 1024 * 1024});
}
