<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { fileLabel, parseFrontmatter, renderMarkdown } from '$lib/markdown';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import type { GasTreeNode } from '$lib/server/gas';
	import { pageTitle } from '$lib/site';
	import type { PageData } from './$types';
	import { onMount, tick } from 'svelte';
	import {
		ChevronRight,
		CircleHelp,
		Code,
		FilePlus2,
		FileText,
		FolderPlus,
		Folder,
		List,
		ListOrdered,
		Pencil,
		Link2,
		Quote,
		SquareChevronRight,
		Trash2,
		X
	} from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	/** Content of a brand-new page, offered as the starting point. */
	const NEW_PAGE_TEMPLATE = '---\ntitle: New page\n---\n\n# New page\n\n';

	// --- Drafts -------------------------------------------------------------
	// Edits are held locally (and mirrored to localStorage) until the writer
	// explicitly saves; only then are they pushed to the wiki API.
	let edits = $state<Record<string, string>>({});
	let storageKey = $derived(`wiki:edit:drafts:${data.user.email}`);
	let imageStorageKey = $derived(`wiki:edit:images:${data.user.email}`);
	/**
	 * Data URLs for images pasted into (or embedded in) the document. The body
	 * only carries a short `image:<id>` token; the bytes live here and are
	 * expanded back to `data:image/...` markdown for preview and save.
	 */
	let pastedImages = $state<Record<string, string>>({});

	let filePath = $derived(data.file?.path ?? '');
	let draft = $derived(edits[filePath] ?? data.file?.content ?? '');
	let mode = $state<'write' | 'preview'>('write');
	let previewHtml = $derived(renderMarkdown(expandImages(draft)));
	let dirty = $derived(!!data.file && expandImages(draft) !== data.file.content);
	let tabTitle = $derived.by(() => {
		const file = data.file;
		if (!file) return pageTitle('Editor');
		const title = parseFrontmatter(draft).meta.title;
		const label = typeof title === 'string' && title.trim() ? title.trim() : fileLabel(file.name);
		return pageTitle(label);
	});

	// --- Writing guide ------------------------------------------------------
	let helpOpen = $state(false);
	let helpEl = $state<HTMLDivElement | null>(null);

	async function openHelp() {
		helpOpen = true;
		await tick();
		helpEl?.focus();
	}

	// While the guide is open, close it on Escape and freeze the page behind it.
	$effect(() => {
		if (!helpOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') helpOpen = false;
		};
		window.addEventListener('keydown', onKeydown);
		return () => {
			window.removeEventListener('keydown', onKeydown);
			document.body.style.overflow = previousOverflow;
		};
	});

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	function persistNow() {
		if (!browser) return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(edits));
			localStorage.setItem(imageStorageKey, JSON.stringify(pastedImages));
		} catch {
			// Storage full or blocked — drafts simply won't survive a reload.
		}
	}
	function persistSoon() {
		if (!browser) return;
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(persistNow, 250);
	}
	function setDraft(value: string) {
		if (!data.file) return;
		edits[filePath] = value;
		persistSoon();
	}
	function clearDraft(path: string) {
		if (path in edits) {
			delete edits[path];
			persistNow();
		}
	}

	/** Set once storage has been read, so the collapse effect below can wait for it. */
	let hydrated = $state(false);

	onMount(() => {
		try {
			// Load stored images first so migrated drafts can reuse their ids.
			const rawImages = localStorage.getItem(imageStorageKey);
			if (rawImages) {
				pastedImages = {
					...(JSON.parse(rawImages) as Record<string, string>),
					...pastedImages
				};
			}
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const stored = JSON.parse(raw) as Record<string, string>;
				// Older drafts may still hold raw base64; swap those for tokens too.
				for (const [path, value] of Object.entries(stored)) {
					const result = collapseImages(value);
					if (result.content !== value) {
						pastedImages = { ...pastedImages, ...result.images };
						stored[path] = result.content;
					}
				}
				edits = { ...stored, ...edits };
			}
		} catch {
			// Malformed storage — start clean.
		}
		hydrated = true;
	});

	// Files saved before this feature store images as full `data:` URLs. Collapse
	// them into tokens the first time a file is opened, so the textarea stays
	// readable without touching what actually gets saved.
	$effect(() => {
		if (!hydrated) return;
		const file = data.file;
		if (!file || edits[file.path] !== undefined) return;
		const result = collapseImages(file.content);
		if (result.content === file.content) return;
		pastedImages = { ...pastedImages, ...result.images };
		edits[file.path] = result.content;
		persistSoon();
	});

	// --- Notices / pending --------------------------------------------------
	let notice = $state<{ type: 'ok' | 'error'; text: string } | null>(null);
	let saving = $state(false);

	/** How long a success toast lingers before dismissing itself. */
	const NOTICE_TIMEOUT = 5000;

	// Success toasts clear themselves; errors stay until dismissed by hand.
	$effect(() => {
		if (notice?.type !== 'ok') return;
		const timer = setTimeout(() => (notice = null), NOTICE_TIMEOUT);
		return () => clearTimeout(timer);
	});

	// --- Explorer state -----------------------------------------------------
	let expanded = $state<Record<string, boolean>>({});
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	let creating = $state<'file' | 'folder' | null>(null);
	let createName = $state('');
	let deleteTarget = $state('');
	let deleteForm = $state<HTMLFormElement | null>(null);
	let renameInput = $state<HTMLInputElement | null>(null);
	let createInput = $state<HTMLInputElement | null>(null);

	let editableTree = $derived(
		data.tree.filter((node) => data.teams.some((team) => team.folder === node.name))
	);

	/** Folder (relative to its team) that new items default into. */
	let relativeFolder = $derived.by(() => {
		if (!data.path) return '';
		const segments = data.path.split('/').slice(1);
		const folderSegments = data.file ? segments.slice(0, -1) : segments;
		return folderSegments.join('/');
	});

	/** Absolute folder shown in the explorer header. */
	let targetFolder = $derived.by(() => {
		const team = data.teamFolders.find((candidate) => candidate.id === data.currentTeamId);
		const base = team?.folder ?? '';
		return relativeFolder ? `${base}/${relativeFolder}` : base;
	});

	// On navigation: open the ancestors of the selected path and leave preview.
	$effect(() => {
		const path = data.path;
		mode = 'write';
		if (!path) return;
		const segments = path.split('/');
		for (let i = 1; i <= segments.length; i++) {
			expanded[segments.slice(0, i).join('/')] = true;
		}
	});

	function toggleFolder(path: string) {
		expanded[path] = !expanded[path];
	}

	function isCurrent(path: string): boolean {
		return (page.params.path ?? '') === path;
	}

	async function startCreate(kind: 'file' | 'folder') {
		renaming = null;
		creating = kind;
		createName = '';
		await tick();
		createInput?.focus();
	}

	async function startRename(node: GasTreeNode) {
		creating = null;
		renaming = node.path;
		renameValue = node.path.split('/').slice(1).join('/');
		await tick();
		renameInput?.focus();
		renameInput?.select();
	}

	async function confirmDelete(node: GasTreeNode) {
		const label = node.type === 'folder' ? node.name : node.name.replace(/\.md$/i, '');
		if (!confirm(`Move "${label}" to the Drive trash?`)) return;
		deleteTarget = node.path;
		await tick();
		deleteForm?.requestSubmit();
	}

	// --- Form plumbing ------------------------------------------------------
	function handleResult(result: ActionResult, clearDraftOnSuccess: boolean) {
		if (result.type === 'failure') {
			const payload = result.data as Record<string, unknown> | undefined;
			notice = {
				type: 'error',
				text: String(payload?.error ?? 'That action could not be completed.')
			};
		} else if (result.type === 'error') {
			notice = { type: 'error', text: result.error?.message ?? 'The request failed.' };
		} else if (result.type === 'success') {
			const payload = result.data as Record<string, unknown> | undefined;
			if (typeof payload?.message === 'string') notice = { type: 'ok', text: payload.message };
			if (clearDraftOnSuccess && data.file) clearDraft(data.file.path);
			creating = null;
			renaming = null;
		} else if (result.type === 'redirect') {
			// create / mkdir / rename / delete navigate on success.
			creating = null;
			renaming = null;
		}
	}

	function submit(
		setPending?: (value: boolean) => void,
		opts: { clearDraft?: boolean; expandContent?: boolean } = {}
	): SubmitFunction {
		return ({ formData }) => {
			// The textarea holds image tokens; send the stored base64 instead.
			if (opts.expandContent) formData.set('content', expandImages(draft));
			notice = null;
			setPending?.(true);
			return async ({ result, update }) => {
				setPending?.(false);
				// Refresh data first so clearing a draft falls back to the saved content.
				await update();
				handleResult(result, opts.clearDraft ?? false);
			};
		};
	}

	// --- Markdown toolbar ---------------------------------------------------
	function restoreSelection(start: number, end: number) {
		void tick().then(() => {
			textareaEl?.focus();
			textareaEl?.setSelectionRange(start, end);
		});
	}

	/** Wraps (or unwraps) the selection in inline markers. */
	function toggleWrap(before: string, after: string, placeholder: string) {
		const el = textareaEl;
		if (!el || !data.file) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		const selected = value.slice(start, end);
		const wrapped =
			start >= before.length &&
			value.slice(start - before.length, start) === before &&
			value.slice(end, end + after.length) === after;
		if (wrapped) {
			setDraft(value.slice(0, start - before.length) + selected + value.slice(end + after.length));
			restoreSelection(start - before.length, start - before.length + selected.length);
			return;
		}
		const inner = selected || placeholder;
		setDraft(value.slice(0, start) + before + inner + after + value.slice(end));
		restoreSelection(start + before.length, start + before.length + inner.length);
	}

	type PrefixKind = 'heading' | 'bullet' | 'ordered' | 'quote';
	const STRIP_PREFIX = /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/;

	function hasPrefix(line: string, kind: PrefixKind, prefix: string): boolean {
		switch (kind) {
			case 'heading':
				return line.startsWith(prefix);
			case 'bullet':
				return /^[-*+]\s+/.test(line);
			case 'ordered':
				return /^\d+[.)]\s+/.test(line);
			case 'quote':
				return /^>\s+/.test(line);
		}
	}

	/** Adds (or removes) a block prefix on every line the selection touches. */
	function setLinePrefix(prefix: string, kind: PrefixKind) {
		const el = textareaEl;
		if (!el || !data.file) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		const lineStart = value.lastIndexOf('\n', start - 1) + 1;
		const found = value.indexOf('\n', end);
		const lineEnd = found === -1 ? value.length : found;
		const lines = value.slice(lineStart, lineEnd).split('\n');
		const allPrefixed = lines.length > 0 && lines.every((line) => hasPrefix(line, kind, prefix));
		const nextLines = lines.map((line, index) => {
			const bare = line.replace(STRIP_PREFIX, '');
			if (allPrefixed) return bare;
			return kind === 'ordered' ? `${index + 1}. ${bare}` : prefix + bare;
		});
		const replacement = nextLines.join('\n');
		setDraft(value.slice(0, lineStart) + replacement + value.slice(lineEnd));
		restoreSelection(lineStart, lineStart + replacement.length);
	}

	let heading = $state('');
	function applyHeading() {
		const prefix = heading;
		heading = '';
		if (prefix) setLinePrefix(prefix, 'heading');
	}

	function insertCodeBlock() {
		const el = textareaEl;
		if (!el || !data.file) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		const selected = value.slice(start, end) || 'code';
		const lead = start === 0 || value[start - 1] === '\n' ? '' : '\n';
		const tail = end === value.length || value[end] === '\n' ? '' : '\n';
		const block = `${lead}\`\`\`\n${selected}\n\`\`\`${tail}`;
		setDraft(value.slice(0, start) + block + value.slice(end));
		const offset = lead.length + 4;
		restoreSelection(start + offset, start + offset + selected.length);
	}

	function insertLink() {
		const el = textareaEl;
		if (!el || !data.file) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		const selected = value.slice(start, end);
		if (selected) {
			setDraft(value.slice(0, start) + `[${selected}](url)` + value.slice(end));
			const urlStart = start + selected.length + 3;
			restoreSelection(urlStart, urlStart + 3);
		} else {
			setDraft(value.slice(0, start) + '[text](url)' + value.slice(end));
			restoreSelection(start + 1, start + 5);
		}
	}

	function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	/**
	 * Pastes an image as a short `image:<id>` token while keeping the bytes in
	 * `pastedImages`; the token expands back to an inline `data:` URL on save.
	 */
	async function onEditorPaste(event: ClipboardEvent) {
		const el = textareaEl;
		if (!el || !data.file) return;
		const items = event.clipboardData?.items;
		if (!items) return;
		const image = Array.from(items).find((item) => item.type.startsWith('image/'));
		if (!image) return;
		const file = image.getAsFile();
		if (!file) return;
		event.preventDefault();
		let dataUrl: string;
		try {
			dataUrl = await readFileAsDataUrl(file);
		} catch {
			notice = { type: 'error', text: 'That image could not be read.' };
			return;
		}
		// Identical bytes reuse a single stored image, so repeat pastes share a token.
		const existingId = imageIdFor(dataUrl);
		const id = existingId ?? newImageId();
		if (!existingId) pastedImages = { ...pastedImages, [id]: dataUrl };
		const name = file.name ? file.name.replace(/\.[^.]+$/, '') : 'pasted image';
		const snippet = `![${name}](image:${id})`;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		setDraft(value.slice(0, start) + snippet + value.slice(end));
		restoreSelection(start + snippet.length, start + snippet.length);
		persistSoon();
	}

	// --- Inline images ------------------------------------------------------
	// The editor never shows a raw base64 blob: pasted (and previously saved)
	// images are referenced by a short token and displayed in a thumbnail strip.

	/** Raster formats only, matching the renderer's allow-list. */
	const DATA_IMAGE_RE =
		/!\[([^\]]*)\]\((data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+)\)/g;
	const IMAGE_TOKEN_RE = /!\[([^\]]*)\]\(image:([A-Za-z0-9-]+)\)/g;

	let imageSeq = 0;
	function newImageId(): string {
		imageSeq += 1;
		return `${Date.now().toString(36)}-${imageSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	/** Id of an already-stored image with identical bytes, or null if it's new. */
	function imageIdFor(url: string): string | null {
		const existing = Object.entries(pastedImages).find(([, value]) => value === url);
		return existing ? existing[0] : null;
	}

	/** Replaces embedded `data:` images with `image:<id>` tokens, reusing ids for
	 * any bytes already stored, so one image is kept once no matter how often it
	 * appears. */
	function collapseImages(content: string): { content: string; images: Record<string, string> } {
		const images: Record<string, string> = {};
		const collapsed = content.replace(DATA_IMAGE_RE, (_match, alt: string, url: string) => {
			const seen =
				Object.entries(images).find(([, value]) => value === url)?.[0] ?? imageIdFor(url);
			if (seen) return `![${alt}](image:${seen})`;
			const id = newImageId();
			images[id] = url;
			return `![${alt}](image:${id})`;
		});
		return { content: collapsed, images };
	}

	/** Expands `image:<id>` tokens back into the base64 markdown that gets stored. */
	function expandImages(content: string): string {
		return content.replace(IMAGE_TOKEN_RE, (match, alt: string, id: string) => {
			const url = pastedImages[id];
			return url ? `![${alt}](${url})` : match;
		});
	}

	/** Images the current draft references, for the thumbnail strip. */
	let draftImages = $derived.by(() => {
		const found: { id: string; alt: string; url: string }[] = [];
		const seen: string[] = [];
		for (const match of draft.matchAll(IMAGE_TOKEN_RE)) {
			const id = match[2];
			const url = pastedImages[id];
			if (!url || seen.includes(id)) continue;
			seen.push(id);
			found.push({ id, alt: match[1] || 'pasted image', url });
		}
		return found;
	});

	/** Puts the caret on an image's token so the source shows where it sits. */
	function revealImage(id: string) {
		const match = new RegExp(`!\\[[^\\]]*\\]\\(image:${id}\\)`).exec(draft);
		if (!match) return;
		mode = 'write';
		restoreSelection(match.index, match.index + match[0].length);
	}

	/** Removes every token for an image and drops its bytes once nothing uses it. */
	function removeImage(id: string) {
		const next = draft.replace(new RegExp(`!\\[[^\\]]*\\]\\(image:${id}\\)\\n?`, 'g'), '');
		setDraft(next);
		// The image is shared across documents, so keep the bytes while any other
		// draft still points at them.
		const stillUsed = Object.values({ ...edits, [filePath]: next }).some((value) =>
			value.includes(`image:${id})`)
		);
		if (!stillUsed) {
			const map = { ...pastedImages };
			delete map[id];
			pastedImages = map;
		}
		persistSoon();
	}

	function onEditorKeydown(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey)) return;
		const key = event.key.toLowerCase();
		if (key === 'b') {
			event.preventDefault();
			toggleWrap('**', '**', 'bold text');
		} else if (key === 'i') {
			event.preventDefault();
			toggleWrap('*', '*', 'italic text');
		} else if (key === 'k') {
			event.preventDefault();
			insertLink();
		}
	}
</script>

{#snippet toolIcon(name: string)}
	{#if name === 'bullets'}
		<List size={16} strokeWidth={1.7} aria-hidden="true" />
	{:else if name === 'numbers'}
		<ListOrdered size={16} strokeWidth={1.7} aria-hidden="true" />
	{:else if name === 'quote'}
		<Quote size={16} strokeWidth={1.7} aria-hidden="true" />
	{:else if name === 'code'}
		<Code size={16} strokeWidth={1.7} aria-hidden="true" />
	{:else if name === 'codeblock'}
		<SquareChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
	{:else if name === 'link'}
		<Link2 size={16} strokeWidth={1.7} aria-hidden="true" />
	{/if}
{/snippet}

{#snippet glyph(kind: 'folder' | 'file')}
	{#if kind === 'folder'}
		<Folder size={15} strokeWidth={1.6} aria-hidden="true" />
	{:else}
		<FileText size={15} strokeWidth={1.6} aria-hidden="true" />
	{/if}
{/snippet}

{#snippet treeNodes(nodes: GasTreeNode[])}
	<div class="tree">
		{#each nodes as node (node.path)}
			{#if renaming === node.path}
				<form class="tree-rename" method="POST" action="?/rename" use:enhance={submit()}>
					<input type="hidden" name="path" value={node.path} />
					<input
						class="field explorer__input"
						name="newPath"
						bind:value={renameValue}
						bind:this={renameInput}
						onkeydown={(event) => {
							if (event.key === 'Escape') renaming = null;
							if (event.key === 'Enter') {
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}
						}}
					/>
				</form>
			{:else}
				<div class="tree-row" class:is-active={isCurrent(node.path)}>
					{#if node.type === 'folder'}
						<button
							type="button"
							class="tree-twisty"
							class:is-open={expanded[node.path]}
							aria-label={expanded[node.path] ? 'Collapse folder' : 'Expand folder'}
							aria-expanded={!!expanded[node.path]}
							onclick={() => toggleFolder(node.path)}
						>
							<ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
						</button>
					{:else}
						<span class="tree-twisty is-leaf"></span>
					{/if}

					<a
						class="tree-name"
						href={resolve('/edit/[...path]', { path: node.path })}
						aria-current={isCurrent(node.path) ? 'page' : undefined}
						title={node.path}
					>
						<span class="tree-glyph" class:is-folder={node.type === 'folder'}>
							{@render glyph(node.type)}
						</span>
						<span class="tree-label">
							{node.type === 'folder' ? node.name : node.name.replace(/\.md$/i, '')}
						</span>
					</a>

					<span class="tree-actions">
						<button
							type="button"
							class="iconbtn"
							title="Rename"
							aria-label={`Rename ${node.name}`}
							onclick={() => startRename(node)}
						>
							<Pencil size={15} strokeWidth={1.6} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="iconbtn"
							title="Delete"
							aria-label={`Delete ${node.name}`}
							onclick={() => confirmDelete(node)}
						>
							<Trash2 size={15} strokeWidth={1.6} aria-hidden="true" />
						</button>
					</span>
				</div>
			{/if}

			{#if node.type === 'folder' && expanded[node.path]}
				<div class="tree-children">{@render treeNodes(node.children ?? [])}</div>
			{/if}
		{/each}
	</div>
{/snippet}

<svelte:head>
	<title>{tabTitle}</title>
</svelte:head>

<div class="page page-editor">
	<div class="editor-shell">
		<aside class="explorer">
			<div class="explorer__head">
				<span class="explorer__title" title={targetFolder}>{targetFolder || 'Explorer'}</span>
				<div class="explorer__actions">
					<button
						type="button"
						class="iconbtn"
						title="New file"
						aria-label="New file"
						disabled={!data.path}
						onclick={() => startCreate('file')}
					>
						<FilePlus2 size={15} strokeWidth={1.6} aria-hidden="true" />
					</button>
					<button
						type="button"
						class="iconbtn"
						title="New section"
						aria-label="New section"
						disabled={!data.path}
						onclick={() => startCreate('folder')}
					>
						<FolderPlus size={15} strokeWidth={1.6} aria-hidden="true" />
					</button>
				</div>
			</div>

			{#if creating}
				<form
					class="explorer__new"
					method="POST"
					action={creating === 'file' ? '?/create' : '?/mkdir'}
					use:enhance={submit()}
				>
					<input type="hidden" name="team" value={data.currentTeamId} />
					<input type="hidden" name="folder" value={relativeFolder} />
					{#if creating === 'file'}
						<input type="hidden" name="content" value={NEW_PAGE_TEMPLATE} />
					{/if}
					<input
						class="field explorer__input"
						name="name"
						bind:value={createName}
						bind:this={createInput}
						placeholder={creating === 'file' ? 'New file name' : 'New section name'}
						onkeydown={(event) => {
							if (event.key === 'Escape') creating = null;
							if (event.key === 'Enter') {
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}
						}}
					/>
				</form>
			{/if}

			{#if data.apiError}
				<p class="explorer__note">{data.apiError}</p>
			{:else if editableTree.length === 0}
				<p class="explorer__note">You do not have an editable team.</p>
			{:else}
				{@render treeNodes(editableTree)}
			{/if}
		</aside>

		<section class="editor-pane">
			{#if notice}
				{#key notice}
					<div
						class="editor-toast message {notice.type === 'error' ? 'message-error' : 'message-ok'}"
					>
						<div class="editor-toast__row">
							<span class="editor-toast__text" role="status">{notice.text}</span>
							<button
								type="button"
								class="editor-toast__close"
								aria-label="Dismiss notification"
								onclick={() => (notice = null)}
							>
								<X size={14} strokeWidth={1.8} aria-hidden="true" />
							</button>
						</div>
						{#if notice.type === 'ok'}
							<span class="editor-toast__bar" aria-hidden="true"></span>
						{/if}
					</div>
				{/key}
			{/if}

			{#if data.file}
				<form
					class="editor-form"
					method="POST"
					action="?/save"
					use:enhance={submit((value) => (saving = value), {
						clearDraft: true,
						expandContent: true
					})}
				>
					<input type="hidden" name="path" value={data.file.path} />

					<div class="editor-tabs">
						<div class="editor-tab">
							<span class="tree-glyph">{@render glyph('file')}</span>
							<span class="tree-label">{data.file.name.replace(/\.md$/i, '')}</span>
							{#if dirty}
								<span class="editor-tab__dirty" title="Unsaved changes"></span>
							{/if}
						</div>
						<div class="editor-tabs__actions">
							<button
								type="button"
								class="btn btn-ghost btn-sm help-btn"
								title="Writing guide"
								aria-haspopup="dialog"
								aria-expanded={helpOpen}
								onclick={openHelp}
							>
							<CircleHelp size={15} strokeWidth={1.7} aria-hidden="true" />
							Help
							</button>
							<a
								href={resolve('/logs/[...path]', { path: data.file.path })}
								class="btn btn-ghost btn-sm">View</a
							>
							<div class="segmented" style="--segments: 2; --index: {mode === 'write' ? 0 : 1}">
								<span class="segmented-thumb" aria-hidden="true"></span>
								<button
									type="button"
									aria-pressed={mode === 'write'}
									onclick={() => (mode = 'write')}
								>
									Write
								</button>
								<button
									type="button"
									aria-pressed={mode === 'preview'}
									onclick={() => (mode = 'preview')}
								>
									Preview
								</button>
							</div>
							<button type="submit" class="btn btn-primary btn-sm" disabled={saving}>
								{#if saving}<span class="spinner"></span>{/if}
								{saving ? 'Saving…' : 'Save'}
							</button>
						</div>
					</div>

					<div class="editor-toolbar" class:is-hidden={mode === 'preview'}>
						<select
							class="tool-select"
							bind:value={heading}
							onchange={applyHeading}
							title="Paragraph style"
							aria-label="Paragraph style"
						>
							<option value="">Paragraph</option>
							<option value="# ">Heading 1</option>
							<option value="## ">Heading 2</option>
							<option value="### ">Heading 3</option>
						</select>
						<span class="tool-sep"></span>
						<button
							type="button"
							class="tool-btn"
							title="Bold (Ctrl+B)"
							aria-label="Bold"
							onclick={() => toggleWrap('**', '**', 'bold text')}
						>
							<span class="tool-glyph is-bold">B</span>
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Italic (Ctrl+I)"
							aria-label="Italic"
							onclick={() => toggleWrap('*', '*', 'italic text')}
						>
							<span class="tool-glyph is-italic">I</span>
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Strikethrough"
							aria-label="Strikethrough"
							onclick={() => toggleWrap('~~', '~~', 'strikethrough')}
						>
							<span class="tool-glyph is-strike">S</span>
						</button>
						<span class="tool-sep"></span>
						<button
							type="button"
							class="tool-btn"
							title="Bulleted list"
							aria-label="Bulleted list"
							onclick={() => setLinePrefix('- ', 'bullet')}
						>
							{@render toolIcon('bullets')}
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Numbered list"
							aria-label="Numbered list"
							onclick={() => setLinePrefix('1. ', 'ordered')}
						>
							{@render toolIcon('numbers')}
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Blockquote"
							aria-label="Blockquote"
							onclick={() => setLinePrefix('> ', 'quote')}
						>
							{@render toolIcon('quote')}
						</button>
						<span class="tool-sep"></span>
						<button
							type="button"
							class="tool-btn"
							title="Inline code"
							aria-label="Inline code"
							onclick={() => toggleWrap('`', '`', 'code')}
						>
							{@render toolIcon('code')}
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Code block"
							aria-label="Code block"
							onclick={insertCodeBlock}
						>
							{@render toolIcon('codeblock')}
						</button>
						<button
							type="button"
							class="tool-btn"
							title="Link (Ctrl+K)"
							aria-label="Link"
							onclick={insertLink}
						>
							{@render toolIcon('link')}
						</button>
					</div>

					{#if mode === 'write' && draftImages.length > 0}
						<div class="editor-images" aria-label="Images in this document">
							<span class="editor-images__label">Images</span>
							<div class="editor-images__list">
								{#each draftImages as image (image.id)}
									<div class="editor-images__item">
										<button
											type="button"
											class="editor-images__thumb"
											title="Show in the source"
											onclick={() => revealImage(image.id)}
										>
											<img src={image.url} alt={image.alt} />
										</button>
										<button
											type="button"
											class="editor-images__remove"
											aria-label={`Remove ${image.alt}`}
											title="Remove image"
											onclick={() => removeImage(image.id)}
										>
								<X size={14} strokeWidth={2} aria-hidden="true" />
							</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="editor-doc">
						<textarea
							class="editor-textarea"
							class:is-hidden={mode === 'preview'}
							name="content"
							bind:this={textareaEl}
							bind:value={() => draft, setDraft}
							onkeydown={onEditorKeydown}
							onpaste={onEditorPaste}
							spellcheck="false"
							placeholder="# Start writing…"></textarea>
						<div class="editor-preview markdown" class:is-hidden={mode !== 'preview'}>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown() -->
							{@html previewHtml}
						</div>
					</div>
				</form>
			{:else}
				<div class="editor-empty">
					<div class="empty-state">
						<h2 class="text-lg font-semibold text-white">
							{data.path
								? data.path.split('/').slice(1).join('/') || data.path.split('/')[0]
								: 'Editor'}
						</h2>
						<p>
							{data.apiError
								? data.apiError
								: data.path
									? 'Select a file, or create one from the Explorer.'
									: 'Pick a team in the Explorer to start editing.'}
						</p>
					</div>
				</div>
			{/if}

			<div class="editor-status">
				{#if data.file}
					<span class="truncate">{data.file.path}</span>
					<span class="editor-status__spacer"></span>
					{#if dirty}
						<span class="chip chip-accent">unsaved</span>
					{:else}
						<span class="chip chip-ok">saved</span>
					{/if}
					<span>Markdown</span>
				{:else if data.path}
					<span class="truncate">{data.path}</span>
					<span class="editor-status__spacer"></span>
					<span>section</span>
				{:else}
					<span>No file open</span>
				{/if}
			</div>
		</section>
	</div>

	{#if helpOpen}
		<div class="help-overlay">
			<button
				type="button"
				class="help-overlay__scrim"
				aria-label="Close writing guide"
				onclick={() => (helpOpen = false)}
			></button>
			<div
				class="help-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="writing-guide-title"
				tabindex="-1"
				bind:this={helpEl}
			>
				<div class="help-modal__head">
					<h2 id="writing-guide-title">Writing guide</h2>
					<button
						type="button"
						class="iconbtn"
						aria-label="Close writing guide"
						onclick={() => (helpOpen = false)}
					>					<X size={15} strokeWidth={1.7} aria-hidden="true" />
					</button>
				</div>

				<div class="help-modal__body">
					<section class="help-section">
						<h3>Formatting</h3>
						<dl class="help-list">
							<div class="help-item">
								<dt><code># Heading</code></dt>
								<dd>Heading 1 — use <code>##</code> for H2, <code>###</code> for H3.</dd>
							</div>
							<div class="help-item">
								<dt><code>**bold**</code></dt>
								<dd>Bold — <kbd>Ctrl</kbd>+<kbd>B</kbd></dd>
							</div>
							<div class="help-item">
								<dt><code>*italic*</code></dt>
								<dd>Italic — <kbd>Ctrl</kbd>+<kbd>I</kbd></dd>
							</div>
							<div class="help-item">
								<dt><code>~~struck~~</code></dt>
								<dd>Strikethrough</dd>
							</div>
							<div class="help-item">
								<dt><code>`code`</code></dt>
								<dd>Inline code</dd>
							</div>
							<div class="help-item">
								<dt><code>- item</code></dt>
								<dd>Bulleted list — use <code>1.</code> to number a list.</dd>
							</div>
							<div class="help-item">
								<dt><code>&gt; quote</code></dt>
								<dd>Blockquote</dd>
							</div>
							<div class="help-item">
								<dt><code>[text](url)</code></dt>
								<dd>Link — <kbd>Ctrl</kbd>+<kbd>K</kbd></dd>
							</div>
							<div class="help-item">
								<dt><code>![alt](url)</code></dt>
								<dd>Image — or paste an image; it shows as a thumbnail and is saved inline.</dd>
							</div>
						</dl>

						<p class="help-note">Fenced code block, with an optional language:</p>
						<pre class="help-code"><code
								>```js
