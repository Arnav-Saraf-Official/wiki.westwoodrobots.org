<script lang="ts">
	/**
	 * A deliberately small interactive simulation, used to demonstrate that a
	 * markdown page can embed live Svelte + TypeScript. Drag the sliders and the
	 * readouts recompute with Svelte runes.
	 */
	const GRAVITY = 9.81;

	/** Exit speed of the game piece, in m/s. */
	let speed = $state(11);
	/** Launch angle above horizontal, in degrees. */
	let angle = $state(45);

	/** Projectile range on flat ground, in meters. */
	let range = $derived((speed * speed * Math.sin((2 * angle * Math.PI) / 180)) / GRAVITY);
	/** Peak height of the trajectory, in meters. */
	let apex = $derived((speed ** 2 * Math.sin((angle * Math.PI) / 180) ** 2) / (2 * GRAVITY));
</script>

<div class="sim">
	<header class="sim__head">
		<span class="sim__badge">Live</span>
		<strong>Launcher range</strong>
	</header>

	<label class="sim__control">
		<span>Exit speed <b>{speed.toFixed(1)} m/s</b></span>
		<input type="range" min="4" max="20" step="0.5" bind:value={speed} />
	</label>

	<label class="sim__control">
		<span>Launch angle <b>{angle}°</b></span>
		<input type="range" min="10" max="80" step="1" bind:value={angle} />
	</label>

	<div class="sim__readout">
		<div><span>Range</span><b>{range.toFixed(1)} m</b></div>
		<div><span>Apex</span><b>{apex.toFixed(1)} m</b></div>
	</div>

	<p class="sim__note">Projectile model without drag. Values update as you drag.</p>
</div>

<style>
	.sim {
		display: grid;
		gap: 14px;
		padding: 18px;
		margin: 1.4em 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.sim__head {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.9rem;
	}

	.sim__badge {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--primary-soft);
		color: #fdba74;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.sim__control {
		display: grid;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.sim__control span {
		display: flex;
		justify-content: space-between;
	}

	.sim__control b {
		color: var(--text);
	}

	.sim__control input {
		width: 100%;
		accent-color: var(--primary);
	}

	.sim__readout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.sim__readout > div {
		display: grid;
		gap: 2px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}

	.sim__readout span {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	.sim__readout b {
		font-size: 1.05rem;
		color: #fff;
	}

	.sim__note {
		font-size: 0.75rem;
		color: var(--text-dim);
	}
</style>
