/**
 * Dynamic wiki viewer — content fetched from the Apps Script API.
 *
 * A path is either a folder (`KUNAI/logs`) or a file (`KUNAI/logs/match.md`).
 * The whole tree is fetched once per request so the sidebar can show every
 * team, then the requested node decides whether we read a file or list a
 * folder. Opening a folder that contains an `index.md` shows that page instead
 * of the selection panel. Anonymous visitors can read everything; only edit
 * actions are gated.
 */
import { canEditPath } from '$lib/server/auth';
import { GasError, fetchTree, findNode, readFile, type GasTreeNode } from '$lib/server/gas';
import {
	extractSummary,
	extractTitle,
	fileLabel,
	isIndexName,
	parseFrontmatter,
	renderMarkdown
} from '$lib/markdown';
import { TEAMS, cleanPath } from '$lib/teams';
import type { PageServerLoad } from './$types';

interface DocLink {
	title: string;
	href: string;
}

function logsHref(path: string): string {
	return `/logs/${path}`;
}

/** Finds the folder that directly contains `path`. */
function findParent(nodes: GasTreeNode[], path: string): GasTreeNode | undefined {
	for (const node of nodes) {
		if (node.children?.some((child) => child.path === path)) return node;
		const match = findParent(node.children ?? [], path);
		if (match) return match;
	}
	return undefined;
}

/** Resolves a frontmatter prev/next value relative to the file's own folder. */
function resolveLink(value: string, base: string): DocLink | null {
	const target = cleanPath(value);
	if (!target) return null;
	const absolute = TEAMS.some((team) => team.folder === target.split('/')[0])
		? target
		: cleanPath(`${base}/${target}`);
	return { title: fileLabel(absolute.split('/').pop() ?? absolute), href: logsHref(absolute) };
}

/** Previous/next pages within the same folder, in tree order (index excluded). */
function neighbors(
	tree: GasTreeNode[],
	path: string
): { prev: DocLink | null; next: DocLink | null } {
	const parent = findParent(tree, path);
	const siblings = (parent?.children ?? []).filter(
		(node) => node.type === 'file' && !isIndexName(node.name)
	);
	const index = siblings.findIndex((node) => node.path === path);
	if (index === -1) return { prev: null, next: null };
	return {
		prev:
			index > 0
				? { title: fileLabel(siblings[index - 1].name), href: logsHref(siblings[index - 1].path) }
				: null,
		next:
			index < siblings.length - 1
				? { title: fileLabel(siblings[index + 1].name), href: logsHref(siblings[index + 1].path) }
				: null
	};
}

async function loadFile(tree: GasTreeNode[], path: string, canEdit: boolean, node?: GasTreeNode) {
	try {
		const file = await readFile(path);
		const { meta } = parseFrontmatter(file.content);
		const base = file.path.split('/').slice(0, -1).join('/');
		const computed = neighbors(tree, file.path);
		return {
			kind: 'file' as const,
			tree,
			canEdit,
			path: file.path,
			title: meta.title?.trim() || extractTitle(file.content) || fileLabel(file.name),
			author: meta.author?.trim() || null,
			summary: extractSummary(file.content),
			modifiedTime: file.modifiedTime,
			prev: meta.prev ? resolveLink(meta.prev, base) : computed.prev,
			next: meta.next ? resolveLink(meta.next, base) : computed.next,
			html: renderMarkdown(file.content)
		};
	} catch (err) {
		if (node?.type === 'folder') {
			return { kind: 'folder' as const, tree, node, canEdit };
		}
		return {
			kind: 'missing' as const,
			tree,
			canEdit,
			error: err instanceof GasError ? err.message : `Nothing found at ${path}.`
		};
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const path = cleanPath(params.path);
	const canEdit = canEditPath(locals.user?.email, path);

	let tree: GasTreeNode[] = [];
	let connectionError: string | null = null;
	try {
		tree = await fetchTree();
	} catch (err) {
		connectionError = err instanceof GasError ? err.message : 'The wiki API is unreachable.';
	}

	if (connectionError) {
		return { kind: 'unavailable' as const, tree, canEdit, error: connectionError, teams: TEAMS };
	}

	if (!path) {
		return { kind: 'root' as const, tree, canEdit, teams: TEAMS };
	}

	const node = findNode(tree, path);
	if (node?.type === 'folder') {
		// A section with an index page shows that page instead of a listing.
		const index = node.children?.find((child) => child.type === 'file' && isIndexName(child.name));
		if (index) return loadFile(tree, index.path, canEdit);
		return { kind: 'folder' as const, tree, node, canEdit };
	}

	return loadFile(tree, path, canEdit, node);
};
