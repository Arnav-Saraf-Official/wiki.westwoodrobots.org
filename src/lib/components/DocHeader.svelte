<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Document title, rendered as the page heading. */
		title: string;
		/** Optional author, shown in the metadata row. */
		author?: string | null;
		/** Optional human-readable date, shown in the metadata row. */
		date?: string | null;
		/** Optional slot for page actions (e.g. an edit button). */
		actions?: Snippet;
	}

	let { title, author = null, date = null, actions }: Props = $props();
</script>

<header class="doc-header">
	<div class="doc-header__top">
		<h1>{title}</h1>
		{#if actions}
			<div class="doc-header__actions">{@render actions()}</div>
		{/if}
	</div>

	{#if author || date}
		<div class="doc-meta">
			{#if author}
				<span class="doc-meta__item">
					<span class="doc-meta__label">Author</span>
					<span>{author}</span>
				</span>
			{/if}
			{#if date}
				<span class="doc-meta__item">
					<span class="doc-meta__label">Updated</span>
					<span>{date}</span>
				</span>
			{/if}
		</div>
	{/if}
</header>
