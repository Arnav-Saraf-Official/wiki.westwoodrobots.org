# Markdown guide

A complete reference for the markdown the wiki understands — every heading level
through the frontmatter/header block, then code-writing examples.

## Headings — `#` through `######`

```
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

The editor toolbar only exposes H1–H3, but the renderer accepts all six. Leave a
blank line before a heading so it isn't parsed as part of the previous paragraph.

## Inline emphasis

| Write this               | Get this          |
| ------------------------ | ----------------- |
| `**bold**`               | **bold**          |
| `*italic*` or `_italic_` | _italic_          |
| `***bold italic***`      | _**bold italic**_ |
| `~~strikethrough~~`      | ~~strikethrough~~ |
| `` `inline code` ``      | `inline code`     |

Editor shortcuts: <kbd>Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl</kbd>+<kbd>I</kbd>
italic, <kbd>Ctrl</kbd>+<kbd>K</kbd> link.

## Lists

```
- Bullet item
- Another item
  - Nested item

1. First
2. Second

- [ ] Unchecked task
- [x] Checked task
```

Unordered, ordered, nested, and GFM task lists are all supported.

## Blockquote

```
> Quoted text
>
> A second paragraph inside the quote.
```

## Links

```
[Link text](https://example.com)
[Email](mailto:team@example.com)
[Phone](tel:+15551234567)
[Relative page](../overview)
[Anchor on this page](#setup)
```

Allowed schemes: `http`, `https`, `mailto`, `tel`, plus relative paths and
`#anchors`. Anything else (e.g. `javascript:`) is rendered inert as `#`.

## Images

```
![Alt text](https://example.com/photo.png)
![Alt text](../images/cad-view.png)
```

Or paste an image straight into the editor. While editing it appears as a
thumbnail (with a short token in the source) rather than a wall of base64, and
it is written into the file as an inline `data:image/...` URL on save. Raster
formats only (png, jpeg, gif, webp, avif, bmp); SVG is rejected.

## Fenced code blocks

````
```js
const x = 1;
```
````

A language tag enables syntax highlighting. Recognised languages include
`javascript`, `jsx`, `typescript`, `tsx`, `json`, `bash`, `python`, `yaml`,
`markdown`, `diff`, `sql`, `c`, `cpp`, `csharp`, `java`, `glsl`, `svelte`,
`css`, and `html`. With no tag, the block is shown unhighlighted.

## Tables (GFM)

```
| Name  | Value |
| ----- | ----- |
| Motor | 3     |
| Servo | 1     |
```

The divider row of dashes is required.

## Horizontal rule

```
---
```

Inside the body this is a rule; at the very top of a file, `---` opens the
frontmatter block instead.

## Raw HTML

How HTML is treated depends on where the page comes from:

- **Static wiki pages** (`src/content/**/*.md`) are compiled by mdsvex at build
  time into Svelte components, so raw HTML and even Svelte components render
  normally — e.g. `<Simulation />`.
- **Dynamic content** (`/logs/...` pages and the editor's live Preview) is raw
  markdown rendered at runtime, where HTML is escaped and shown as literal text.
  `<div>` prints as `<div>`.

# Frontmatter (header block)

Optional metadata at the very top of the file, fenced by `---` lines. Only simple
`key: value` pairs (no nested YAML); surrounding quotes are stripped.

```
---
title: Drive team roles
description: Who does what on the drive team.
order: 3
author: Your name
prev: setup
next: advanced/controls
---

# Drive team roles

Body starts here.
```

| Field           | Meaning                                     |
| --------------- | ------------------------------------------- |
| `title`         | Page title and link label.                  |
| `description`   | Short summary shown with the page.          |
| `order`         | Number used to sort pages within a section. |
| `author`        | Shown in the document header.               |
| `prev` / `next` | Previous/next links shown below the page.   |

**`prev` / `next` resolution**

- A plain name (`setup`) links to a sibling in the same section.
- A value containing a slash (`advanced/controls`) is a path from the root of
  your team's folder.
- Omit either to fall back to sibling order.
- If both resolve to null, the prev/next row is hidden entirely.

Any other `key: value` is kept as-is, so extra fields like `tags: motors` are
allowed.

# Code-writing examples

**Svelte**

````
```svelte
<script lang="ts">
  let count = $state(0);
</script>

<button onclick={() => count++}>
  Clicked {count} times
</button>
```
````

**TypeScript / JavaScript**

````
```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```
````

**Bash**

````
```bash
bun install
bun run check
```
````

**JSON**

````
```json
{ "team": "KUNAI", "season": 2026 }
```
````

**YAML**

````
```yaml
title: Example
order: 1
```
````
