---
title: Launch simulation
description: A live TypeScript simulation embedded directly inside a markdown page.
order: 4
author: WWRobo
prev: build-guide
---

<script lang="ts">
	import Simulation from '$lib/components/Simulation.svelte';
</script>

# Launch simulation

This page is ordinary markdown, but mdsvex compiles it to a Svelte component, so
anything Svelte can do works here — including interactive TypeScript. The block
below is a component imported from `$lib` and rendered like any other element.

<Simulation />

## Why this matters

A page can mix prose, highlighted code, and live widgets:

```ts
const teams = ['Kunai', 'Atlatl', 'Hunga Munga', 'Slingshot'] as const;

type Team = (typeof teams)[number];

function robotFor(team: Team): string {
	return `${team} robot`;
}
```

```svelte
<script lang="ts">
	import Simulation from '$lib/components/Simulation.svelte';
</script>

<Simulation />
```

Fenced blocks are highlighted whenever a language is named, and the document
header above was built from this page's frontmatter.
