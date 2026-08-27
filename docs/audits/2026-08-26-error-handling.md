# Error handling and observability — 2026-08-26

**Status** RESOLVED — deployed to pt.anteneh.tech 2026-08-26, version `4227d0a6`.

**Scope** — `src/` only. Error surfacing, error containment, and error
recording across the whole client. No backend, schema or RLS work; that is
`2026-08-25-rls-correctness.md`.

**Standard** — OWASP Top 10:2025 **A09 Security Logging and Alerting Failures**
and **A10 Mishandling of Exceptional Conditions**. Fallback colour contrast is
measured against **WCAG 2.2 AA**, 4.5:1 for body text.

---

## 1. The finding, restated with numbers

| Measure | Before | After |
|---|---:|---:|
| React error boundaries in the tree | 0 | 2 |
| `window` error listeners | 0 | 1 |
| `unhandledrejection` listeners | 0 | 1 |
| Places an uncaught error is recorded | 0 | 1 (`deliver`, one function) |
| Lines of TSX under a bare `<Suspense>` with no error fallback | ~2,500 (`DashboardScene`) | 0 |
| Console statements in ~10,000 lines | 1 (`console.warn`, `seedIfEmpty`) | 1 — unchanged, deliberately |

Before this run, any throw during render unmounted the React tree to an empty
`<div id="root">`. There was no boundary, no global handler, and nothing that
recorded the event, so the maintainer's first signal was opening the site and
finding it broken. That is both halves of A09 and A10 at once: the exceptional
condition is not handled *and* it is not observed.

---

## 2. What was built

### `src/lib/report.ts` — the reporting seam (new)

All three error paths funnel into one function. No SDK, no npm dependency, no
network call today.

```
render phase       → ErrorBoundary.componentDidCatch ─┐
event handlers,    → window 'error' listener          ├→ reportError() → deliver()
timers, module init                                   │
rejected promises  → window 'unhandledrejection'     ─┘
```

`buildReport()` is deliberately *outside* the flag gate, because the fallback's
"copy error detail" button uses it and must keep working when reporting is off.

### `src/components/ErrorBoundary.tsx` — the boundary (new)

A class component; `componentDidCatch` and `getDerivedStateFromError` have no
hook equivalent. It is the only class in the codebase.

The fallback imports **nothing from the app but `report.ts`** — no icon
library, no `cn`, no store, no toast. Anything it imported would be another
candidate for the thing that put it on screen. It contains **no literal
colours**; every value is a design token, so it inherits whichever of the 22
palettes is live, including any added later.

### Placement, and why

Two boundaries, not one:

1. **`src/main.tsx`, `<ErrorBoundary full>` around `<App/>` and `<ToastPortal/>`.**
   The last line of defence. It wraps the toast portal too — a crash in the
   portal would otherwise take the whole app with it, and the portal is not
   more important than the app. Renders a centred full-viewport panel, because
   at this level there is no surviving chrome for an inline panel to sit in.

2. **`src/scenes/DashboardScene.tsx`, inside `<main>`, around the view switch.**
   Placed *inside* main rather than around the scene so that a crashing view
   leaves the **sidebar and top bar standing**. That changes the recovery from
   "reload and hope" to "click another view, or sign out" — the shell is the
   way out. Keyed on `view`, because a boundary that has caught stays caught:
   without the key, navigating away from a broken view would keep showing that
   view's fallback over the new view's content. With it, leaving the view *is*
   the recovery, which is what the evidence in §4 shows.

`App.tsx`'s `<Suspense>` was deliberately **not** given a third boundary. The
only error it can produce is a failed lazy chunk fetch, and React caches the
rejected import promise — a "Try again" there would re-read the cached
rejection and fail identically, so it would be a button that lies. The root
boundary's "Reload the page" is the honest remedy, and it already covers it.

### Feature flag

`ENHANCEMENTS.errorReporting` in `src/lib/enhancements.ts`, following the
existing `as const` convention so Rollup folds the flag to a literal and drops
the dead branch. Verified in §5: with the flag `false`, the string
`unhandledrejection` does not appear in any built chunk.

