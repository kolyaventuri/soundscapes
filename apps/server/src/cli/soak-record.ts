/* eslint-disable no-await-in-loop -- Sampling and log rotation must remain serial and bounded. */
import {
	mkdir, mkdtemp, rename, writeFile,
} from 'node:fs/promises';
import {
	arch, hostname, platform, release,
} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {z} from 'zod';
import {
	loadEnvironment, readConfig,
} from '../config.js';
import {collectSample} from '../monitoring/sample.js';
import {RotatingLog, writeJson} from '../monitoring/storage.js';
import {captureProvenance} from '../monitoring/provenance.js';
import {RunSummary} from '../monitoring/summary.js';

const {values} = parseArgs({
	options: {
		session: {type: 'string'}, url: {type: 'string'}, hours: {type: 'string', default: '8'}, interval: {type: 'string', default: '30'},
		device: {type: 'string'}, help: {type: 'boolean', short: 'h'},
	},
});

if (values.help) {
	console.log(`Usage: pnpm soak:record --session <UUID> [--hours 8] [--interval 30] [--url http://127.0.0.1:3000] [--device "iPhone / iOS / browser / buds"]

Run on the server's Mac with the same DATA_DIR. Start playback first.
Only debug GETs are made; this does not play audio or keep a listener alive.
Interval: 5–60 seconds. Duration: 0.001–24 hours. Default: 8 hours, every 30 seconds.
Writes manifest.json, summary.json, summary.md, and rotating samples/events JSONL
under DATA_DIR/soaks/<timestamp>-<unique suffix> (about 24 MiB maximum logs/run).
Ctrl-C writes an interrupted summary; it does not stop the server or playback.
Exit 0: completed with no recorded issues; 2: review issues or interruption; 1: failure.
No exit code establishes audible playback or physical-device acceptance.`);
} else {
	try {
		await main();
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}

async function main() {
	const {config, sessionId, hours, intervalSeconds, device, url} = readOptions();

	const options = {origin: url.origin, sessionId, dataDirectory: config.dataDirectory};
	const initial = await collectSample(options);
	if (!initial.runtime || !initial.session) {
		throw new Error(`Start the updated server and supply an existing session before recording. ${initial.errors.join(' ')}`);
	}

	const parent = path.join(config.dataDirectory, 'soaks');
	await mkdir(parent, {recursive: true});
	const directory = await mkdtemp(path.join(parent, `${new Date().toISOString().replaceAll(':', '-')}-`));
	const samples = new RotatingLog(path.join(directory, 'samples.jsonl'));
	const events = new RotatingLog(path.join(directory, 'events.jsonl'));
	const summary = new RunSummary(intervalSeconds, sessionId);

	const startedAt = initial.at;
	await writeJson(path.join(directory, 'manifest.json'), {
		formatVersion: 1, startedAt, sessionId, origin: url.origin, requestedHours: hours, intervalSeconds, device,
		host: {
			hostname: hostname(), platform: platform(), release: release(), arch: arch(), recorderNode: process.version,
		},
		server: initial.runtime,
		...await captureProvenance(config),
		limits: {
			logBytesPerFile: 4 * 1024 * 1024, filesPerLog: 3, diskScanEntries: 5000, debugTimeoutMs: 5000,
		},
		notes: [
			'Source revision comes from the recorder checkout; it does not certify the server build. Build before starting the server and do not rebuild during the run.',
			'Local server/descendant process samples may miss brief mixer jobs. FFmpeg CPU is the platform ps estimate, not an interval measurement.',
			'Session disk excludes reusable assets, database, and recorder logs. The separate Ollama process and its GPU/RSS allocation are not measured here.',
			'The process-local journal can lose crash details or overflow between polls. Restarts and observed journal gaps are flagged.',
			'Only debug GETs are made. Server consumption does not prove audible playback.',
		],
	});
	console.log(`Recording to ${directory}\nSummary: ${path.join(directory, 'summary.md')}\nOnly observing session ${sessionId}; keep playback running on the test device.`);
	const controller = new AbortController();
	const interrupt = () => {
		controller.abort();
	};

	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);
	let outcome: 'recording' | 'completed' | 'interrupted' | 'failed' = 'recording';
	const deadline = Date.parse(startedAt) + (hours * 3_600_000);
	let sample = initial;
	async function saveSummary() {
		const snapshot = {
			...summary.json(), outcome, updatedAt: new Date().toISOString(), requestedHours: hours,
			elapsedHours: (Date.now() - Date.parse(startedAt)) / 3_600_000,
			logRotations: {samples: samples.rotations, events: events.rotations},
			assessment: Object.keys(summary.issues).length > 0 || outcome !== 'completed'
				? 'Review required; not an acceptance result.'
				: 'No issues detected in sampled telemetry; physical listening acceptance remains manual.',
		};
		await writeJson(path.join(directory, 'summary.json'), snapshot);
		const lines = [
			'# Playback soak recording',
			'',
			`State: **${outcome}** · ${snapshot.elapsedHours.toFixed(2)} / ${hours} hours · ${summary.completeSamples}/${summary.samples} complete samples.`,
			'',
			snapshot.assessment,
			'',
			`Session: ${sessionId}`,
			`Device notes: ${device.replaceAll('\n', ' ')}`,
			'',
			'## Issues',
			'',
			...Object.entries(summary.issues).map(([code, issue]) => `- **${code}**: ${issue.count} occurrence(s), ${issue.firstAt} to ${issue.lastAt}. ${issue.detail.replaceAll('\n', ' ')}`),
			...(Object.keys(summary.issues).length === 0 ? ['None recorded so far.'] : []),
			'',
			'## Sampled ranges',
			'',
			'| Metric | First | Last | Minimum | Maximum | Mean |',
			'| --- | ---: | ---: | ---: | ---: | ---: |',
			...Object.entries(snapshot.metrics).map(([name, metric]) => {
				const cells = [metric.first, metric.last, metric.minimum, metric.maximum, metric.mean].map(value => value.toFixed(2));
				return `| ${name} | ${cells.join(' | ')} |`;
			}),
			'',
			'CPU may exceed 100% across cores. Memory/disk use raw bytes. Periodic samples may miss peaks. Session disk excludes assets, database, and recorder files.',
			'',
			`Log rotations: samples ${samples.rotations}, events ${events.rotations}. Each log retains current, .1 (previous), and .2 (oldest); aggregates cover the full recorded run.`,
			'',
			'Inspect events.jsonl for lifecycle/errors and samples.jsonl for measurements. Add listening, lock-screen, Bluetooth, and reconnect observations separately.',
			'',
		];
		// Atomic replacement leaves the last complete report readable after a crash.
		await writeFile(path.join(directory, 'summary.md.tmp'), lines.join('\n'), {mode: 0o600});
		await rename(path.join(directory, 'summary.md.tmp'), path.join(directory, 'summary.md'));
	}

	try {
		while (true) {
			const findings = summary.add(sample);
			await samples.append({...sample, runtime: sample.runtime ? {...sample.runtime, events: undefined} : undefined});
			for (const event of findings.events) {
				await events.append({kind: 'server', instanceId: sample.runtime?.instanceId, ...event});
			}

			for (const warning of findings.warnings) {
				await events.append({kind: 'recorder', ...warning});
			}

			if (findings.warnings.length > 0) {
				console.log(`${sample.at}: ${[...new Set(findings.warnings.map(warning => warning.code))].join(', ')}`);
			}

			await saveSummary();
			if (controller.signal.aborted || Date.now() >= deadline) {
				break;
			}

			await delay(Math.max(0, Math.min(Date.parse(sample.at) + (intervalSeconds * 1000), deadline) - Date.now()), undefined, {signal: controller.signal});
			sample = await collectSample({...options, signal: controller.signal});
		}

		outcome = controller.signal.aborted ? 'interrupted' : 'completed';
	} catch (error) {
		outcome = controller.signal.aborted ? 'interrupted' : 'failed';
		if (outcome === 'failed') {
			await events.append({kind: 'recorder', ...summary.issue('recorder-failed', new Date().toISOString(), String(error))});
		}
	} finally {
		process.off('SIGINT', interrupt);
		process.off('SIGTERM', interrupt);
		await saveSummary();
	}

	console.log(`${outcome}: ${path.join(directory, 'summary.md')}`);
	process.exitCode = outcome === 'failed' ? 1 : (outcome !== 'completed' || Object.keys(summary.issues).length > 0 ? 2 : 0);
}

function readOptions() {
	loadEnvironment();
	const config = readConfig();
	const sessionId = z.uuid().parse(values.session);
	const hours = z.coerce.number().min(0.001).max(24).parse(values.hours);
	const intervalSeconds = z.coerce.number().int().min(5).max(60).parse(values.interval);
	const device = z.string().max(2000).parse(values.device ?? 'Not supplied');
	const url = new URL(values.url ?? `http://127.0.0.1:${config.port}`);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('--url must be an HTTP(S) server origin without credentials, path, query, or fragment.');
	}

	return {
		config, sessionId, hours, intervalSeconds, device, url,
	};
}
