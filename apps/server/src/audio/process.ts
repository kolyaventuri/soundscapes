import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);

export async function runAudioCommand(binary: string, args: string[], timeoutMs = 60_000, signal?: AbortSignal) {
	return execute(binary, args, {
		timeout: timeoutMs, signal, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
	});
}