---

## 3. The redaction rule

**Collection is an allowlist, not a filter.** The only fields ever read are:

```
source · name · message · stack · componentStack · at · path · userAgent · mode
```

Nothing in `report.ts` touches `localStorage`, `sessionStorage`, `cookie`,
component props or component state. `location` is read for `pathname` **only**
— never `search` or `hash`, which is where an id or token would sit if one ever
reached a URL.

Two things must never leave the device:

- **User content.** Task titles, project names and note bodies.
- **The session.** The Supabase access token in `localStorage` under
  `project-tracker-auth`.

The allowlist handles the second entirely. The first can still arrive
uninvited through the two free-text fields, because `store.ts` rethrows
PostgREST messages verbatim and a constraint violation reads
`Key (name)=(Q3 layoffs) already exists`. So `message` and `stack` are passed
through `scrub()`, which replaces, in this order:

| Pattern | Becomes |
|---|---|
| JWT-shaped triples (`eyJ….….…`) | `[token]` |
| any base64url run of 40+ chars | `[token]` |
| email addresses | `[email]` |
| `Key (col)=(value)` — column kept, value dropped | `Key (col)=([redacted])` |
| anything in `"…"`, `'…'`, `` `…` `` or typographic quotes | `[redacted]` |
| everything after `?` or `#` in a URL | `[redacted]` |

Then truncated: 400 chars for `message`, 2000 for `stack`, 1500 for
`componentStack`.

Two properties of this design are load-bearing:

- **It runs on the way IN.** The unredacted string is never assigned to the
  report object, so there is no field a later edit can accidentally begin
  sending.
- **It over-redacts on purpose.** Everything this app quotes in a message is a
  title or a name, so quoted spans go unconditionally. A scrubber tuned to
  preserve diagnostic value fails open the first time a backend phrases
  something nobody anticipated; the unredacted original is still in the
  browser console, which is where a maintainer actually looks.

The **clipboard payload is the same redacted record**. What a person pastes
into a public issue tracker has to be safe to paste, and the fallback's live
region says so: *"Copied. It contains no task or note text."*

---

## 4. Evidence — every path actually triggered

