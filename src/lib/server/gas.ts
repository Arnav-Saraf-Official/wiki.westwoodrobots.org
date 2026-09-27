/**
 * Server-side client for the Apps Script wiki API (`appscript/Code.ts`).
 *
 * The browser never talks to Apps Script directly: it holds the API key and
 * `ContentService` cannot send CORS headers. Every call goes through here, from
 * server load functions and form actions only.
 *
 * Apps Script always answers HTTP 200, so the JSON `ok` flag is what actually
 * signals success — a non-`ok` body is turned into a {@link GasError}.
 */
import { env } from '$env/dynamic/private';
import type { Team } from '$lib/teams';

export interface GasTreeNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	id: string;
	modifiedTime: string;
	children?: GasTreeNode[];
}

export interface GasFile {
	path: string;
	name: string;
	id: string;
	modifiedTime: string;
	content: string;
	/** Rendered HTML for the file's markdown. Added by this module. */
	html?: string;
}

/** Error raised when Apps Script responds with `{ ok: false }`. */
export class GasError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GasError';
	}
}

function config(): { url: string; key: string } {
	const url = env.GAS_API_URL;
	const key = env.GAS_API_KEY;
	if (!url) {
		throw new GasError('GAS_API_URL is not configured. See .env.example and DOCS.md.');
	}
	if (!key) {
		throw new GasError('GAS_API_KEY is not configured. See .env.example and DOCS.md.');
	}
	return { url, key };
}

function apiUrl(params: Record<string, string | undefined>): string {
	const { url } = config();
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') query.set(key, value);
	}
	return `${url}?${query.toString()}`;
}

async function parse(response: Response): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new GasError(`The wiki API returned a non-JSON response (HTTP ${response.status}).`);
	}
	if (typeof body !== 'object' || body === null) {
		throw new GasError('The wiki API returned an unexpected response shape.');
	}
	const record = body as Record<string, unknown>;
	if (record.ok !== true) {
		const message = typeof record.error === 'string' ? record.error : 'Unknown wiki API error.';
		throw new GasError(message);
	}
	return record;
}

/** Public GET actions: `tree`, `list`, `read`, `ping`. */
export async function gasGet(
	action: 'tree' | 'list' | 'read' | 'ping',
	path?: string
): Promise<Record<string, unknown>> {
	const response = await fetch(apiUrl({ action, path }), { cache: 'no-store' });
	return parse(response);
}

/** Key-protected POST actions. `team` is sent as the canonical folder name. */
export async function gasPost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const { key } = config();
	const response = await fetch(config().url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...body, key }),
		cache: 'no-store'
	});
	return parse(response);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Fetches the whole content tree (folders before files, alphabetical). */
export async function fetchTree(path?: string): Promise<GasTreeNode[]> {
	const data = await gasGet('tree', path);
	return Array.isArray(data.tree) ? (data.tree as GasTreeNode[]) : [];
}

/** Reads a single markdown file. Throws {@link GasError} when it is a folder. */
export async function readFile(path: string): Promise<GasFile> {
	const data = await gasGet('read', path);
	return {
		path: typeof data.path === 'string' ? data.path : path,
		name: typeof data.name === 'string' ? data.name : (path.split('/').pop() ?? path),
		id: typeof data.id === 'string' ? data.id : '',
		modifiedTime: typeof data.modifiedTime === 'string' ? data.modifiedTime : '',
		content: typeof data.content === 'string' ? data.content : ''
	};
}

/** Health check — lets the home page show whether the dynamic wiki is reachable. */
export async function ping(): Promise<boolean> {
	try {
		await gasGet('ping');
		return true;
	} catch {
		return false;
	}
}

/** Finds a node inside a tree by its path (full paths are unique). */
export function findNode(nodes: GasTreeNode[], path: string): GasTreeNode | undefined {
	for (const node of nodes) {
		if (node.path === path) return node;
		if (node.children) {
			const match = findNode(node.children, path);
			if (match) return match;
		}
	}
	return undefined;
}

/** Flattens a tree into just its files, preserving order. */
export function flattenFiles(nodes: GasTreeNode[]): GasTreeNode[] {
	const files: GasTreeNode[] = [];
	for (const node of nodes) {
		if (node.type === 'file') files.push(node);
		else if (node.children) files.push(...flattenFiles(node.children));
	}
	return files;
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

export async function writeFile(team: Team, path: string, content: string): Promise<void> {
	await gasPost({ action: 'write', team: team.folder, path, content });
}

export async function makeFolder(team: Team, path: string): Promise<void> {
	await gasPost({ action: 'mkdir', team: team.folder, path });
}

export async function renameItem(team: Team, path: string, newPath: string): Promise<void> {
	await gasPost({ action: 'rename', team: team.folder, path, newPath });
}

export async function deleteItem(team: Team, path: string): Promise<void> {
	await gasPost({ action: 'delete', team: team.folder, path });
}
