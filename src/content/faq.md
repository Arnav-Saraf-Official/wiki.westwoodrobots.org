---
title: FAQ
description: Short answers to the questions we hear most.
order: 3
---

# FAQ

## Who can edit?

Only accounts listed as editors for a team in the site configuration, plus
administrators. Everyone else can read everything.

## How do I add a wiki page?

Add a `.md` file under `src/content/`. Folders become sections automatically.
Frontmatter is optional:

```markdown
---
title: My page
description: One line shown on cards.
order: 4
---

# My page
```

## How do I add a log page?

Sign in, open the Editor, and use **New page**. Log content lives in Google
Drive, not in this repository.

## A log page vanished!

Deletes move items to the Drive trash, where they stay recoverable for about 30
days. Ask an administrator to restore it.

## Why does the wiki need an API key?

The Apps Script backend accepts writes only with a shared secret, and the secret
is held on the server. It is never sent to the browser.