const x = 1;
```</code
							></pre>

						<p class="help-note">Table (a header row, a divider, then rows):</p>
						<pre class="help-code"><code
								>| Name | Value |
| ---- | ----- |
| Motor | 3    |</code
							></pre>

						<p class="help-note">
							Links may point to <code>http</code>, <code>https</code>, <code>mailto</code>, or
							<code>tel</code> addresses, relative wiki paths, or <code>#anchors</code>. Raw HTML is
							shown as plain text.
						</p>
					</section>

					<section class="help-section">
						<h3>Frontmatter (header)</h3>
						<p class="help-note">
							Optional metadata at the very top of the file, fenced by <code>---</code> lines:
						</p>
						<pre class="help-code"><code
								>---
title: Page title
description: One-line summary.
order: 2
author: Your name
prev: setup
next: advanced/controls
---</code
							></pre>

						<dl class="help-list">
							<div class="help-item">
								<dt><code>title</code></dt>
								<dd>Page title and link label.</dd>
							</div>
							<div class="help-item">
								<dt><code>description</code></dt>
								<dd>Short summary shown with the page.</dd>
							</div>
							<div class="help-item">
								<dt><code>order</code></dt>
								<dd>Number used to sort pages within a section.</dd>
							</div>
							<div class="help-item">
								<dt><code>author</code></dt>
								<dd>Shown in the document header.</dd>
							</div>
							<div class="help-item">
								<dt><code>prev</code> / <code>next</code></dt>
								<dd>Previous/next links shown below the page.</dd>
							</div>
						</dl>

						<p class="help-note">
							For <code>prev</code>/<code>next</code>, a plain name (<code>setup</code>) links to a
							sibling in the same section; a value with a slash (<code>advanced/controls</code>) is
							a path from the root of your team's folder. Omit either to fall back to sibling order.
							Extra keys like <code>tags</code> are allowed and kept as-is.
						</p>
					</section>
					<section class="help-section">
						<h3>File structure</h3>
						<p class="help-note">
							Organize your content in a clear folder structure. Each section should have its own
							folder, and pages should be placed within the appropriate section folder.
							<br /><br />
							All team folders are their respective root directories. Inside of them, teams may organize
							their content as they best see fit.
							<br /><br />
							<strong>Important:</strong> There is one special filename, <code>index</code>. This
							file is automatically loaded and shown when a section is clicked. If this file is not
							present then the section will not have a landing page, and a default generated one
							will be shown instead.
						</p>
					</section>
				</div>
			</div>
		</div>
	{/if}

	<form
		class="is-hidden"
		method="POST"
		action="?/delete"
		use:enhance={submit()}
		bind:this={deleteForm}
	>
		<input type="hidden" name="path" value={deleteTarget} />
	</form>
</div>
