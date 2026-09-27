<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/wwrobo.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';

	let { children, data } = $props();

	/** Sidebar collapsed to an icon rail (desktop only). */
	let collapsed = $state(false);
	/** Off-canvas drawer on small screens. */
	let navOpen = $state(false);

	const navLinks = [
		{ href: resolve('/'), label: 'Home', icon: 'home' },
		{ href: resolve('/wiki'), label: 'Wiki', icon: 'book' },
		{ href: resolve('/logs'), label: 'Logs', icon: 'list' }
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}

	afterNavigate(() => {
		navOpen = false;
	});
</script>

{#snippet icon(name: string)}
	{#if name === 'home'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M3 10.5 12 3l9 7.5" stroke-linecap="round" stroke-linejoin="round" />
			<path d="M5.5 9.5V20h13V9.5" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{:else if name === 'book'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path
				d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z"
				stroke-linejoin="round"
			/>
			<path
				d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"
				stroke-linejoin="round"
			/>
		</svg>
	{:else if name === 'list'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M8 6h12M8 12h12M8 18h12" stroke-linecap="round" />
			<path d="M4 6h.01M4 12h.01M4 18h.01" stroke-linecap="round" />
		</svg>
	{:else if name === 'edit'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M4 20h4l10-10-4-4L4 16z" stroke-linecap="round" stroke-linejoin="round" />
			<path d="m13.5 6.5 4 4" stroke-linecap="round" />
		</svg>
	{:else if name === 'signout'}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<path d="M15 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" stroke-linecap="round" />
			<path d="M18 12H10m8 0-3-3m3 3-3 3" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"
		>
			<circle cx="12" cy="8.5" r="3.5" />
			<path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke-linecap="round" />
		</svg>
	{/if}
{/snippet}

<svelte:head>
	<link rel="icon" href={logo} />
	<meta name="theme-color" content="#0a0a0b" />
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') navOpen = false;
	}}
/>

<div class="app-shell" class:is-collapsed={collapsed}>
	<aside class="app-nav" class:is-open={navOpen}>
		<a href={resolve('/')} class="app-nav__brand" aria-label="WWRobo Wiki — home">
			<img src={logo} alt="" width="30" height="30" />
			<span>WWRobo Wiki</span>
		</a>

		<nav class="app-nav__links" aria-label="Primary">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="nav-item"
					class:is-active={isActive(link.href)}
					aria-current={isActive(link.href) ? 'page' : undefined}
					title={link.label}
				>
					{@render icon(link.icon)}
					<span class="nav-label">{link.label}</span>
				</a>
			{/each}

			{#if data.canEdit}
				<a
					href={resolve('/edit')}
					class="nav-item"
					class:is-active={isActive(resolve('/edit'))}
					aria-current={isActive(resolve('/edit')) ? 'page' : undefined}
					title="Editor"
				>
					{@render icon('edit')}
					<span class="nav-label">Editor</span>
				</a>
			{/if}
		</nav>

		<div class="app-nav__spacer"></div>

		<div class="app-nav__foot">
			{#if data.user}
				<div class="app-nav__user" title={data.user.email}>
					{#if data.user.picture}
						<img src={data.user.picture} alt="" referrerpolicy="no-referrer" />
					{/if}
					<span>{data.user.name}</span>
				</div>
				<form method="POST" action={resolve('/auth/logout')}>
					<button type="submit" class="btn btn-ghost btn-sm" title="Sign out">
						{@render icon('signout')}
						<span class="nav-label">Sign out</span>
					</button>
				</form>
			{:else}
				<a href={resolve('/auth/google')} class="btn btn-primary btn-sm" title="Sign in">
					{@render icon('account')}
					<span class="nav-label">Sign in</span>
				</a>
			{/if}

			<div class="nav-toggle-row">
				<button
					type="button"
					class="nav-toggle"
					onclick={() => (collapsed = !collapsed)}
					aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
					aria-expanded={!collapsed}
				>
					{collapsed ? '»' : '«'}
				</button>
			</div>
		</div>
	</aside>

	{#if navOpen}
		<button
			type="button"
			class="app-nav-scrim"
			aria-label="Close navigation"
			onclick={() => (navOpen = false)}
		></button>
	{/if}

	<main class="app-main">
		<button
			type="button"
			class="nav-mobile-trigger"
			aria-label="Open navigation"
			onclick={() => (navOpen = true)}
		>
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
			>
				<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
			</svg>
		</button>

		{@render children()}

		<footer class="site-footer">
			<div class="site-footer__inner">
				<span>Westwood Robotics · wiki.westwoodrobots.org</span>
				<span class="flex items-center gap-4">
					<a href={resolve('/wiki')}>Wiki</a>
					<a href={resolve('/logs')}>Logs</a>
					<a href="https://westwoodrobots.org">westwoodrobots.org</a>
				</span>
			</div>
		</footer>
	</main>
</div>
