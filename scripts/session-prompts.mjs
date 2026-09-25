import process from 'node:process';
import {parseArgs, stripVTControlCharacters} from 'node:util';
import {dataDirectory, readReport} from './lib/session-report.mjs';

const {values, positionals} = parseArgs({
	allowPositionals: true,
	options: {
		'data-dir': {type: 'string'}, json: {type: 'boolean'}, latest: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
	},
});

try {
	if (values.help) {
		console.log('Usage: pnpm session:prompts <SESSION_ID|--latest> [--json] [--data-dir PATH]\n\n'
			+ 'Read the saved prompt chain and audio metadata without starting or contacting the server.\n'
			+ '--latest selects the most recently created saved session, not the most recently resumed.\n'
			+ 'Uses the repository .env/DATA_DIR by default. --json outputs the complete structured report.\n'
			+ 'Only persisted session/asset data is available, not raw LLM conversation history or rejected audio.');
	} else {
		if (values.latest ? positionals.length > 0 : positionals.length !== 1) {
			throw new Error('Supply either one session ID or --latest, not both. Usage: pnpm session:prompts <SESSION_ID|--latest>');
		}

		const report = readReport(dataDirectory(values['data-dir']), positionals[0]);
		console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
	}
} catch (error) {
	console.error(`Unable to inspect session: ${error.message}`);
	process.exitCode = 1;
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
		`Play a numbered WAV: pnpm wav:play --session ${clean(report.id)} --wav NUMBER`,
	);
	section('1. YOUR ORIGINAL PROMPT', report.scene?.originalPrompt);
	section('2. PARSED SCENE', report.scene?.description);
	section('   Scene audio caption', report.scene?.audioPrompt);
	section('   Continuous bed caption', report.scene?.ambiencePrompt);
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
				lines.push('', `    [WAV ${clean(asset.wavNumber)}] ${clean(asset.title ?? asset.id)}`, `      ID: ${clean(asset.id)}`);
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
