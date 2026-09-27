/**
 * Wiki filesystem API — Google Apps Script web app.
 *
 * All content lives inside a single "root" folder in Google Drive; that folder
 * is the wiki's filesystem root. Content is organized per team:
 *
 *   ROOT/KUNAI/*   ROOT/ATLATL/*   ROOT/HUNGA MUNGA/*   ROOT/SLINGSHOT/*
 *
 * Paths without an extension get ".md" appended.
 *
 * Public GET actions (no key required):
 *   ?action=tree[&path=sub/folder]  nested file tree (name/path/id/modifiedTime)
 *   ?action=list[&path=sub/folder]  flat list of files
 *   ?action=read&path=a/b.md        file content + metadata
 *   ?action=ping                    health check
 *
 * POST actions (JSON body; "key" required, in the body or as ?key=):
 *   { "action": "write",  "team": "KUNAI", "path": "a/b", "content": "# hi" }
 *   { "action": "mkdir",  "team": "KUNAI", "path": "a/b" }
 *   { "action": "rename", "team": "KUNAI", "path": "a/b", "newPath": "a/c" }
 *   { "action": "delete", "team": "KUNAI", "path": "a/b" }
 *
 * Every POST requires "team" (KUNAI, ATLATL, HUNGA MUNGA, SLINGSHOT — matching
 * is case-insensitive; kunai/atl/hunga/sling aliases accepted), and "path" is
 * always relative to that team's folder. The full path is reconstructed
 * server-side — team "KUNAI" + "logs/match.md" → ROOT/KUNAI/logs/match.md —
 * so a request can never address another team's folder. mkdir with only a
 * "team" creates the team folder itself (idempotent); delete and rename
 * refuse to target a team's root folder.
 *
 * Script properties (run setup() once from the Apps Script editor):
 *   WIKI_ROOT_FOLDER_ID    root folder id (auto-created and cached if unset)
 *   WIKI_ROOT_FOLDER_NAME  name used when auto-creating the root (default "wiki")
 *   GAS_API_KEY            shared secret required by every POST action; must match
 *                          the site's GAS_API_KEY env var
 *
 * Notes:
 *   - Apps Script always answers HTTP 200; callers must inspect "ok" in the JSON.
 *   - Reads are public because the wiki is public; mutations require the key.
 *   - Deletes move items to the Drive trash (recoverable for ~30 days).
 *   - Call this API from the server (SvelteKit): ContentService cannot send CORS
 *     headers, and the API key must not reach the browser.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT_ID_PROP = 'WIKI_ROOT_FOLDER_ID';
const ROOT_NAME_PROP = 'WIKI_ROOT_FOLDER_NAME';
const API_KEY_PROP = 'GAS_API_KEY';
const ROOT_MARKER = 'wiki-root';
const DEFAULT_ROOT_NAME = 'wiki';
const DEFAULT_EXTENSION = '.md';
const MAX_TREE_DEPTH = 12;

/** Canonical team folders under the root, and the `team` values that map to them. */
const TEAM_NAMES = 'KUNAI, ATLATL, HUNGA MUNGA, SLINGSHOT';
const TEAM_FOLDERS: Record<string, string> = {
	kunai: 'KUNAI',
	atlatl: 'ATLATL',
	atl: 'ATLATL',
	hungamunga: 'HUNGA MUNGA',
	hunga: 'HUNGA MUNGA',
	slingshot: 'SLINGSHOT',
	sling: 'SLINGSHOT'
};

type DriveFile = GoogleAppsScript.Drive.File;
type DriveFolder = GoogleAppsScript.Drive.Folder;
type WebOutput = GoogleAppsScript.Content.TextOutput;

interface TreeNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	id: string;
	modifiedTime: string;
	children?: TreeNode[];
}

type ResolvedItem =
	| { kind: 'file'; file: DriveFile; parent: DriveFolder; path: string }
	| { kind: 'folder'; folder: DriveFolder; parent: DriveFolder; path: string };

