/**
 * Redeploy the Apps Script web app WITHOUT changing its /exec URL.
 *
 * `clasp deploy` always creates a *new* deployment, which means a new
 * `https://script.google.com/macros/s/<ID>/exec` URL every time. Updating the
 * existing deployment instead (`clasp deploy -i <ID>`) keeps the URL stable —
 * and the deployment ID is already sitting in your `.env`:
 *
 *     GAS_API_URL = https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
 *
 * So this script: builds `appscript/Code.js`, pushes it with `clasp push`,
 * extracts `<DEPLOYMENT_ID>` from `GAS_API_URL`, and runs
 * `clasp deploy -i <DEPLOYMENT_ID>` to update that deployment in place.
 *
 * Usage:
 *     bun run gas:deploy                    build + push + redeploy (URL unchanged)
 *     bun scripts/gas-deploy.ts --dry-run   show what would run, touch nothing
 *
 * If `.env` has no GAS_API_URL yet, it falls back to a first-time
 * `clasp deploy` and tells you which URL to save.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const appscriptDir = path.join(root, 'appscript');
const dryRun = process.argv.includes('--dry-run');

function fail(message: string): never {
	console.error(`\ngas:deploy: ${message}`);
	process.exit(1);
}

/** Runs a shell command from the given directory; exits the script if it fails. */
function run(command: string, cwd: string, hint?: string): void {
	const result = spawnSync(command, { shell: true, cwd, stdio: 'inherit' });
	if (result.error) {
		fail(`could not run "${command}": ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`command failed (exit ${result.status}): ${command}${hint ? `\n  hint: ${hint}` : ''}`);
	}
}

/** Reads a single value from .env (first `=`, surrounding quotes stripped). */
function readEnvValue(file: string, key: string): string | null {
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		return null;
	}
	for (const line of raw.split(/\r?\n/)) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (match && match[1] === key) {
			let value = match[2].trim();
			if (
				(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
				(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
			) {
				value = value.slice(1, -1);
			}
			return value.trim() || null;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// 1. Where is the deployment?
// ---------------------------------------------------------------------------

const apiUrl = readEnvValue(path.join(root, '.env'), 'GAS_API_URL');

let deploymentId: string | null = null;
if (apiUrl) {
	if (/\/macros\/s\/[^/]+\/dev\/?\s*$/.test(apiUrl)) {
		fail(
			'GAS_API_URL points at a /dev URL. Put the web-app /exec URL in .env ' +
				'(Deploy → Web app) so this script can update that deployment.'
		);
	}
	const match = /\/macros\/s\/([A-Za-z0-9_-]+)/.exec(apiUrl);
	if (match) {
		deploymentId = match[1];
	}
}

// ---------------------------------------------------------------------------
// 2. Report the plan (dry run) or execute it
// ---------------------------------------------------------------------------

if (dryRun) {
	console.log('gas:deploy dry run — nothing will be executed\n');
	console.log('  build:     bun run gas:build');
	if (deploymentId) {
		console.log(`  GAS_API_URL: found (deployment id: ${deploymentId})`);
		console.log('  command:   clasp push');
		console.log(`  command:   clasp deploy -i ${deploymentId} --description "wiki redeploy"`);
		console.log('  cwd:       appscript/');
		console.log('\nResult: same /exec URL as GAS_API_URL.');
	} else if (apiUrl) {
		console.log(`  GAS_API_URL: set but not parseable: ${apiUrl}`);
		console.log('  command:   (blocked) fix GAS_API_URL first');
	} else {
		console.log('  GAS_API_URL: not found in .env');
		console.log('  command:   clasp push');
		console.log('  command:   clasp deploy   (first deployment — save the printed URL to .env)');
		console.log('  cwd:       appscript/');
	}
	process.exit(0);
}

console.log('gas:deploy: building appscript/Code.js ...');
run('bun run gas:build', root);

console.log('gas:deploy: pushing code to the Apps Script project ...');
run('clasp push', appscriptDir, 'are you logged in? run `clasp login` in appscript/');

if (deploymentId) {
	// Updating the existing deployment keeps the URL identical.
	const command = `clasp deploy -i ${deploymentId} --description "wiki redeploy"`;
	console.log(
		`gas:deploy: redeploying existing deployment ${deploymentId} (URL stays the same) ...`
	);
	run(command, appscriptDir, 'run `clasp list-deployments` in appscript/ to see valid IDs');
	console.log(`\ngas:deploy: done — URL unchanged: ${apiUrl}`);
} else {
	// First deploy: create the deployment and surface the URL to save.
	console.log('gas:deploy: no GAS_API_URL in .env — creating the first deployment ...');
	const result = spawnSync('clasp deploy', {
		shell: true,
		cwd: appscriptDir,
		encoding: 'utf8'
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	process.stdout.write(output);
	if (result.error) {
		fail(`could not run clasp: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`clasp deploy failed (exit ${result.status})`);
	}
	const urlMatch = /https:\/\/script\.google\.com\/macros\/\S+/.exec(output);
	if (urlMatch) {
		console.log(`\ngas:deploy: save this in .env — it is what future redeploys will keep stable:`);
		console.log(`  GAS_API_URL = ${urlMatch[0].replace(/\s+$/, '')}`);
	} else {
		console.log('\ngas:deploy: copy the deployment URL clasp printed into .env as GAS_API_URL.');
	}
}
