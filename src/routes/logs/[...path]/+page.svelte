<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TEAMS, teamForPath } from '$lib/teams';
	import { isIndexName } from '$lib/markdown';
	import { pageTitle } from '$lib/site';
	import DocHeader from '$lib/components/DocHeader.svelte';
	import DocPager from '$lib/components/DocPager.svelte';
	import type { GasTreeNode } from '$lib/server/gas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let currentPath = $derived((page.params.path ?? '').replace(/^\/+|\/+$/g, ''));
	let selectedTeam = $derived(teamForPath(currentPath) ?? TEAMS[0]);
	let teamRoot = $derived(data.tree.find((node) => node.name === selectedTeam.folder));
	let teamNodes = $derived(teamRoot?.children ?? []);

	let tabTitle = $derived.by(() => {
		switch (data.kind) {
			case 'file':
				return pageTitle(data.title);
			case 'folder':
				return pageTitle(data.node.name);
			case 'root':
				return pageTitle('Logs');
			case 'missing':
				return pageTitle('Not found');
			default:
				return pageTitle('Logs unavailable');
		}
	});

	let crumbs = $derived.by(() => {
		if (!currentPath) return [] as { label: string; path: string }[];
		const segments = currentPath.split('/');
		return segments.map((segment, index) => ({
			label: segment.replace(/\.md$/i, ''),
			path: segments.slice(0, index + 1).join('/')
		}));
	});

	let modified = $derived(
		data.kind === 'file' && data.modifiedTime
			? new Date(data.modifiedTime).toLocaleString(undefined, {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: null
	);

	function isCurrent(path: string): boolean {
		return currentPath === path;
	}

	function selectTeam(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		goto(resolve('/logs/[...path]', { path: value }));
	}
</script>

{#snippet navNodes(nodes: GasTreeNode[], depth: number)}
	<div class={depth === 0 ? 'docs-tree' : 'docs-sub'}>
		{#each nodes as node (node.path)}
			{#if node.type === 'folder'}
				<a
					href={resolve('/logs/[...path]', { path: node.path })}
					class="docs-nav__title mt-4"
					class:is-active={isCurrent(node.path)}
					aria-current={isCurrent(node.path) ? 'page' : undefined}
				>
					{node.name}
				</a>
				{@render navNodes(node.children ?? [], depth + 1)}
			{:else if !isIndexName(node.name)}
				<a
					href={resolve('/logs/[...path]', { path: node.path })}
					class="docs-link"
					class:is-active={isCurrent(node.path)}
					aria-current={isCurrent(node.path) ? 'page' : undefined}
				>
					{node.name.replace(/\.md$/i, '')}
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
			<label class="label" for="team-select">Team</label>
			<select
				id="team-select"
				class="team-select"
				value={selectedTeam.folder}
				onchange={selectTeam}
			>
				{#each TEAMS as team (team.id)}
					<option value={team.folder}>{team.label}</option>
				{/each}
			</select>

			{#if data.tree.length > 0}
				<div class="docs-tree">
					<a
						href={resolve('/logs/[...path]', { path: selectedTeam.folder })}
						class="docs-link"
						class:is-active={isCurrent(selectedTeam.folder)}
						style={`color: ${selectedTeam.color}`}
					>
						{selectedTeam.label}
					</a>
				</div>
				{@render navNodes(teamNodes, 1)}
			{:else}
				<p class="field-hint">No content yet.</p>
			{/if}
		</aside>

		<div class="docs-content min-w-0">
			{#if data.kind === 'unavailable'}
				<div class="empty-state">
					<h2>Logs unavailable</h2>
					<p>{data.error}</p>
					<p class="field-hint mt-1">
						Check <code>GAS_API_URL</code> and <code>GAS_API_KEY</code>.
					</p>
				</div>
			{:else if data.kind === 'missing'}
				<div class="empty-state">
					<h2>Not found</h2>
					<p>{data.error}</p>
					<a href={resolve('/logs')} class="btn btn-ghost btn-sm mt-2">Back to logs</a>
				</div>
			{:else if data.kind === 'root'}
				<div>
					<h1 class="section-heading">Logs</h1>
					<p class="mt-2 text-[var(--text-muted)]">
						Build logs, match notes and design docs — stored in Google Drive.
					</p>
					<div class="mt-6 grid gap-3 sm:grid-cols-2">
						{#each data.teams as team (team.id)}
							<a
								href={resolve('/logs/[...path]', { path: team.folder })}
								class="card card-link"
								style={`border-left: 2px solid ${team.color}`}
							>
								<h2 class="card-title" style={`color: ${team.color}`}>{team.label}</h2>
								<p class="meta mt-1">{team.blurb}</p>
							</a>
						{/each}
					</div>
				</div>
			{:else if data.kind === 'folder'}
				<div>
					<nav class="breadcrumb" aria-label="Breadcrumb">
						<a href={resolve('/logs')}>Logs</a>
						{#each crumbs as crumb (crumb.path)}
							<span aria-hidden="true">/</span>
							<a href={resolve('/logs/[...path]', { path: crumb.path })}>{crumb.label}</a>
						{/each}
					</nav>

					<div class="flex flex-wrap items-center justify-between gap-3">
						<h1 style={`color: ${selectedTeam.color}`}>{data.node.name}</h1>
						{#if data.canEdit}
							<a
								href={resolve('/edit/[...path]', { path: data.node.path })}
								class="btn btn-ghost btn-sm"
							>
								Manage
							</a>
						{/if}
					</div>

					{#if !data.node.children || data.node.children.length === 0}
						<div class="empty-state mt-6">
							<p>This section is empty.</p>
							{#if data.canEdit}
								<a
									href={resolve('/edit/[...path]', { path: data.node.path })}
									class="btn btn-primary btn-sm mt-2"
								>
									Add content
								</a>
							{/if}
						</div>
					{:else}
						<div class="mt-6 grid gap-3 sm:grid-cols-2">
							{#each data.node.children as node (node.path)}
								<a href={resolve('/logs/[...path]', { path: node.path })} class="card card-link">
									<span class="chip">{node.type === 'folder' ? 'Section' : 'Page'}</span>
									<h2 class="card-title mt-3 text-base">{node.name.replace(/\.md$/i, '')}</h2>
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{:else if data.kind === 'file'}
				<div>
					<nav class="breadcrumb" aria-label="Breadcrumb">
						<a href={resolve('/logs')}>Logs</a>
						{#each crumbs as crumb (crumb.path)}
							<span aria-hidden="true">/</span>
							<a href={resolve('/logs/[...path]', { path: crumb.path })}>{crumb.label}</a>
						{/each}
					</nav>

					<article>
						<DocHeader title={data.title} author={data.author} date={modified}>
							{#snippet actions()}
								{#if data.canEdit}
									<a
										href={resolve('/edit/[...path]', { path: data.path })}
										class="btn btn-primary btn-sm"
									>
										Edit page
									</a>
								{/if}
							{/snippet}
						</DocHeader>
						<div class="markdown mt-7">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown() -->
							{@html data.html}
						</div>
						<DocPager prev={data.prev} next={data.next} />
					</article>
				</div>
			{/if}
		</div>
	</div>
</div>