Against `npm run preview:demo` (env cleared, `dist-demo/` verified free of live
credentials by the build's own scan), signed in as a seeded demo account with a
project named **"Q3 layoffs"**, a task titled **"Confidential task title"**, a
note body **"private note body"**, and a JWT-shaped value planted in
`localStorage['project-tracker-auth']`.

Instrumentation used (temporary, since removed — see §7): a probe throw behind
a `window` flag, and a push-to-array inside `deliver()`.

### 4.1 Render throw, inside the dashboard

Clicked **Versions** in the sidebar with a `TypeError` armed in `VersionsView`.

**What the user saw:** the sidebar and top bar stayed exactly as they were,
"Versions" still highlighted, and the main pane was replaced by a bordered
panel with a cast shadow reading *"This part of the page stopped working."* /
*"This is a display problem — nothing you had saved was changed or lost. Try
again, or reload the page."* and three buttons: **Try again**, **Reload the
page**, **Copy error detail**. No stack trace on screen.

**Recorded:**
```
source=render  name=TypeError
message=Cannot read properties of undefined (reading name) in "[redacted]"
componentStack= at Oa (…/DashboardScene-Vl6yIi3a.js:738:4105) at div at uo …
```
Project name redacted. Console still carried the *unredacted* original
(`… in "Q3 layoffs"`) — the device keeps the truth, the payload does not.

**Retry cap:** clicked *Try again* → crashed again, buttons unchanged.
Clicked again → `attempts === 2`, **Try again disappeared** and the copy
changed to *"Reloading the page should clear it."* This is the loop guard: a
deterministic crash returns immediately, and offering the button a third time
would be offering an infinite loop.

**Recovery:** clicked **List** in the surviving sidebar → boundary remounted on
the new `view` key, List rendered normally (`Q3 layoffs · 0 of 1 done …`). No
reload needed. This is the whole reason the boundary is inside `<main>`.

### 4.2 Render throw, above the inner boundary (root boundary)

Armed a throw in `TopBar`, which sits outside the inner boundary.

**What the user saw:** instead of the previous blank page — a centred panel on
the page background reading *"Project Tracker could not be displayed."* with
the same three controls. Screenshot: `root-dark.png`.

### 4.3 Event-handler throw

A real button with `onclick = () => { throw new Error(…) }`, clicked.

**What the user saw:** nothing. Correct — the UI was not broken, only one
handler failed, and inventing a full-screen error for that would be worse than
the bug. **Recorded:**
```
source=window.error  name=Error
message=Event handler threw while saving "[redacted]"
```
Console still showed `Uncaught Error: Event handler threw while saving
"Confidential task title"`. Nothing suppressed.

### 4.4 Un-awaited rejected promise

`Promise.reject(new Error('Rejected: token eyJ… for user probe@example.com, Key (name)=(Q3 layoffs) already exists'))`

**What the user saw:** nothing, as above. **Recorded:**
```
source=unhandledrejection  name=Error
message=Rejected: token [token] for user [email], Key (name)=([redacted]) already exists
```
All three redaction classes fired in one string. Console kept the original.

### 4.5 Leak scan across all captured reports

```
keys present : source name message stack componentStack at path userAgent mode
searched for : "Confidential task title", "private note body", "Q3 layoffs",
               "eyJhbGciOiJIUzI1NiJ9", "probe@example.com", "audit_probe",
               "project-tracker-auth"
leaks found  : 0
```

---

## 5. Verification results

### 5.1 Types

`npx tsc --noEmit` — clean, on every intermediate state and on the final tree.

### 5.2 Contrast — all 22 palettes, WCAG 2.2 AA

Measured live via `getComputedStyle` on the rendered fallback, cycling
`data-theme` × `data-mode`, with transitions suppressed (an early run sampled
mid-transition and produced meaningless interpolated colours — recorded here so
the next run does not repeat the mistake).

| | Worst of 22 | Where | AA (4.5:1) |
|---|---:|---|---|
| Body text (`--color-muted` on `--color-surface`) | **4.91:1** | terminal / dark | pass |
| Heading (`--color-foreground` on `--color-surface`) | **14.21:1** | clay / dark | pass |
| Button label (`--color-foreground` on `--color-surface-2`) | **12.75:1** | clay / dark | pass |

Named examples: **original / dark** body 5.79:1, heading 16.46:1, button
15.67:1. **paper / light** body 5.44:1, heading 18.51:1, button 15.69:1.
Screenshots: `render-dark.png` (original/dark), `render-light.png`
(paper/light) — cream surface, correct cast shadow, no colour drift.

`pane-cast` resolves correctly in both directions: `rgb(26,26,36) 2px 2px 0` in
dark (edge catches light), `rgba(0,0,0,0.14) 2px 2px 0` in light (a real cast).

**All three buttons use the same neutral treatment on purpose.** A brand-filled
primary was tried and rejected: `--color-brand` is chosen per family for accent
contrast against the surface, not for the legibility of text sitting *on* it,
and foreground-on-brand is not reliably readable in the lighter families
(Orchid's acid green, Terminal's phosphor). Emphasis comes from order.

### 5.3 Keyboard

All three controls are native `<button>`, `tabIndex=0`, none disabled, in
reading order. Tabbed with real key events: focus advanced Try again → Reload
the page → Copy error detail; `:focus-visible` matched and the global 2px
`--color-brand` outline from `src/index.css` painted
(`outlineColor: rgb(124,92,255)`, solid, offset 2px). No local focus override —
one fewer thing to keep correct across 22 palettes.

Activating **Copy error detail** set the `aria-live="polite"` region to
*"Copied. It contains no task or note text."* The clipboard-unavailable branch
(non-secure context / permissions policy) falls through to a readonly,
`aria-label`led `<textarea>` that selects on focus.

### 5.4 Idempotence

Install is guarded by a marker on `window`, not a module-level `let`. A local
flag would reset on a Vite HMR module re-execution while the previously
registered listeners were still attached, so every error would be reported
twice, then four times, for the rest of the dev session. StrictMode's
double-invocation is covered by the same guard.

### 5.5 Flag off — the important one

Rebuilt with `errorReporting: false`:

| Check | Result |
|---|---|
| `unhandledrejection` present in any built chunk | **no** — dead-code-eliminated |
| `__ptErrorHandlersInstalled` set at runtime | **no** — handlers never installed |
| `deliver()` reached | **never** |
| **Boundary still catches a render throw** | **yes** |
| Fallback still renders, shell still survives | **yes** |
| **Copy error detail still works** | **yes** — same live-region confirmation |
| Browser console output | untouched (nothing was ever wrapped) |

A crash is never worse because telemetry is switched off. Flag restored to
`true`; the final build contains the handlers, and a clean load installs them
(`window.__ptErrorHandlersInstalled === true`) with no fallback on screen.

---

## 6. Assessment of the pre-existing error paths

`DashboardScene` has a `setError` banner used by every mutation. Judged
honestly:

### Fixed

**F1 — raw backend strings shown to the user (A09/A10).** `store.ts` did
`throw new Error(error.message)` in ten places with PostgREST's message
verbatim, and nine `catch` blocks in `DashboardScene` plus one in `AuthScene`
put it straight into the banner. A denied write read *"new row violates
row-level security policy for table \"tasks\""* — useless to the user and a
free disclosure of table and policy names to anyone at their shoulder. Offline,
the banner read *"Failed to fetch"*.

Fixed with `humanError(err, fallback)` in `store.ts`, applied at all ten call
sites. It **defaults to the caller's fallback** — unmatched messages are
dropped, not shown — and names only the two failures a user can act on
(no connection; expired session / not yours). `SAFE_MESSAGES` holds the strings
this module authored rather than relayed. Default-to-fallback is the safe
direction: the raw string is still in the console and in the copied detail.

**F2 — sign-out could strand the user.** `signOut()` cleared local device state
and *then* awaited `supabase.auth.signOut()`. Offline, that rejects; the
rejection propagated out of the sidebar's `onClick`, so `onSignOut()` was never
reached. The user stayed on the board, signed in to a session that had already
been half torn down, with nothing said. Now caught — the local sign-out is the
part that matters and has already happened. (This was also, before today, an
unhandled rejection that vanished entirely.)

### Reported, not fixed — deliberate and documented

- **`App.tsx` treats an unreachable backend as signed-out.** A total backend
  outage silently shows the marketing hero to a signed-in user. The comment
  says so, so it is a decision, not an oversight — but it is a decision worth
  revisiting, because "your account does not exist" and "the server is down"
  should not look identical.

### Reported, not fixed — real, but not low-risk to change here

- **`NotesView.commit` swallows a `localStorage` write failure silently**
  (`catch { /* no persistence available */ }`). The note stays on screen and
  reads as saved. Under quota pressure or in private mode this is silent user
  data loss with zero signal. Fixing it properly means an error surface inside
  the notes panel — real UI work, outside this run's remit.
- **`patch()` rolls back to a closed-over `tasks` snapshot.** Two mutations in
  flight and the failing one's rollback discards the other's result. A
  correctness bug in the error path, not an error-reporting bug; fixing it means
  moving to a functional rollback, which needs its own testing.
- **The schema-migration notice is rendered in the error banner.**
  `takeMigrationWarning()` returns `MIGRATION_PENDING` after a *successful*
  save, and it is passed to `setError`. Semantically a warning shown as an
  error, on a path where the write actually worked.
- **The banner is brand-tinted, not danger-tinted.** There is no error/danger
  token in the palette, so an error and a success are the same colour. Adding
  one is a design-token change across 22 palettes — correctly out of scope.

### Checked and found correct

`clearDeviceState`, `readNotes`, `loadDemo`/`saveDemo` and the `prefs` catches
all swallow deliberately, each with a comment naming why, and each degrades to
a safe state rather than throwing on first paint. The one `console.warn` in
`seedIfEmpty` is correct — a missing seed function is genuinely not fatal.
The banner is `role="alert"` with a real, keyboard-reachable Dismiss button.

---

## 7. What this run could NOT check

The most valuable line in the document, per `docs/audits/README.md`.

- **Nothing was tested against the real Supabase backend.** Every path was
  exercised against `preview:demo`, which is localStorage-backed. So the
  *shapes* of real PostgREST errors — the exact wording of an RLS denial, of a
  unique-constraint violation, of an expired-JWT response — were **simulated
  from the schema and from supabase-js's known behaviour, not observed**.
  `humanError`'s regexes and `scrub`'s `Key (col)=(value)` pattern are
  therefore matched against expected text, not captured text. **The single
  highest-value follow-up is to trigger one genuine RLS denial and one genuine
  offline write against production and confirm both land in the intended
  branch.**
- **No report has ever been transmitted**, because `deliver()` is a no-op. The
  payload's *size*, its behaviour under `sendBeacon`'s 64KB limit, and whether
  a collector rejects any field are all unverified.
- **The build carries no version stamp.** `ErrorReport.mode` distinguishes a
  demo build from production, but a report cannot say *which release* crashed.
  `src/lib/releases.ts` is owned by another agent this run and Vite exposes no
  package version by default, so this was left alone. The fix is one `define`
  in `vite.config.ts` plus one field on `ErrorReport`.
- **Not measured on a real mobile viewport.** The fallback uses `max-w-lg` and
  `flex-wrap` on the button row, which should hold from 320px, but it was
  measured at desktop width only.
- **`prefers-reduced-motion` against the fallback was not exercised.** The
  fallback has no animation of its own and the global rule in `index.css`
  collapses transitions, so there is nothing expected to fail — but it was not
  observed.
- **Source maps.** The `stack` field contains minified frames
  (`Oa (…/DashboardScene-Vl6yIi3a.js:738:4105)`). Nothing consumes source maps,
  so a stack is only useful to someone with the matching build.
- **No automated regression gate.** There is no test that fails if the boundary
  is removed, and no baseline in `docs/audits/baselines/`. The counts in §1 are
  a written record, not a ratchet. A future run should consider a grep-level
  gate ("boundary count ≥ 2, listener count ≥ 2") with its baseline committed
  alongside, per the README's rule that a gate ships with its baseline.

---

## 8. The exact future edit to wire a service

One function body in `src/lib/report.ts`. Nothing else, anywhere.

```ts
function deliver(report: ErrorReport): void {
  navigator.sendBeacon(
    'https://<collector>/report',
    new Blob([JSON.stringify(report)], { type: 'application/json' }),
  )
}
```

`sendBeacon` rather than `fetch` for two reasons: the common case is a page
already coming apart, and a beacon survives an unload that a fetch does not;
and it is fire-and-forget, which matters here because a reporting call that can
itself reject would feed `unhandledrejection` and loop. `reportError` already
wraps the call in a `try/catch` for the same reason.

Anything added here inherits the redaction rule automatically, because
`deliver` only ever receives an already-scrubbed `ErrorReport`. **Do not add a
field to `ErrorReport` without re-reading §3** — the allowlist is the control,
and widening it is the one edit that can break the guarantee.

---

## 9. Files changed

| File | Change |
|---|---|
| `src/lib/report.ts` | **new** — redaction, report building, dispatch seam, global handlers |
| `src/components/ErrorBoundary.tsx` | **new** — class boundary + token-only fallback |
| `src/lib/enhancements.ts` | added `errorReporting` flag; extended the rollback prose |
| `src/main.tsx` | installs global handlers; root `<ErrorBoundary full>` |
| `src/scenes/DashboardScene.tsx` | inner `<ErrorBoundary key={view}>` inside `<main>`; 10 × `humanError` |
| `src/scenes/AuthScene.tsx` | 1 × `humanError` |
| `src/lib/store.ts` | added `humanError`; `signOut` no longer rejects out |

**Commit:** none — uncommitted working tree at time of writing. See the
publication gate at the top.

**Dependencies added:** none.
