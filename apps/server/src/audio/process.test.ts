import process from 'node:process';
import {expect, it} from 'vitest';
import {runAudioCommand} from './process.js';

it('passes metacharacters as literal subprocess arguments without a shell', async () => {
	const argument = 'scene $(echo injected); `echo injected` "quoted"\n-next';
	const result = await runAudioCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument]);
	expect(result.stdout).toBe(argument);
});

it('terminates a stuck subprocess at its deadline', async () => {
	await expect(runAudioCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 100)).rejects.toMatchObject({
		killed: true, signal: 'SIGKILL',
	});
});

it('rejects excessive subprocess output instead of buffering without a limit', async () => {
	await expect(runAudioCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'])).rejects.toMatchObject({
		code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
	});
});