type ActionBody = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// GAS web-app entry point (invoked by the Apps Script runtime).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function doGet(e: GoogleAppsScript.Events.DoGet): WebOutput {
	try {
		const action = (e?.parameter?.action ?? 'tree').toLowerCase();
		switch (action) {
			case 'tree':
				return handleTree(e.parameter?.path);
			case 'list':
				return handleList(e.parameter?.path);
			case 'read':
				return handleRead(e.parameter?.path);
			case 'ping':
				return respondOk({ now: new Date().toISOString() });
			default:
				throw new Error(`Unknown action "${action}". Supported: tree, list, read, ping`);
		}
	} catch (err) {
		return respondError(errorMessage(err));
	}
}

// GAS web-app entry point (invoked by the Apps Script runtime).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function doPost(e: GoogleAppsScript.Events.DoPost): WebOutput {
	try {
		const body = parseBody(e);
		const action = (readString(body, 'action') ?? '').toLowerCase();
		if (!action) {
			throw new Error('Missing "action". Supported: write, mkdir, rename, delete');
		}
		requireApiKey(readString(body, 'key'));
		switch (action) {
			case 'write':
				return handleWrite(body);
			case 'mkdir':
				return handleMkdir(body);
			case 'rename':
				return handleRename(body);
			case 'delete':
				return handleDelete(body);
			default:
				throw new Error(`Unknown action "${action}". Supported: write, mkdir, rename, delete`);
		}
	} catch (err) {
		return respondError(errorMessage(err));
	}
}

/**
 * Run once from the Apps Script editor. Creates (or reuses) the root folder and
 * generates the GAS_API_KEY script property if it is not set yet. The value must
 * match the site's .env GAS_API_KEY (the SvelteKit proxy sends it with every
 * POST) — either set the script property to an existing .env value, or copy the
 * logged key into .env. The web-app URL goes into .env as GAS_API_URL.
 */
// Manual setup entry point (run from the Apps Script editor / clasp run).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setup(): void {
	const props = PropertiesService.getScriptProperties();
	const root = getRootFolder();
	let key = props.getProperty(API_KEY_PROP);
	if (!key) {
		key = Utilities.getUuid().replace(/-/g, '');
		props.setProperty(API_KEY_PROP, key);
	}
	// Ensure the per-team folders exist.
	for (const folderName of [...new Set(Object.values(TEAM_FOLDERS))]) {
		walkFoldersOrCreate(root, [folderName]);
	}
	Logger.log('Root folder: %s (%s)', root.getName(), root.getId());
	Logger.log('API key: %s', key);
}

// ---------------------------------------------------------------------------
// GET actions
// ---------------------------------------------------------------------------

function handleTree(rawPath: string | undefined): WebOutput {
	const root = getRootFolder();
	const segments = normalizePath(rawPath);
	const basePath = segments.join('/');
	const start = segments.length > 0 ? walkFolders(root, segments) : root;
	return respondOk({ root: root.getName(), path: basePath, tree: buildTree(start, basePath, 0) });
}

function handleList(rawPath: string | undefined): WebOutput {
	const root = getRootFolder();
	const segments = normalizePath(rawPath);
	const basePath = segments.join('/');
	const start = segments.length > 0 ? walkFolders(root, segments) : root;
	const files = flattenFiles(buildTree(start, basePath, 0));
	return respondOk({ root: root.getName(), path: basePath, files });
}

function handleRead(rawPath: string | undefined): WebOutput {
	const item = resolveItem(rawPath);
	if (item.kind !== 'file') {
		throw new Error(`"${item.path}" is a folder, not a file`);
	}
	const content = item.file.getBlob().getDataAsString('UTF-8');
	return respondOk({
		path: item.path,
		name: item.file.getName(),
		id: item.file.getId(),
		modifiedTime: item.file.getLastUpdated().toISOString(),
		content
	});
}

// ---------------------------------------------------------------------------
// POST actions
// ---------------------------------------------------------------------------

function handleWrite(body: ActionBody): WebOutput {
	const segments = teamPath(body, 'path');
	const content = readString(body, 'content') ?? '';

	const name = withDefaultExtension(segments[segments.length - 1]);
	const parentSegments = segments.slice(0, -1);
	const parent = walkFoldersOrCreate(getRootFolder(), parentSegments);
	const canonicalPath = joinPath(parentSegments.join('/'), name);

	if (findFolder(parent, name)) {
		throw new Error(`Cannot write "${canonicalPath}": a folder with that name exists`);
	}

	let file = findFile(parent, name);
	const created = file === null;
	if (file) {
		file.setContent(content);
	} else {
		file = parent.createFile(name, content);
	}
	return respondOk({ path: canonicalPath, id: file.getId(), created });
}

