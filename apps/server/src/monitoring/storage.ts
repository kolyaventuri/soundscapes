import {Buffer} from 'node:buffer';
import {
	appendFile, lstat, opendir, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export async function writeJson(file: string, value: unknown) {
	await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
	await rename(`${file}.tmp`, file);
}

export class RotatingLog {
	rotations = 0;
	private bytes = 0;

	// Only used in a newly created run directory. Three files per log, at most.
	constructor(private readonly file: string, private readonly limit = 4 * 1024 * 1024) {}

	async append(value: unknown) {
		const line = `${JSON.stringify(value)}\n`;
		const bytes = Buffer.byteLength(line);
		if (bytes > this.limit) {
			throw new Error('A diagnostic record exceeds the log size limit');
		}

		if (this.bytes + bytes > this.limit) {
			await rm(`${this.file}.2`, {force: true});
			if (this.rotations > 0) {
				await rename(`${this.file}.1`, `${this.file}.2`);
			}

			await rename(this.file, `${this.file}.1`);
			this.rotations++;
			this.bytes = 0;
		}

		await appendFile(this.file, line, {mode: 0o600});
		this.bytes += bytes;
	}
}

export type DiskUsage = {files: number; bytes: number; hlsFiles: number; hlsBytes: number; pcmFiles: number; pcmBytes: number; truncated: boolean};

export async function sessionDiskUsage(directory: string, maxEntries = 5000): Promise<DiskUsage> {
	const result: DiskUsage = {
		files: 0, bytes: 0, hlsFiles: 0, hlsBytes: 0, pcmFiles: 0, pcmBytes: 0, truncated: false,
	};
	let visited = 0;
	async function countFile(file: string) {
		try {
			const info = await lstat(file);
			if (!info.isFile()) {
				return;
			}

			result.files++;
			result.bytes += info.size;
			if (file.endsWith('.ts')) {
				result.hlsFiles++;
				result.hlsBytes += info.size;
			} else if (file.endsWith('.pcm')) {
				result.pcmFiles++;
				result.pcmBytes += info.size;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	async function walk(current: string): Promise<void> {
		try {
			// Do not follow symlinks, including a replaced session root.
			const info = await lstat(current);
			if (!info.isDirectory()) {
				return;
			}

			const entries = await opendir(current);
			for await (const entry of entries) {
				if (++visited > maxEntries) {
					result.truncated = true;
					break;
				}

				const file = path.join(current, entry.name);
				if (entry.isDirectory()) {
					await walk(file);
				} else if (entry.isFile()) {
					await countFile(file);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	await walk(directory);
	return result;
}
