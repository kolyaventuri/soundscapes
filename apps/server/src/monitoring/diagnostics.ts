import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import process from 'node:process';
import {type AppConfig} from '../config.js';

export type DiagnosticEvent = {sequence: number; at: string; event: string; sessionId: string; detail?: string};

// A bounded, process-local journal. The recorder detects restarts and overflow;
// this is deliberately not another writer to the session database.
export class Diagnostics {
	private readonly instanceId = randomUUID();
	private readonly startedAt = new Date().toISOString();
	private readonly events: DiagnosticEvent[] = [];
	private sequence = 0;

	record(event: string, sessionId = 'server', detail?: string) {
		this.events.push({
			sequence: ++this.sequence, at: new Date().toISOString(), event, sessionId, ...(detail ? {detail: detail.slice(0, 4096)} : {}),
		});
		if (this.events.length > 128) {
			this.events.shift();
		}
	}

	snapshot(config: AppConfig) {
		return {
			instanceId: this.instanceId, startedAt: this.startedAt, pid: process.pid, hostname: hostname(), nodeVersion: process.version,
			dataDirectory: config.dataDirectory, idleTimeoutSeconds: config.idleTimeoutMs / 1000,
			plannerConfiguration: config.planner,
			memory: process.memoryUsage(), cpu: process.cpuUsage(), uptimeSeconds: process.uptime(),
			latestSequence: this.sequence, events: [...this.events],
		};
	}
}