function handleMkdir(body: ActionBody): WebOutput {
	const segments = teamPath(body, 'path', { allowEmpty: true });
	const name = segments[segments.length - 1];
	const parentSegments = segments.slice(0, -1);
	const parent = walkFoldersOrCreate(getRootFolder(), parentSegments);
	const canonicalPath = joinPath(parentSegments.join('/'), name);

	if (findFile(parent, name)) {
		throw new Error(`Cannot create folder "${canonicalPath}": a file with that name exists`);
	}
	const existing = findFolder(parent, name);
	const folder = existing ?? parent.createFolder(name);
	return respondOk({ path: canonicalPath, id: folder.getId(), created: existing === null });
}

function handleRename(body: ActionBody): WebOutput {
	const fromSegments = teamPath(body, 'path');
	const toSegments = teamPath(body, 'newPath');

	const source = resolveItem(fromSegments.join('/'));
	const targetName =
		source.kind === 'file'
			? withDefaultExtension(toSegments[toSegments.length - 1])
			: toSegments[toSegments.length - 1];
	const targetParentSegments = toSegments.slice(0, -1);
	const targetPath = joinPath(targetParentSegments.join('/'), targetName);

	if (targetPath === source.path) {
		return respondOk({ path: source.path, oldPath: source.path, renamed: false });
	}
	if (source.kind === 'folder' && targetPath.startsWith(source.path + '/')) {
		throw new Error('Cannot move a folder into itself');
	}

	const targetParent = walkFoldersOrCreate(getRootFolder(), targetParentSegments);
	const fileClash = findFile(targetParent, targetName);
	const folderClash = findFolder(targetParent, targetName);

	if (source.kind === 'file') {
		if (fileClash) {
			throw new Error(`Cannot rename: a file already exists at "${targetPath}"`);
		}
		if (folderClash) {
			throw new Error(`Cannot rename: a folder already exists at "${targetPath}"`);
		}
		source.file.setName(targetName);
		if (targetParent.getId() !== source.parent.getId()) {
			source.file.moveTo(targetParent);
		}
	} else {
		if (folderClash) {
			throw new Error(`Cannot rename: a folder already exists at "${targetPath}"`);
		}
		if (fileClash) {
			throw new Error(`Cannot rename: a file already exists at "${targetPath}"`);
		}
		source.folder.setName(targetName);
		if (targetParent.getId() !== source.parent.getId()) {
			source.folder.moveTo(targetParent);
		}
	}
	return respondOk({ path: targetPath, oldPath: source.path, renamed: true });
}

function handleDelete(body: ActionBody): WebOutput {
	const segments = teamPath(body, 'path', { allowEmpty: true });
	if (segments.length === 1) {
		throw new Error(`Cannot delete the team root folder "${segments[0]}"`);
	}
	const item = resolveItem(segments.join('/'));
	if (item.kind === 'file') {
		item.file.setTrashed(true);
	} else {
		trashFolderRecursive(item.folder);
	}
	return respondOk({ path: item.path, kind: item.kind, trashed: true });
}

// ---------------------------------------------------------------------------
// Root folder & path helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the filesystem root folder: uses the cached WIKI_ROOT_FOLDER_ID,
 * otherwise reuses an existing folder marked as the root, otherwise creates one.
 */
function getRootFolder(): DriveFolder {
	const props = PropertiesService.getScriptProperties();
	const cachedId = props.getProperty(ROOT_ID_PROP);
	if (cachedId) {
		try {
			const cached = DriveApp.getFolderById(cachedId);
			if (!cached.isTrashed()) {
				return cached;
			}
		} catch {
			// Folder was permanently deleted; fall through and re-resolve.
		}
	}
	const rootName = props.getProperty(ROOT_NAME_PROP) || DEFAULT_ROOT_NAME;
	const existing = DriveApp.getFoldersByName(rootName);
	while (existing.hasNext()) {
		const folder = existing.next();
		if (folder.isTrashed()) {
			continue;
		}
		if (folder.getDescription() === ROOT_MARKER) {
			props.setProperty(ROOT_ID_PROP, folder.getId());
			return folder;
		}
	}
	const root = DriveApp.createFolder(rootName);
	root.setDescription(ROOT_MARKER);
	props.setProperty(ROOT_ID_PROP, root.getId());
	return root;
}

