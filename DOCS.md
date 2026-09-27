# Wiki API reference

The wiki's content lives in a Google Drive folder that acts as the filesystem
root, served by a Google Apps Script web app (`appscript/`).

```
browser ──▶ SvelteKit server ──▶ Apps Script web app ──▶ Google Drive
              (holds the API key)
```

The browser never talks to Apps Script directly: `ContentService` cannot send
CORS headers, and the API key must not reach the client. The SvelteKit server
reads `GAS_API_URL` and `GAS_API_KEY` from the private environment and forwards
requests.

## Site structure

The site has two content halves:

| Route       | Content                                                               |
| ----------- | --------------------------------------------------------------------- |
| `/wiki/...` | Static markdown from `src/content/`, compiled by mdsvex at build time |
| `/logs/...` | Live markdown from this API, rendered per request, organized per team |
| `/edit/...` | Editor for the dynamic half (restricted to authorized accounts)       |

Static pages mirror the on-disk layout: every folder in `src/content/` becomes
a section, every `.md` file becomes a page. Optional frontmatter:

```markdown
---
title: Build guide
description: Shown on cards and in search results.
order: 2
author: WWRobo
prev: overview
next: faq
---
```

| Field         | Effect                                |
| ------------- | ------------------------------------- |
| `title`       | Page heading and navigation label.    |
| `description` | Shown on cards and in search results. |
| `order`       | Sort position within its section.     |
| `author`      | Shown in the document header.         |     | `prev`/`next` | Previous/next links shown below the page (path or name). |

A file named `index.md` inside a folder is shown automatically when that folder
is opened, instead of the selection panel. Because mdsvex compiles these pages,
a `.md` file may also include a `<script>` block, import Svelte components and
run TypeScript — see `src/content/robots/simulation.md` for an embedded
simulation.

Markdown files fetched from the API support the same frontmatter, and fenced
code blocks are syntax-highlighted whenever a language is given. Pasting an
image into the editor embeds it inline as a `data:` URL rather than creating a
separate file reference.

Pressing Enter in the editor's **New file** field creates the file immediately.

### Editor permissions

Editors are listed per team in the environment; changes apply on the next
request, with no re-login. `ADMINS` can edit every team.

| Env var         | Team             |
| --------------- | ---------------- |
| `KUNAI_EDITORS` | `KUNAI`          |
| `ATL_EDITORS`   | `ATLATL`         |
| `HUNGA_EDITORS` | `HUNGA MUNGA`    |
| `SLING_EDITORS` | `SLINGSHOT`      |
| `ADMINS`        | all of the above |

Each value is a comma-separated list of Google account emails. A request may
only touch the team named in the first path segment, and every editor action
re-checks the permission server-side.

## Content structure

All content lives under the root Drive folder ("wiki" by default), organized per
team:

```
ROOT/
├── KUNAI/        (aliases: kunai)
├── ATLATL/       (aliases: atl)
├── HUNGA MUNGA/  (aliases: hunga, hunga-munga)
└── SLINGSHOT/    (aliases: sling)
```

- **GET paths** are full paths relative to the root, e.g. `KUNAI/logs/match.md`
- **POST bodies never contain a full path** — they carry `team` plus a path
  relative to that team's folder; the server reconstructs the full path
- Extensionless names get `.md` appended; `..` and characters like `<>:"|?*`
  are rejected

## Responses

Every response is JSON — `{ "ok": true, ... }` or `{ "ok": false, "error": ... }`.
Apps Script always answers HTTP 200, so callers **must check `ok`**.

```json
{ "ok": false, "error": "Not found: KUNAI/logs/typo.md" }
```

## GET (public — no key)

| Request                             | Returns                                                               |
| ----------------------------------- | --------------------------------------------------------------------- |
| `?action=tree[&path=sub/folder]`    | Nested tree: `name`, `path`, `type`, `id`, `modifiedTime`, `children` |
| `?action=list[&path=sub/folder]`    | Flat list of file entries (same fields)                               |
| `?action=read&path=KUNAI/logs/x.md` | `content` (UTF-8) plus `path`, `name`, `id`, `modifiedTime`           |
| `?action=ping`                      | Health check (`now`)                                                  |

