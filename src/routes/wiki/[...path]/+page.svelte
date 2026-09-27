<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		docsTree,
		findDoc,
		findSection,
		flatten,
		indexFileOf,
		isIndexFile,
		sectionFiles,
		type DocFile,
		type DocNode
	} from '$lib/docs';
	import { fileLabel, isIndexName } from '$lib/markdown';
	import { pageTitle } from '$lib/site';
	import DocHeader from '$lib/components/DocHeader.svelte';
	import DocPager from '$lib/components/DocPager.svelte';

	interface DocLink {
		title: string;
		href: string;
	}

	let dirPath = $derived((page.params.path ?? '').replace(/^\/+|\/+$/g, '').replace(/\.md$/i, ''));
	let currentFile = $derived(findDoc(dirPath));
	let currentSection = $derived(currentFile ? undefined : findSection(dirPath));
	let sectionIndex = $derived(currentFile ? undefined : indexFileOf(currentSection));
	let activeFile = $derived(currentFile ?? sectionIndex);
	let notFound = $derived(!activeFile && !currentSection);
	let tabTitle = $derived(
		pageTitle(activeFile?.title ?? currentSection?.title ?? 'Page not found')
	);
	let Doc = $derived(activeFile?.component);

	let sectionChildren = $derived(
		currentSection
			? currentSection.children.filter((node) => !isIndexFile(node))
			: ([] as DocNode[])
	);
	let pageCount = $derived(
		currentSection
			? flatten(currentSection.children).filter((node) => node.type === 'file').length
			: 0
	);

	let crumbs = $derived.by(() => {
		if (!activeFile) return [] as { label: string; path: string }[];
		const segments = dirPath.split('/').filter(Boolean);
		return segments.map((segment, index) => ({
			label: segment.replace(/\.md$/i, ''),
			path: segments.slice(0, index + 1).join('/')
		}));
	});

	/** Resolves a frontmatter prev/next value relative to the page's section. */
	function resolveLink(value: string | undefined, section: string): DocLink | null {
		if (!value) return null;
		const raw = value.replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
		if (!raw) return null;
		const target = raw.includes('/') || !section ? raw : `${section}/${raw}`;
		const doc = findDoc(target);
		if (doc) return { title: doc.title, href: doc.href };
		return { title: fileLabel(raw.split('/').pop() ?? raw), href: `/wiki/${target}` };
	}

	let pager = $derived.by(() => {
		const file = activeFile;
		if (!file) return { prev: null as DocLink | null, next: null as DocLink | null };
		const list: DocFile[] = sectionFiles(findSection(file.section));
		const index = list.findIndex((candidate) => candidate.path === file.path);
		const prevDoc = index > 0 ? list[index - 1] : null;
		const nextDoc = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
		return {
			prev:
				resolveLink(file.prev, file.section) ??
				(prevDoc && { title: prevDoc.title, href: prevDoc.href }),
			next:
				resolveLink(file.next, file.section) ??
				(nextDoc && { title: nextDoc.title, href: nextDoc.href })
		};
	});

	function isCurrent(path: string): boolean {
		return dirPath === path;
	}
</script>

{#snippet navNodes(nodes: DocNode[], depth: number)}
	<div class={depth === 0 ? 'docs-tree' : 'docs-sub'}>
		{#each nodes as node (node.href)}
			{#if node.type === 'section'}
				<p class="docs-nav__title mt-4">{node.title}</p>
				{@render navNodes(node.children, depth + 1)}
			{:else if !isIndexName(node.name)}
				<a
					href={resolve('/wiki/[...path]', { path: node.path })}
					class="docs-link"
					class:is-active={isCurrent(node.path)}
					aria-current={isCurrent(node.path) ? 'page' : undefined}
				>
					{node.title}
				</a>
			{/if}
		{/each}
	</div>
{/snippet}

<svelte:head>
	<title>{tabTitle}</title>
</svelte:head>

<div class="page page-docs">
	<div class="docs-layout">
		<aside class="docs-nav">
			<p class="docs-nav__title">Wiki</p>
			{#if docsTree.length > 0}
				{@render navNodes(docsTree, 0)}
			{:else}
				<p class="field-hint">No pages yet.</p>
			{/if}
		</aside>

		<div class="docs-content min-w-0">
			{#if notFound}
				<div class="empty-state">
					<h2>Page not found</h2>
					<p>Nothing lives at <code>/wiki/{dirPath}</code>.</p>
					<a href={resolve('/wiki')} class="btn btn-ghost btn-sm mt-2">Back to the wiki</a>
				</div>
			{:else if activeFile}
				<nav class="breadcrumb" aria-label="Breadcrumb">
					<a href={resolve('/wiki')}>Wiki</a>
					{#each crumbs as crumb (crumb.path)}
						<span aria-hidden="true">/</span>
						<a href={resolve('/wiki/[...path]', { path: crumb.path })}>{crumb.label}</a>
					{/each}
				</nav>

				<article>
					<DocHeader title={activeFile.title} author={activeFile.author} />
					{#if activeFile.description}
						<p class="mt-2 text-[var(--text-muted)]">{activeFile.description}</p>
					{/if}
					<div class="markdown mt-7">
						{#if Doc}
							<Doc />
						{/if}
					</div>
					<DocPager prev={pager.prev} next={pager.next} />
				</article>
			{:else if currentSection}
				<div>
					<h1 class="section-heading">{currentSection.title}</h1>
					<p class="meta mt-2">{pageCount} page(s) in this section.</p>

					{#if sectionChildren.length === 0}
						<div class="empty-state mt-6">
							<p>This section is empty.</p>
						</div>
					{:else}
						<div class="mt-6 grid gap-3 sm:grid-cols-2">
							{#each sectionChildren as node (node.path)}
								<a href={resolve('/wiki/[...path]', { path: node.path })} class="card card-link">
									<span class="chip">{node.type === 'section' ? 'Section' : 'Page'}</span>
									<h2 class="card-title mt-3 text-base">{node.title}</h2>
									{#if node.type === 'file' && node.description}
										<p class="meta mt-1 line-clamp-2">{node.description}</p>
									{:else if node.type === 'section'}
										<p class="meta mt-1">{node.children.length} item(s)</p>
									{/if}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