/** Splits and validates an API path into safe segments. Rejects "..", empty paths return []. */
function normalizePath(rawPath: string | undefined): string[] {
	const segments = (rawPath ?? '')
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0 && segment !== '.');
	for (const segment of segments) {
		if (segment === '..') {
			throw new Error('Path may not contain ".."');
		}
		if (/[<>:"\\|?*]/.test(segment)) {
			throw new Error(`Illegal character in path segment "${segment}"`);
		}
	}
	return segments;
}

/** Maps a POST `team` value to its canonical folder under the root (allowlist). */
function resolveTeamFolder(rawTeam: string | undefined): string {
	if (rawTeam === undefined || rawTeam.trim() === '') {
		throw new Error(`team is required — one of: ${TEAM_NAMES}`);
	}
	const key = rawTeam
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, '');
	const folder = TEAM_FOLDERS[key];
	if (!folder) {
		throw new Error(`Unknown team "${rawTeam}" — expected one of: ${TEAM_NAMES}`);
	}
	return folder;
}

/**
 * Builds the full path for a POST request from `team` plus a field holding the
 * path relative to that team's folder (`path` or `newPath`). The result always
 * starts with the team folder, so requests stay inside their team's subtree.
 */
function teamPath(body: ActionBody, field: string, opts: { allowEmpty?: boolean } = {}): string[] {
	const folder = resolveTeamFolder(readString(body, 'team'));
	const relative = normalizePath(readString(body, field));
	if (relative.length === 0 && !opts.allowEmpty) {
		throw new Error(`${field} is required (relative to the team's folder)`);
	}
	return [folder, ...relative];
}

function joinPath(parentPath: string, name: string): string {
	return parentPath ? `${parentPath}/${name}` : name;
}

function withDefaultExtension(name: string): string {
	return name.includes('.') ? name : name + DEFAULT_EXTENSION;
}

function findFile(parent: DriveFolder, name: string): DriveFile | null {
	const files = parent.getFilesByName(name);
	while (files.hasNext()) {
		const file = files.next();
		if (!file.isTrashed()) {
			return file;
		}
	}
	return null;
}

function findFolder(parent: DriveFolder, name: string): DriveFolder | null {
	const folders = parent.getFoldersByName(name);
	while (folders.hasNext()) {
		const folder = folders.next();
		if (!folder.isTrashed()) {
			return folder;
		}
	}
	return null;
}

/** Walks existing folders from `root`. Throws with a helpful message if a segment is missing or is a file. */
function walkFolders(root: DriveFolder, segments: string[]): DriveFolder {
	let current = root;
	let currentPath = '';
	for (const segment of segments) {
		const next = findFolder(current, segment);
		if (!next) {
			const probe = joinPath(currentPath, segment);
			if (findFile(current, segment)) {
				throw new Error(`"${probe}" is a file, not a folder`);
			}
			throw new Error(`Folder not found: ${probe}`);
		}
		current = next;
		currentPath = joinPath(currentPath, segment);
	}
	return current;
}

/** Like walkFolders, but creates any missing intermediate folders along the way. */
function walkFoldersOrCreate(root: DriveFolder, segments: string[]): DriveFolder {
	let current = root;
	for (const segment of segments) {
		const next = findFolder(current, segment);
		if (next) {
			current = next;
			continue;
		}
		if (findFile(current, segment)) {
			throw new Error(`Cannot create folder "${segment}": a file with that name exists`);
		}
		current = current.createFolder(segment);
	}
	return current;
}

/**
 * Resolves an existing file or folder by path (relative to the root). If the
 * exact name is not found and has no extension, "name.md" is tried as well, so
 * "docs/intro" finds "docs/intro.md".
 */
