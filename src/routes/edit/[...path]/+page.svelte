<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { renderMarkdown } from '$lib/markdown';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import type { GasTreeNode } from '$lib/server/gas';
	import type { PageData } from './$types';
	import { onMount, tick } from 'svelte';

	let { data }: { data: PageData } = $props();

	/** Content of a brand-new page, offered as the starting point. */
	const NEW_PAGE_TEMPLATE = '---\ntitle: New page\n---\n\n# New page\n\n';

	// --- Drafts -------------------------------------------------------------
	// Edits are held locally (and mirrored to localStorage) until the writer
	// explicitly saves; only then are they pushed to the wiki API.
	let edits = $state<Record<string, string>>({});
	let storageKey = $derived(`wiki:edit:drafts:${data.user.email}`);

	let filePath = $derived(data.file?.path ?? '');
	let draft = $derived(edits[filePath] ?? data.file?.content ?? '');
	let mode = $state<'write' | 'preview'>('write');
	let previewHtml = $derived(renderMarkdown(draft));
	let dirty = $derived(!!data.file && draft !== data.file.content);

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	function persistNow() {
		if (!browser) return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(edits));
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

	onMount(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) edits = { ...(JSON.parse(raw) as Record<string, string>), ...edits };
		} catch {
			// Malformed storage — start clean.
		}
	});

	// --- Notices / pending --------------------------------------------------
	let notice = $state<{ type: 'ok' | 'error'; text: string } | null>(null);
	let saving = $state(false);

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
		opts: { clearDraft?: boolean } = {}
	): SubmitFunction {
		return () => {
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
	 * Pastes an image directly into the document as an inline `data:` URL, so the
	 * image lives inside the markdown instead of referencing an external file.
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
		const name = file.name ? file.name.replace(/\.[^.]+$/, '') : 'pasted image';
		const snippet = `![${name}](${dataUrl})`;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const value = draft;
		setDraft(value.slice(0, start) + snippet + value.slice(end));
		restoreSelection(start + snippet.length, start + snippet.length);
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
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M9 6h11M9 12h11M9 18h11" stroke-linecap="round" />
			<circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
			<circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
		</svg>
	{:else if name === 'numbers'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M10 6h10M10 12h10M10 18h10" stroke-linecap="round" />
			<text x="3" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
			<text x="3" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
			<text x="3" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
		</svg>
	{:else if name === 'quote'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M6 6v12" stroke-linecap="round" />
			<path d="M10 9h9M10 15h6" stroke-linecap="round" />
		</svg>
	{:else if name === 'code'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="m9 8-4 4 4 4M15 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{:else if name === 'codeblock'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path
				d="m9.5 10-2.5 2 2.5 2M14.5 10l2.5 2-2.5 2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{:else if name === 'link'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path
				d="M10 14a4 4 0 0 1 0-5.7l2.3-2.3a4 4 0 0 1 5.7 5.7L16.5 13"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M14 10a4 4 0 0 1 0 5.7l-2.3 2.3a4 4 0 0 1-5.7-5.7L7.5 11"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet glyph(kind: 'folder' | 'file')}
	{#if kind === 'folder'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<path
				d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
				stroke-linejoin="round"
			/>
		</svg>
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<path
				d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"
				stroke-linejoin="round"
			/>
			<path d="M13 3v6h6" stroke-linejoin="round" />
		</svg>
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
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="m9 6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
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
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
								<path d="M4 20h4l10-10-4-4L4 16z" stroke-linecap="round" stroke-linejoin="round" />
								<path d="m13.5 6.5 4 4" stroke-linecap="round" />
							</svg>
						</button>
						<button
							type="button"
							class="iconbtn"
							title="Delete"
							aria-label={`Delete ${node.name}`}
							onclick={() => confirmDelete(node)}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
								<path
									d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
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
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
							<path
								d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"
								stroke-linejoin="round"
							/>
							<path d="M13 3v6h6" stroke-linejoin="round" />
							<path d="M12 12v4M10 14h4" stroke-linecap="round" />
						</svg>
					</button>
					<button
						type="button"
						class="iconbtn"
						title="New section"
						aria-label="New section"
						disabled={!data.path}
						onclick={() => startCreate('folder')}
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
							<path
								d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
								stroke-linejoin="round"
							/>
							<path d="M12 11v4M10 13h4" stroke-linecap="round" />
						</svg>
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
				<div
					class="editor-toast message {notice.type === 'error' ? 'message-error' : 'message-ok'}"
					role="status"
				>
					{notice.text}
				</div>
			{/if}

			{#if data.file}
				<form
					class="editor-form"
					method="POST"
					action="?/save"
					use:enhance={submit((value) => (saving = value), { clearDraft: true })}
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
