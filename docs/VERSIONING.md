# Versioning

Three things have to agree, or the Versions page starts lying:

| Thing | Where | What it is |
|---|---|---|
| The tag | `git tag -a vX.Y.Z` | The commit that shipped |
| The entry | [`src/lib/releases.ts`](../src/lib/releases.ts) | What the app shows |
| The build | `public/v/X.Y.Z/` | A running copy you can open (git-ignored; rebuilt from the tag) |

[`CHANGELOG.md`](../CHANGELOG.md) mirrors the entries in prose. `releases.ts` is
the source of truth for the UI; the changelog is the source of truth for humans
reading the repo.

## Why archived builds rather than screenshots

The Versions page hands you the running thing. Screenshots go stale silently —
they keep looking authoritative long after the code moved. A build cannot.

Archived versions talk to the **same Supabase project** as the current one, so
they are old interfaces onto current data, not snapshots of old data. Open v1.0.0
and you will see today's tasks in last month's UI. That is the intent: it makes
the archive useful for "was this easier before?", not just nostalgic.

## Cutting a release

```bash
# 1. bump package.json "version" — archive-all reads it to know what is current

# 2. tag the commit that ships
git tag -a v2.2.0 -m "v2.2.0 — <one line>"

# 3. add the entry to src/lib/releases.ts
#    - new release:  current: true,  archived: false
#    - previous one: drop `current`, set archived: true

# 4. mirror it into CHANGELOG.md

# 5. ship — `npm run build` archives every past tag first
npm run build
npx wrangler deploy
git push origin main --follow-tags
```

`archived: true` is a claim that a directory exists. Do not set it hopefully — a
Versions page offering a dead link is worse than one that says "current". The
build archives every tag except the current one automatically, so the honest
value is "true for everything below the top entry".

Archives are **not committed**. `npm run archives` (which `npm run build` calls)
rebuilds any that are missing and skips the rest, so a fresh clone with tags
produces a complete Versions page and a shallow clone without tags degrades to
source links rather than dead ones.

## How the archive script works

[`scripts/archive-version.mjs`](../scripts/archive-version.mjs) checks the tag out
into a detached worktree under `.archive/`, builds it with
`--base=/v/<version>/`, and writes the result into `public/`, where Vite copies it
verbatim into `dist/` on the next build.

Three details that are load-bearing:

- **The worktree lives inside the repo.** Node then resolves bare imports up to
  the project's own `node_modules`, so archiving a version costs no second install.

- **Vite is spawned with an argument array and no shell.** Passing
  `--base=/v/2.0.0/` through a shell on Windows lets MSYS rewrite the leading
  slash into a drive path; the built HTML then points at `/2.0.0/` instead.
  Nothing errors — the archived page just silently loads nothing. This was
  observed, not theorised.

- **The archive is pruned** of `explorations/` and any nested `v/`. A version
  should not carry its own archives, and duplicating the prototype lab per
  release would add ~600KB each time for nothing.

The build bakes `VITE_*` in, so the script copies `.env` into the worktree. An
archive built without it ships pointing at no backend.

## Cost

Roughly 1MB per archived version, served as static assets. At that rate the whole
history stays affordable for a long time; if it ever stops being, drop the
`archived` flag on the oldest entries and delete their directories — the page
degrades to a changelog entry with a source link, which is still true.