function resolveItem(rawPath: string | undefined): ResolvedItem {
	const segments = normalizePath(rawPath);
	if (segments.length === 0) {
		throw new Error('path is required');
	}
	const parentSegments = segments.slice(0, -1);
	const parent = walkFolders(getRootFolder(), parentSegments);
	const parentPath = parentSegments.join('/');
	const name = segments[segments.length - 1];

	const folder = findFolder(parent, name);
	if (folder) {
		return { kind: 'folder', folder, parent, path: joinPath(parentPath, name) };
	}
	let file = findFile(parent, name);
	let actualName = name;
	if (!file && !name.includes('.')) {
		file = findFile(parent, name + DEFAULT_EXTENSION);
		actualName = name + DEFAULT_EXTENSION;
	}
	if (file) {
		return { kind: 'file', file, parent, path: joinPath(parentPath, actualName) };
	}
	throw new Error(`Not found: ${segments.join('/')}`);
}

function trashFolderRecursive(folder: DriveFolder): void {
	const files: DriveFile[] = [];
	const fileIterator = folder.getFiles();
	while (fileIterator.hasNext()) {
		files.push(fileIterator.next());
	}
	const folders: DriveFolder[] = [];
	const folderIterator = folder.getFolders();
	while (folderIterator.hasNext()) {
		folders.push(folderIterator.next());
	}
	for (const file of files) {
		file.setTrashed(true);
	}
	for (const child of folders) {
		trashFolderRecursive(child);
	}
	folder.setTrashed(true);
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function buildTree(folder: DriveFolder, parentPath: string, depth: number): TreeNode[] {
	if (depth >= MAX_TREE_DEPTH) {
		return [];
	}
	const nodes: TreeNode[] = [];

	const subfolders = folder.getFolders();
	while (subfolders.hasNext()) {
		const subfolder = subfolders.next();
		if (subfolder.isTrashed()) {
			continue;
		}
		const name = subfolder.getName();
		const path = joinPath(parentPath, name);
		nodes.push({
			name,
			path,
			type: 'folder',
			id: subfolder.getId(),
			modifiedTime: subfolder.getLastUpdated().toISOString(),
			children: buildTree(subfolder, path, depth + 1)
		});
	}

	const files = folder.getFiles();
	while (files.hasNext()) {
		const file = files.next();
		if (file.isTrashed()) {
			continue;
		}
		const name = file.getName();
		nodes.push({
			name,
			path: joinPath(parentPath, name),
			type: 'file',
			id: file.getId(),
			modifiedTime: file.getLastUpdated().toISOString()
		});
	}

	return nodes.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === 'folder' ? -1 : 1;
		}
		return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
	});
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
	const out: TreeNode[] = [];
	for (const node of nodes) {
		if (node.type === 'file') {
			out.push(node);
		} else if (node.children) {
			out.push(...flattenFiles(node.children));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Request parsing & auth
// ---------------------------------------------------------------------------

function parseBody(e: GoogleAppsScript.Events.DoPost): ActionBody {
	const params: ActionBody = { ...(e?.parameter ?? {}) };
	const raw = e?.postData?.contents;
	if (!raw) {
		return params;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Fall back to form-encoded parameters if the body is not JSON.
		if (params.action) {
			return params;
		}
		throw new Error('Body must be valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('Body must be a JSON object');
	}
	return { ...params, ...(parsed as ActionBody) };
}

function requireApiKey(provided: string | undefined): void {
	const expected = PropertiesService.getScriptProperties().getProperty(API_KEY_PROP);
	if (!expected) {
		throw new Error(
			'API key is not configured — set the GAS_API_KEY script property (or run setup())'
		);
	}
	if (!provided || !secureEquals(provided, expected)) {
		throw new Error('Invalid API key');
	}
}

/** Length-checked comparison that does not short-circuit on the first differing character. */
function secureEquals(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

function readString(body: ActionBody, key: string): string | undefined {
	const value = body[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new Error(`"${key}" must be a string`);
	}
	return value;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function jsonResponse(data: Record<string, unknown>): WebOutput {
	return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
		ContentService.MimeType.JSON
	);
}

function respondOk(payload: Record<string, unknown>): WebOutput {
	return jsonResponse({ ok: true, ...payload });
}

function respondError(message: string): WebOutput {
	return jsonResponse({ ok: false, error: message });
}
