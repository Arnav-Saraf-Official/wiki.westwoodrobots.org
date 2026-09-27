<script lang="ts">
	import { resolve } from '$app/paths';
	import { docsTree, docCount, type DocNode } from '$lib/docs';
	import { pageTitle } from '$lib/site';
	import { TEAMS } from '$lib/teams';

	let { data } = $props();

	const topLevel = docsTree.slice(0, 3);

	function countPages(node: DocNode): number {
		if (node.type === 'file') return 1;
		return node.children.reduce((total, child) => total + countPages(child), 0);
	}

	function canEditTeam(id: string): boolean {
		return (data.editableTeams ?? []).some((team) => team.id === id);
	}
</script>

<svelte:head>
	<title>{pageTitle()}</title>
</svelte:head>

<div class="page">
	<header class="max-w-2xl">
		<div class="flex gap-4">
			<img
				src="https://westwoodrobots.org/wwrobo.svg"
				alt="Westwood Robotics Logo"
				width="30"
				height="30"
			/>
			<div class="flex flex-col">
				<h1>Westwood Robotics wiki</h1>
				<p class="mt-3 text-[var(--text-muted)]">
					A curation of helpful guides and past journeys of Westwood Robotics Teams.
				</p>
			</div>
		</div>
		<div class="mt-6 flex flex-wrap items-center gap-2">
			<a href={resolve('/wiki')} class="btn btn-primary">Browse the wiki</a>
			<a href={resolve('/logs')} class="btn btn-ghost">Read logs</a>
			{#if data.canEdit}
				<a href={resolve('/edit')} class="btn btn-ghost">Open editor</a>
			{/if}
		</div>
	</header>

	<section class="mt-14">
		<div class="flex items-end justify-between gap-4">
			<div>
				<h2>Wiki</h2>
				<p class="mt-1 text-sm text-[var(--text-muted)]">
					{docCount} page{docCount === 1 ? '' : 's'} to help you on your journey.
				</p>
			</div>
			<a href={resolve('/wiki')} class="btn btn-ghost btn-sm">View all</a>
		</div>

		{#if topLevel.length === 0}
			<div class="empty-state mt-5">
				<p>No pages yet. Add a <code>.md</code> file to <code>src/content/</code>.</p>
			</div>
		{:else}
			<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each topLevel as node (node.href)}
					<a href={resolve('/wiki/[...path]', { path: node.path })} class="card card-link">
						<span class="chip">{node.type === 'section' ? 'Section' : 'Page'}</span>
						<h3 class="card-title mt-3">{node.title}</h3>
						{#if node.type === 'section'}
							<p class="meta mt-1">{countPages(node)} pages</p>
						{:else if node.description}
							<p class="meta mt-1 line-clamp-2">{node.description}</p>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<section class="mt-14">
		<div>
			<h2>Logs</h2>
			<p class="mt-1 text-sm text-[var(--text-muted)]">
				Read the journeys of Westwood Robotics Teams.
			</p>
		</div>

		<div class="mt-5 grid gap-3 sm:grid-cols-2">
			{#each TEAMS as team (team.id)}
				<a
					href={resolve('/logs/[...path]', { path: team.folder })}
					class="card card-link"
					style={`border-left: 2px solid ${team.color}`}
				>
					<div class="flex items-center gap-3">
						<h3 class="card-title" style={`color: ${team.color}`}>{team.label}</h3>
						{#if canEditTeam(team.id)}
							<span class="chip chip-ok ml-auto">editor</span>
						{/if}
					</div>
					<p class="meta mt-1">{team.blurb}</p>
				</a>
			{/each}
		</div>
	</section>
</div>
