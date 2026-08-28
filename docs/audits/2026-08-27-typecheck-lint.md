# Type safety, lint, and the pre-commit gate — 2026-08-27

**Status** RESOLVED — this is a build-and-tooling change. Nothing in it ships
to `pt.anteneh.tech`; `eslint.config.js`, `.githooks/`, `tsconfig.json` and the
`scripts` block of `package.json` have no representation in `dist/`. See
[§7](#7-on-publishing-this-before-a-deploy) for why it is published anyway,
which is a departure from the rule in `docs/audits/README.md`.

**Scope** — the mechanical checks that run over this repository, and nothing
else. `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`
(new), `.githooks/` (new), `docs/audits/baselines/lint.json` (new). One line of
`src/` was changed, because the linter found a real bug in it; that is
[§4](#4-the-one-source-change).

**Standard** — there is no external standard for "does anything read this code
before it ships". The bar used here is the one in `docs/audits/README.md`: a
gate ships with its baseline committed in the same change, and the baseline is
today's real number, not zero.

---

## 1. What was measured, and the numbers

| Measure | Before | After |
|---|---:|---:|
| Type errors that can fail a build | **0 possible** (`tsc -b --noCheck`) | all of them (`tsc -b`) |
| `tsc --noEmit` errors | 0 | 0 |
| Linters configured | 0 | 1 (ESLint 9 flat config) |
| ESLint errors, whole repo | n/a | **12** |
| ESLint warnings, whole repo | n/a | **15** |
| Files with any finding (of 30 linted) | n/a | 10 |
| Git hooks | 0 | 1 (`pre-commit`) |
| CI | none | still none |

`--noCheck` was the load-bearing finding. It tells `tsc` to parse the types and
discard the result, so for the life of this project `"strict": true` has been a
comment. It arrived in the first commit (`735d317`, "Project Tracker —
standalone app") with no note explaining it, alongside the rest of the Vite
React-TS template — it was scaffolding inertia, not a decision, so there was
nothing to preserve. It is gone. `npm run build` now typechecks for real and
still succeeds (14.3s total, of which `tsc -b` is ~3.5s).

**12 errors / 15 warnings is the committed baseline**, recorded per file in
`docs/audits/baselines/lint.json`. The gate compares against those numbers, not
against zero. See [§3](#3-the-gate).

The 12 errors break down as:

| Rule | Count | Disposition |
|---|---:|---|
| `jsx-a11y/*` (5 distinct rules) | 7 | Real. Baselined — see below. |
| `@typescript-eslint/no-unused-vars` | 3 | Dead imports and a dead helper in `Workboard.tsx`. Baselined. |
| `@typescript-eslint/no-unused-expressions` | 1 | `ErrorBoundary.tsx:96`, a deliberate `?.…() ?? fallback` statement. Baselined. |
| `@typescript-eslint/no-unused-vars` (other) | 1 | |

The seven a11y errors are all in the two drag-and-tile surfaces
(`Workboard.tsx`, `DashboardScene.tsx`): `div`s carrying pointer handlers and
`tabIndex` for pane resizing and window dragging. Fixing them properly means
designing keyboard equivalents for dragging and tiling, which is an
accessibility audit, not a lint pass. Baselined here so a *new* one fails,
and handed forward as the obvious next audit.

The 15 warnings are 11 `react-refresh/only-export-components` (a
develop-time HMR papercut, not a shipped defect), 3 `react-hooks/exhaustive-deps`,
and 1 `no-explicit-any`.

---

## 2. tsconfig tightenings, measured one at a time

Each flag was enabled alone, against the unmodified project, then turned back
off. **None of them is at zero, so none was adopted.** Turning any of them on
today would break `npm run build`, which is now a real gate — and a gate that
is broken on the day it ships is the failure mode `docs/audits/README.md`
warns about, one level up.

| Flag | Errors | Verdict |
|---|---:|---|
| `noUncheckedIndexedAccess` | **45** | Defer. This is the big one and it is genuine: the codebase indexes records and arrays constantly (`geoRef.current[id]`, `PANELS[id]`, `list[0]`). Concentrated in `Workboard.tsx` (9), `shared.tsx` (7), `DashboardScene.tsx` (5), then 2–4 each across `store.ts`, `order.ts`, `insights.ts`, `pickers.tsx`, `CreateTaskDialog.tsx`, `TaskDialog.tsx`, `ProjectDialog.tsx`. Worth doing as its own change; not worth smuggling into a tooling commit. |
| `exactOptionalPropertyTypes` | **5** | Defer, but this is the cheapest win available. All five are the same shape: a `Project \| undefined` or `string \| undefined` passed to a prop declared `project?:` / `hint?:`. `AuthScene.tsx:119`, `DashboardScene.tsx:1682, 1819, 1837, 1878`. Fixing means widening four prop types to accept `undefined` explicitly. |
| `noUnusedLocals` | **2** | Defer — but only because ESLint already covers it. `Workboard.tsx:1` (`useMemo`), `Workboard.tsx:4` (`Task`). |
| `noUnusedParameters` | **1** | Defer, same reason. `DashboardScene.tsx:712` (`w`). |
| All four together | 53 | |

On the two unused-* flags specifically: they stay off in `tsconfig.json` **on
purpose, not merely because they are non-zero**. `tsc` has no escape hatch for
an intentionally-unused local, whereas ESLint's `no-unused-vars` is configured
here with `argsIgnorePattern: '^_'` and friends. Owning the rule in one place,
the place that can express the exception, is better than owning it in two.
The three findings are identical either way.

**Ratchet targets, in the order they should be taken:**
`noUnusedLocals`/`noUnusedParameters` (3 findings, mechanical) →
`exactOptionalPropertyTypes` (5, one afternoon) →
`noUncheckedIndexedAccess` (45, a real project).

---

## 3. The gate

`.githooks/pre-commit.mjs`, wired through `simple-git-hooks`. Two stages:

1. **`tsc -b` over the whole project — hard gate, no baseline.** Per-file
   typechecking does not exist; a change in `store.ts` breaks a caller in
   `DashboardScene.tsx` that is not staged. The project is at zero and must
   stay there.
2. **ESLint over the staged files only — ratcheted.** Each file's error and
   warning counts are compared against `docs/audits/baselines/lint.json`. A
   commit fails only when a staged file gets *worse* than its recorded number.
   New files start at 0/0.

When a staged file gets *better*, the hook rewrites its baseline entry down and
`git add`s the baseline into the same commit. That matters: a ratchet that only
tightens when somebody remembers to tighten it does not tighten. It never
raises a number — raising one is a manual, visible act, which is what it should
be.

**Timings measured on this machine** (Windows 10, Node 24.15):

| Attempt | Result | Wall clock |
|---|---|---:|
| Type error staged (`string` into `number`) | **REFUSED** at stage 1, `tsc` output shown | 3.2s |
| Lint regression staged (unused var in `eslint.config.js`) | **REFUSED**, with rule, line and before/after counts | 5.2s |
| The real commit of this change (7 files, cold ESLint cache, `store.ts` forcing a full `tsc` rebuild) | **PASSED** | 9.8s |
| Steady state, warm: `tsc -b` 3.0s + cached ESLint over 3 files 2.0s | | ~5.2s |

Type-error commits fail faster because stage 1 short-circuits stage 2.

**The honest verdict on the budget: it is met in the normal case and missed on
a cold cache.** The target was ~5s; the typical commit lands at ~5s and the
worst observed was 9.8s, which is uncomfortable. Two things already bought what
was buyable. Both tools are spawned as `node <entrypoint>` rather than through
`npx`, which on Windows costs about a second of resolution per call — an
earlier draft using `npx` measured 7.9s on the *5.2s* case — and ESLint runs
with `--cache` under `node_modules/.cache/`. What remains is `tsc` itself:
3.0s to check ~9,500 lines against React and `@types/three`, and that is a
floor, not an overhead. If this hook ever starts getting bypassed, the honest
fix is to move `tsc` to a pre-push hook and leave lint at pre-commit, not to
weaken either. Noted here so that decision gets made deliberately rather than
by way of `--no-verify` becoming muscle memory.

### Why `simple-git-hooks`, not husky or lefthook

husky is out because it installs a `.husky/` directory of shell shims and a
`prepare` script, and its whole value proposition — sharing hooks across a team
— is worth nothing to a single maintainer on a single machine. lefthook is a
better tool than either at what it does (parallel jobs, a config language for
file globs), but it ships a Go binary per platform and its config would be a
third place where "which files are linted" is written down, after
`eslint.config.js` and the hook itself. `simple-git-hooks` is a dependency-free
package whose entire job is to write one line into `.git/hooks/pre-commit`, and
the logic lives in ordinary JavaScript that can be read and debugged.

**Known weakness, stated plainly:** `.git/hooks/` is not cloned or restored by
`npm ci`, and this project's npm has install scripts blocked
(`npm warn install-scripts … simple-git-hooks@2.13.1 (postinstall)`), so the
usual auto-install does not fire. **After any fresh clone or a
`rm -rf node_modules && npm ci`, run `npm run hooks`.** A missing hook is the
worst failure mode in this document, because it is indistinguishable from a
passing one.

---

## 4. The one source change

`src/lib/store.ts:163`, in `humanError()`, contained this:

```
/…|not authori[sz]ed|<U+0008>JWT<U+0008>|token is expired/i
```

Two **literal backspace bytes** (`0x08`) where `\b` word-boundary escapes were
intended — the classic result of a tool or paste that interpreted the escape
before the file was written. The alternative `\x08JWT\x08` cannot match any
string a server would ever send, so a JWT-expiry error fell through to the
generic fallback message instead of "Your session has expired, or that is not
yours to change. Sign out and back in." — which is the one message in that
function that tells the user what to actually *do*.

Found by `no-control-regex`, from `eslint:recommended`. Fixed by writing the
two escapes correctly. That is the whole change: one line, no reformatting.
Nothing else in `src/` was touched, and a repo-wide scan for other `0x08` bytes
in tracked source came back clean.

---

## 5. What was accepted, and why

**No `--fix`, and no formatter.** `--fix` was run zero times. The comments and
formatting in this codebase are authored — `scripts/preview.mjs` and
`src/components/ErrorBoundary.tsx` are written to be read — and a formatter or
a stylistic ruleset would rewrite roughly 9,500 lines to match a default that
nobody chose. Where existing style collided with a rule, **the rule was
configured to the code**, not the other way round:

- `no-empty` → `{ allowEmptyCatch: true }`. `try { unlinkSync(f) } catch {}` in
  `scripts/backup.mjs` is the intended shape; the file already being gone is
  the same outcome as deleting it. This removed 3 errors that were not defects.
- `@typescript-eslint/no-unused-vars` → `^_` ignore patterns for args, vars,
  caught errors and array destructuring.
- `@typescript-eslint/no-explicit-any` → `warn`. Every `any` here is at a
  boundary the types do not reach (WebGL uniforms, Supabase row shapes).

`lint:fix` exists as a script for deliberate use. It is not wired into the hook.

**No type-aware linting.** `tseslint.configs.recommendedTypeChecked` is the
better ruleset and it was rejected on cost: it rebuilds the TS program on every
run, ~9s against ~2s, on top of the `tsc` the hook already pays for. That is
the entire time budget, twice. What is actually lost is the
`no-floating-promises` / `no-misused-promises` / `no-unnecessary-condition`
family — genuinely useful rules in a codebase that awaits Supabase calls in
event handlers. Recorded as a ratchet target: if CI ever exists, turn it on
there, where nobody is waiting.

**No React Compiler rules.** `eslint-plugin-react-hooks` v7's
`recommended-latest` preset now includes the compiler rule set (`purity`,
`immutability`, `preserve-manual-memoization`, `set-state-in-effect`, …). Only
the classic `rules-of-hooks` and `exhaustive-deps` are on. The compiler rules
report on working code in order to make an optimiser that is not enabled here
able to run; adopting them means either a large permanently-yellow baseline or
edits across most of `src/`. That is a separate decision about whether to adopt
React Compiler at all.

**ESLint 9, not 10.** ESLint 10.9.1 is current and npm now marks 9.39.5 as
maintenance-only. `typescript-eslint` 8.68's peer range does not cover ESLint 10.
Staying on the supported-together pair was the right call for a first
installation; revisit when `typescript-eslint` 9 lands.

---

## 6. What this run could not check

- **Everything about running code.** This is entirely static. Nothing here
  executes the app, so nothing here can tell you whether the JWT-expiry message
  fixed in §4 now actually appears — it was verified by reading the regex, not
  by expiring a token. There are **no tests in this repository**, and no test
  runner; that gap is bigger than anything measured above and this audit did
  not touch it.
- **Whether the gate survives contact.** The hook was proven against two
  synthetic failures and one real commit, all within an hour, by the person who
  wrote it. Whether it is still installed and un-bypassed in a month is the
  actual question and cannot be answered today.
- **The 45 `noUncheckedIndexedAccess` findings were counted, not read.** Some
  are certainly guarded by logic `tsc` cannot see. The number is a size
  estimate, not a defect count.
- **`skipLibCheck: true` is still on**, so nothing in `node_modules/@types` was
  checked. It was left on deliberately (`@types/three` alone is enormous) but
  it means the type gate is a gate on this repository's code, not on its
  dependencies' declarations.
- **Supabase Edge Functions / `supabase/` are excluded** from both the lint
  config and `tsconfig.json`'s `include`. They are unchecked by anything here.
- **One dev-only advisory is open and was not fixed**, because dependency
  scope belongs to a concurrent audit: `nanoid <3.3.18`, GHSA-2v37-7h3g-55p8,
  high. `npm audit --omit=dev` reports **0 vulnerabilities**, so it does not
  reach the shipped bundle.
- **Timings are from one machine**, one disk, one Node version. Nothing here
  says what the hook costs on a laptop under battery-saver.
- **`npm ci` was verified** (11.3s, lockfile resolves, `typecheck` and `lint`
  both still run afterwards, and the hook survives because it lives in
  `.git/hooks/`). What was *not* verified is a genuinely fresh `git clone`,
  where `.git/hooks/` is empty and `npm run hooks` has never been run.

---

## 7. On publishing this before a deploy

`docs/audits/README.md` says a report moves out of `.audit/` only when its fix
is *deployed*, because a live finding published in a public repo is an
attacker's to-do list. That rule is about exploitability, and this report has
nothing exploitable in it. The tooling described here has no deployed form at
all — `eslint.config.js` and a git hook run on one laptop and never reach
`dist/`. The single behavioural change (§4) turns a *worse* error message into
a *better* one; describing it in public tells an attacker nothing they could
not learn by reading `humanError()` in the bundle.

The a11y and `noUncheckedIndexedAccess` counts in §1 and §2 are the closest
thing here to live findings, and they are counts and file names, not exploit
paths — they are exactly the "number, so the next run is a comparison" the
README asks each report to record. Published deliberately, on that reading.

---

## 8. Files

| Path | |
|---|---|
| `eslint.config.js` | new — flat config, ESLint 9 |
| `.githooks/pre-commit.mjs` | new — the gate |
| `docs/audits/baselines/lint.json` | new — the committed baseline, per file |
| `package.json` | `build` drops `--noCheck`; adds `typecheck`, `lint`, `lint:fix`, `hooks`; `simple-git-hooks` block |
| `src/lib/store.ts` | one line — §4 |

Packages added, all `devDependencies`: `eslint`, `typescript-eslint`,
`eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`,
`eslint-plugin-react-refresh`, `globals`, `simple-git-hooks`.

**Commands.** `npm run typecheck` · `npm run lint` · `npm run hooks`
(re-install the git hook after a fresh clone or `npm ci`).