`action` defaults to `tree`. Trees are sorted folders-first, then
alphabetically, and are capped 12 levels deep. `read` on a folder name is an
error; `read?path=KUNAI/logs/x` also finds `KUNAI/logs/x.md`.

## POST (key required)

Send JSON with `action`, `key`, `team`, and path fields. The key may go in the
body or as `?key=`.

| Body                                                | Effect                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `{ "action": "write", "team", "path", "content" }`  | Create/overwrite a file; missing parent folders are created                        |
| `{ "action": "mkdir", "team", "path" }`             | Create a folder (idempotent); path may be omitted to create the team folder itself |
| `{ "action": "rename", "team", "path", "newPath" }` | Rename or move within the same team                                                |
| `{ "action": "delete", "team", "path" }`            | Move a file/folder (recursively) to the Drive trash                                |

Example:

```sh
curl -X POST "$GAS_API_URL" -H 'Content-Type: application/json' \
  -d '{"key":"...","action":"write","team":"KUNAI","path":"logs/match.md","content":"# Match log"}'
```

### Teams

`team` is required on every POST. Matching is case-insensitive and ignores
spaces/underscores/hyphens:

| Folder created | Accepted values                                |
| -------------- | ---------------------------------------------- |
| `KUNAI`        | `KUNAI`, `kunai`                               |
| `ATLATL`       | `ATLATL`, `ATL`, `atl`                         |
| `HUNGA MUNGA`  | `HUNGA MUNGA`, `hunga-munga`, `HUNGA`, `hunga` |
| `SLINGSHOT`    | `SLINGSHOT`, `SLING`, `sling`                  |

### Rules and guard rails

- The full path is reconstructed server-side (`team` + `/` + `path`), so a
  request can never address another team's folder
- `write` and `mkdir` create missing parent folders (including the team folder)
- `delete` and `rename` refuse to target a team's root folder
- `rename` stays within one team; renaming a file to an extensionless name
  appends `.md`; identical source/destination is a no-op
- `..` segments, empty paths where a name is required, and characters
  `< > : " \ | ? *` are rejected with a descriptive error
- Deletes go to the Drive trash (recoverable for ~30 days)

## Script properties

Set in the Apps Script editor → **Project Settings → Script Properties**.

| Property                | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `GAS_API_KEY`           | Shared secret required by every POST — must equal the site's `GAS_API_KEY` env var |
| `WIKI_ROOT_FOLDER_ID`   | Root folder id; created and cached automatically by `setup()`/first call           |
| `WIKI_ROOT_FOLDER_NAME` | Name used when auto-creating the root (default `wiki`)                             |

## Setup and deployment

1. `bun run gas:build` type-checks `appscript/Code.ts` and compiles it to
   `appscript/Code.js` — clasp does **not** transpile TypeScript itself.
2. `bun run gas:push` uploads the code.
3. Run `setup()` once in the Apps Script editor: creates the root folder, the
   four team folders, and generates `GAS_API_KEY` if unset. Its value must
   match `GAS_API_KEY` in `.env`.
4. Deploy → New deployment → **Web app** with _Execute as: Me_ and
   _Access: Anyone_, then copy the `/exec` URL into `.env` as `GAS_API_URL`.
   This step is only for the **first** deployment.
5. Subsequent deployments: `bun run gas:deploy` (build + push + update the same
   deployment) — the URL in `.env` never changes. Supports `--dry-run`.

### Scripts

| Script               | What it does                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun run gas:build`  | Type-check + compile `appscript/Code.ts` → `appscript/Code.js`                                         |
| `bun run gas:push`   | Build, then `clasp push` from `appscript/`                                                             |
| `bun run gas:deploy` | Build + `clasp push` + update the **existing** web-app deployment (`-i`) — keeps the `/exec` URL valid |

## Security notes

- Reads are public because the wiki is public; **every POST requires the key**
  (compared in constant time)
- The key travels only server-to-server (SvelteKit proxy → Apps Script); it is
  never shipped to the browser
- All lookups walk down from the root folder by name — no Drive file IDs are
  accepted from clients, so requests cannot escape the wiki root
- Apps Script quota: each request costs a handful of Drive API calls; fine for
  human-paced wiki traffic
