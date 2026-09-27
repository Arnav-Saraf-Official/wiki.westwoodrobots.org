<script lang="ts">
	export interface DocLink {
		title: string;
		href: string;
	}

	interface Props {
		/** Page to offer as "previous"; null hides the link. */
		prev?: DocLink | null;
		/** Page to offer as "next"; null hides the link. */
		next?: DocLink | null;
	}

	let { prev = null, next = null }: Props = $props();
</script>

{#if prev || next}
	<nav class="doc-pager" aria-label="Reading order">
		{#if prev}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers build app-relative hrefs -->
			<a href={prev.href} class="doc-pager__link is-prev" rel="prev">
				<span class="doc-pager__dir">← Previous</span>
				<span class="doc-pager__title">{prev.title}</span>
			</a>
		{:else}
			<span class="doc-pager__spacer"></span>
		{/if}
		{#if next}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers build app-relative hrefs -->
			<a href={next.href} class="doc-pager__link is-next" rel="next">
				<span class="doc-pager__dir">Next →</span>
				<span class="doc-pager__title">{next.title}</span>
			</a>
		{/if}
	</nav>
{/if}
