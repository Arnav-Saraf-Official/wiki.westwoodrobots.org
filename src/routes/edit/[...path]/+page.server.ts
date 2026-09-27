/**
 * Wiki editor — protected by the per-team editor lists in `.env`.
 *
 * Load: the signed-in account must be an editor for at least one team; the
 * whole tree is fetched for the sidebar and, when `params.path` names a file,
 * its markdown is loaded into the editor.
 *
 * Actions: save / create / mkdir / rename / delete. Every action re-checks that
 * the account may edit the target team, so the client cannot widen its own
 * permissions.
 */
import { canEditTeam, editableTeams, requireEditor } from '$lib/server/auth';
import {
	GasError,
	deleteItem,
	fetchTree,
	makeFolder,
	readFile,
	renameItem,
	writeFile,
	type GasTreeNode
} from '$lib/server/gas';
import { TEAMS, cleanPath, findTeam, teamForPath, type Team } from '$lib/teams';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** Path segments that Apps Script rejects or that could escape the wiki root. */
const ILLEGAL_SEGMENT = /[<>:"\\|?*]/;

function splitPath(path: string): string[] {
	return cleanPath(path)
		.split('/')
		.filter((segment) => segment.length > 0 && segment !== '.');
}

/** Validates a client-supplied path; returns an error message or null. */
function validatePath(path: string, { allowEmpty = false } = {}): string | null {
	const segments = splitPath(path);
	if (segments.length === 0) {
		return allowEmpty ? null : 'A path is required.';
	}
	for (const segment of segments) {
		if (segment === '..') return 'Paths may not contain "..".';
		if (ILLEGAL_SEGMENT.test(segment)) return `"${segment}" contains illegal characters.`;
	}
	return null;
}

/** Resolves `path` to its team plus the path relative to that team's folder. */
function resolveTeamPath(path: string): { team: Team; relative: string } | { error: string } {
	const team = teamForPath(path);
	if (!team) return { error: 'The path must start with a team folder.' };
	const segments = splitPath(path);
	return { team, relative: segments.slice(1).join('/') };
}

function message(err: unknown, fallback: string): string {
	return err instanceof GasError ? err.message : fallback;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const user = requireEditor(locals.user, url.pathname + url.search);
	const teams = editableTeams(user.email);
	const path = cleanPath(params.path);

	let tree: GasTreeNode[] = [];
	let apiError: string | null = null;
	try {
		tree = await fetchTree();
	} catch (err) {
		apiError = message(err, 'The wiki API is unreachable.');
	}

	let file: { path: string; name: string; content: string; modifiedTime: string } | null = null;
	if (path && validatePath(path) === null) {
		try {
			const loaded = await readFile(path);
			file = {
				path: loaded.path,
				name: loaded.name,
				content: loaded.content,
				modifiedTime: loaded.modifiedTime
			};
		} catch {
			// Not a file (probably a folder) — the tree below still renders.
		}
	}

	const currentTeam = teamForPath(path) ?? teams[0] ?? TEAMS[0];
	const canEditCurrent = path ? canEditTeam(user.email, currentTeam) : false;

	return {
		user,
		teams,
		teamFolders: TEAMS,
		tree,
		path,
		file,
		currentTeamId: currentTeam.id,
		canEditCurrent,
		apiError
	};
};

export const actions: Actions = {
	/** Overwrite an existing file. */
	save: async ({ request, locals, url }) => {
		const user = requireEditor(locals.user, url.pathname + url.search);
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const content = String(form.get('content') ?? '');

		const pathError = validatePath(path);
		if (pathError) return fail(400, { error: pathError });

		const resolved = resolveTeamPath(path);
		if ('error' in resolved) return fail(400, { error: resolved.error });
		if (!canEditTeam(user.email, resolved.team)) {
			return fail(403, { error: `You are not authorized to edit ${resolved.team.label}.` });
		}
		if (!resolved.relative) {
			return fail(400, { error: 'A file path is required.' });
		}

		try {
			await writeFile(resolved.team, resolved.relative, content);
		} catch (err) {
			return fail(502, { error: message(err, 'Could not save the file.') });
		}
		return { success: true, message: `Saved ${path}` };
	},

	/** Create a new file (markdown). */
	create: async ({ request, locals, url }) => {
		const user = requireEditor(locals.user, url.pathname + url.search);
		const form = await request.formData();
		const teamValue = String(form.get('team') ?? '');
		const folder = cleanPath(String(form.get('folder') ?? ''));
		const name = String(form.get('name') ?? '').trim();
		const content = String(form.get('content') ?? '');

		const team = findTeam(teamValue);
		if (!team) return fail(400, { error: `Unknown team "${teamValue}".` });
		if (!canEditTeam(user.email, team)) {
			return fail(403, { error: `You are not authorized to edit ${team.label}.` });
		}
		if (!name) return fail(400, { error: 'A name is required.' });
		const relative = folder ? `${folder}/${name}` : name;
		const pathError = validatePath(relative);
		if (pathError) return fail(400, { error: pathError });

		try {
			await writeFile(team, relative, content);
		} catch (err) {
			return fail(502, { error: message(err, 'Could not create the file.') });
		}
		redirect(303, `/edit/${team.folder}/${relative}`.replace(/\/+/g, '/'));
	},

	/** Create a new folder. */
	mkdir: async ({ request, locals, url }) => {
		const user = requireEditor(locals.user, url.pathname + url.search);
		const form = await request.formData();
		const teamValue = String(form.get('team') ?? '');
		const folder = cleanPath(String(form.get('folder') ?? ''));
		const name = String(form.get('name') ?? '').trim();

		const team = findTeam(teamValue);
		if (!team) return fail(400, { error: `Unknown team "${teamValue}".` });
		if (!canEditTeam(user.email, team)) {
			return fail(403, { error: `You are not authorized to edit ${team.label}.` });
		}
		if (!name) return fail(400, { error: 'A folder name is required.' });
		const relative = folder ? `${folder}/${name}` : name;
		const pathError = validatePath(relative);
		if (pathError) return fail(400, { error: pathError });

		try {
			await makeFolder(team, relative);
		} catch (err) {
			return fail(502, { error: message(err, 'Could not create the folder.') });
		}
		redirect(303, `/edit/${team.folder}/${relative}`.replace(/\/+/g, '/'));
	},

	/** Rename or move a file/folder within its team. */
	rename: async ({ request, locals, url }) => {
		const user = requireEditor(locals.user, url.pathname + url.search);
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const newPath = cleanPath(String(form.get('newPath') ?? ''));

		const pathError = validatePath(path);
		if (pathError) return fail(400, { error: pathError });
		const resolved = resolveTeamPath(path);
		if ('error' in resolved) return fail(400, { error: resolved.error });
		if (!canEditTeam(user.email, resolved.team)) {
			return fail(403, { error: `You are not authorized to edit ${resolved.team.label}.` });
		}

		// The new path may be given relative to the team (preferred) or absolute.
		const newPathError = validatePath(newPath);
		if (newPathError) return fail(400, { error: newPathError });
		const target = newPath.startsWith(resolved.team.folder)
			? resolveTeamPath(newPath)
			: { team: resolved.team, relative: newPath };
		if ('error' in target) return fail(400, { error: target.error });
		if (target.team.id !== resolved.team.id) {
			return fail(400, { error: 'A file cannot be moved to another team.' });
		}
		if (!target.relative || !resolved.relative) {
			return fail(400, { error: 'Renaming the team folder itself is not allowed.' });
		}

		try {
			await renameItem(resolved.team, resolved.relative, target.relative);
		} catch (err) {
			return fail(502, { error: message(err, 'Could not rename the item.') });
		}
		redirect(303, `/edit/${resolved.team.folder}/${target.relative}`.replace(/\/+/g, '/'));
	},

	/** Move an item to the Drive trash (recoverable for ~30 days). */
	delete: async ({ request, locals, url }) => {
		const user = requireEditor(locals.user, url.pathname + url.search);
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		const pathError = validatePath(path, { allowEmpty: true });
		if (pathError) return fail(400, { error: pathError });
		const resolved = resolveTeamPath(path);
		if ('error' in resolved) return fail(400, { error: resolved.error });
		if (!canEditTeam(user.email, resolved.team)) {
			return fail(403, { error: `You are not authorized to edit ${resolved.team.label}.` });
		}
		if (!resolved.relative) {
			return fail(400, { error: 'The team folder itself cannot be deleted.' });
		}

		try {
			await deleteItem(resolved.team, resolved.relative);
		} catch (err) {
			return fail(502, { error: message(err, 'Could not delete the item.') });
		}
		redirect(303, `/edit/${resolved.team.folder}`.replace(/\/+/g, '/'));
	}
};
