---
title: Getting started
description: What lives on this wiki and how to find your way around.
order: 1
---

# Getting started

Welcome to the Westwood Robotics wiki. There are two halves to the site:

- **Wiki** (this section) is markdown that ships with the website. It is
  written and reviewed like code: folders become sections, files become pages.
- **Logs** live in Google Drive and are served through the Apps Script API.
  Each team (Kunai, Atlatl, Hunga Munga, Slingshot) has its own folder with
  build logs, match notes and design docs.

## Finding things

Use the sidebar to walk the section tree, or start at [Wiki](/wiki) and
[Logs](/logs).

## Editing

Team members with permission can edit their team's logs:

1. Sign in with your Google account.
2. Open the **Editor** from the navigation sidebar.
3. Pick a page, edit the markdown, and save. Updates appear on the public page
   immediately.

> New pages are created with the **New page** form: choose a team, an optional
> folder, and a file name. The extension is added for you.

## Markdown support

Standard GitHub-flavored markdown works: headings, lists, tables, task lists,
code blocks and blockquotes.

```ts
// Example: a code block
const robot = { name: 'Kunai', team: 2026 };
```

| Element | Syntax           |
| ------- | ---------------- |
| Bold    | `**bold**`       |
| Link    | `[label](/wiki)` |
| Code    | `` `inline` ``   |

Code blocks are highlighted when a language is named after the opening fence.

## Page header and reading order

Optional frontmatter fills the header shown at the top of every page, and the
`prev`/`next` entries become links below the content:

```markdown
---
title: Launch simulation
author: WWRobo
prev: build-guide
next: faq
---
```

A file named `index.md` is shown automatically when its section is opened.

## Svelte and TypeScript

Pages in this section are compiled by mdsvex, so a page can include a `<script>`
block, import Svelte components and run TypeScript. See
[Launch simulation](/wiki/robots/simulation) for a live, interactive example.

Log pages from Google Drive are rendered on the server and only run markdown:
there, raw HTML is displayed as text rather than executed.
