import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {parseArgs, stripVTControlCharacters} from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const {values, positionals} = parseArgs({
	allowPositionals: true,
	options: {
		'data-dir': {type: 'string'}, json: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
	},
});

try {
	if (values.help) {
		console.log('Usage: pnpm session:prompts <SESSION_ID> [--json] [--data-dir PATH]\n\n'
			+ 'Read the saved prompt chain and audio metadata without starting or contacting the server.\n'
			+ 'Uses the repository .env/DATA_DIR by default. --json outputs the complete structured report.\n'
			+ 'Only persisted session/asset data is available, not raw LLM conversation history or rejected audio.');
	} else {
		if (positionals.length !== 1) {
			throw new Error('Supply one session ID. Usage: pnpm session:prompts <SESSION_ID>');
		}

		if (existsSync(path.join(root, '.env'))) {
			process.loadEnvFile(path.join(root, '.env'));
		}

		const directory = path.resolve(root, values['data-dir'] ?? process.env.DATA_DIR ?? 'data');
		const report = readReport(directory, positionals[0]);
		console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
	}
} catch (error) {
	console.error(`Unable to inspect session: ${error.message}`);
	process.exitCode = 1;
}

function readReport(directory, id) {
	const database = path.join(directory, 'soundscapes.sqlite');
	if (!existsSync(database)) {
		throw new Error(`Database not found: ${database}`);
	}

	const db = new DatabaseSync(database, {readOnly: true});
	try {
		// One snapshot keeps pool membership and asset metadata consistent during generation.
		db.exec('BEGIN');
		const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(id);
		if (!row) {
			throw new Error(`Session ${id} not found in ${database}. Stopped sessions may have been removed.`);
		}

		const state = JSON.parse(row.state);
		const groups = state.layered?.layers?.map(layer => ({
			id: layer.policy.id, policy: layer.policy, assetIds: layer.assetIds, clips: layer.clips,
		})) ?? [{id: 'ambience', assetIds: state.assetIds ?? [], clips: state.timeline?.beds ?? []}];
		if (state.scheduledEvents?.length) {
			groups.push({id: 'scheduled-events', assetIds: state.scheduledEvents.map(event => event.assetId), clips: state.scheduledEvents});
		}

		const query = db.prepare('SELECT metadata FROM assets WHERE id = ?');
		return {
			id, database, status: state.status, mode: state.generationMode ?? 'simple', scene: state.scene,
			acoustics: state.layered?.plan?.acoustics,
			groups: groups.map(group => ({
				...group,
				assets: [...new Set(group.assetIds)].map(assetId => {
					const assetRow = query.get(assetId);
					if (!assetRow) {
						return {id: assetId, missingMetadata: true};
					}

					const asset = JSON.parse(assetRow.metadata);
					const absoluteFile = path.resolve(directory, asset.file);
					return {...asset, absoluteFile, fileExists: existsSync(absoluteFile)};
				}),
			})),
		};
	} finally {
		db.close();
	}
}

function formatReport(report) {
	const color = process.stdout.isTTY && !('NO_COLOR' in process.env);
	const clean = value => stripVTControlCharacters(String(value ?? '(not recorded)'));
	const heading = text => color ? `\u001B[1;36m${clean(text)}\u001B[0m` : clean(text);
	const lines = [];
	const paragraph = text => {
		const width = Math.max(40, Math.min(process.stdout.columns ?? 100, 110)) - 4;
		let line = '';
		for (const word of clean(text).split(/\s+/)) {
			if (line && line.length + word.length + 1 > width) {
				lines.push(`    ${line}`);
				line = '';
			}

			line += `${line ? ' ' : ''}${word}`;
		}

		lines.push(`    ${line}`);
	};

	const section = (title, text) => {
		lines.push('', heading(title));
		paragraph(text);
	};

	lines.push(
		heading(`PROMPT CHAIN · ${report.scene?.title ?? report.id}`),
		`Session: ${clean(report.id)}   Mode: ${clean(report.mode)}   Status: ${clean(report.status)}`,
		`Database: ${clean(report.database)}`,
	);
	section('1. YOUR ORIGINAL PROMPT', report.scene?.originalPrompt);
	section('2. PARSED SCENE', report.scene?.description);
	section('   Scene audio caption', report.scene?.audioPrompt);
	section('   Constraints', report.scene?.constraints?.join('; ') || '(none)');
	if (report.acoustics) {
		section('3. SHARED ACOUSTIC CONTEXT', report.acoustics);
	}

	const formatGroup = group => {
		lines.push('', heading(`── ${group.id.toUpperCase()} · ${group.policy?.title ?? 'Audio pool'} · ${group.assets.length} recordings ──`));
		if (group.policy) {
			const {policy} = group;
			paragraph(`${policy.required ? 'Required' : 'Optional'} · ${policy.playback} · gaps ${policy.gapSeconds.minimum}–${policy.gapSeconds.maximum}s`
				+ ` · fade ${policy.fadeSeconds}s · relative gain ${policy.gain}`);
			if (policy.sourceEvidence?.length) {
				section('   Source passages', policy.sourceEvidence.join(' / '));
			}

			section('   Planner’s layer caption', policy.prompt);
		}

		// Variants often share a caption: print it once, but associate every WAV and seed.
		const prompts = new Map();
		for (const asset of group.assets) {
			const prompt = asset.generation?.prompt ?? '(No generation prompt: imported/fixture asset or missing metadata)';
			if (!prompts.has(prompt)) {
				prompts.set(prompt, []);
			}

			prompts.get(prompt).push(asset);
		}

		for (const [index, [prompt, assets]] of [...prompts].entries()) {
			section(`   Exact sound-model prompt ${index + 1} (${assets.length} recording${assets.length === 1 ? '' : 's'})`, prompt);
			for (const asset of assets) {
				lines.push('', `    ${clean(asset.title ?? asset.id)}`, `      ID: ${clean(asset.id)}`);
				if (asset.missingMetadata) {
					lines.push('      MISSING asset metadata');
					continue;
				}

				lines.push(
					`      ${asset.durationMs / 1000}s · seed ${clean(asset.generation?.seed)} · model ${clean(asset.generation?.model ?? asset.source)}`,
					`      WAV${asset.fileExists ? '' : ' (MISSING)'}: ${clean(asset.absoluteFile)}`,
				);
			}
		}
	};

	for (const group of report.groups) {
		formatGroup(group);
	}

	lines.push('', 'Saved metadata snapshot. WAVs are normalized, unmixed recordings.\n'
	+ 'Raw LLM messages and rejected/pre-normalization audio are not retained. Use --json for schedules and full asset metadata.');
	return lines.join('\n');
}
