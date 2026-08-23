# Changelog

Every release, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/).

This file mirrors [`src/lib/releases.ts`](./src/lib/releases.ts), which the in-app
**Versions** page renders. Releases marked *archived* have a running build served
at `/v/<version>/` — see [`docs/VERSIONING.md`](./docs/VERSIONING.md).

---

## [2.7.0] — 2026-08-23

### Added

- **An "All projects" scope.** Pick it from the sidebar or the top-bar selector
  and every surface aggregates: List, Progress, Priorities, Stale, Notes,
  Calendar, Reports, and the dashboard panels. A sentinel id (`ALL_PROJECTS`)
  rather than `null`, because `null` already means "this account has no projects
  at all" and an empty account must not render as though it were showing
  everything. Tasks carry their project's dot and name in this scope only —
  always showing it would be noise inside a single project.
- **Ordering is per-project, and All says so.** Task `position` values are only
  comparable within one project and one status column, so a merged column has no
  meaningful hand-order. Drag-to-reorder and Alt+Up/Down are therefore off in All
  scope — the grip and grab cursors go with them, so no card advertises a gesture
  it will not honour — and one line above the columns explains why. Moving a task
  *between* status columns still works, because that is a status write, not an
  ordering one. Merged columns sort by sidebar project order, then `byOrder`:
  both orderings the user actually made, and stable across reloads.
- **Reorder the projects in the sidebar.** Drag by the grip, or Alt+Up/Down from
  the keyboard, with a live-region announcement either way. Pointer Events rather
  than HTML5 drag-and-drop, for the same reason task dragging moved in 2.3.0:
  HTML5 DnD never fires on touch. Dense `0..n-1` renumbering rather than the
  sparse `ORDER_STEP` scheme tasks use — that scheme exists to protect
  `tasks.updated_at`, which the insights layer reads, and nothing reads
  `projects.updated_at`. A drop back into the original slot writes nothing.
- **An "Edit project" button on the project page**, beside "Delete project".
  Editing was previously reachable only from the "+" popover on the sidebar's
  Projects group — a place nobody looks when they are already reading the project.
- **Projects can declare a plan: a target date and hours a week.** Both are read
  back, not merely stored. `forecast()` cannot answer at all for a project with
  nothing finished — zero velocity returns Infinity — so `budgetForecast()` uses
  the declared hours as the missing divisor, labelled as an intention rather than
  a measurement. `targetVerdict()` puts the declared date next to the expected one
  and names the gap. A project that declared no plan renders no strip, rather than
  a row of dashes implying it failed to.

### Fixed

- **The maximise icon appeared to work only when nothing else was open.** It was
  never broken — it was covered. Measured with `elementFromPoint` on each button's
  own centre, four overlapping panels: `progress` (z=20) and `priorities` (z=22)
  had their controls intercepted by the panel in front. The maximise and close
  buttons sit at the far right of the header, exactly the strip a cascading
  overlap covers, while the exposed left end is where a double-click naturally
  lands — which is why one worked and the other did not. Nothing in the header can
  fix that, because the header is the thing being covered.
- **The dock is now a taskbar**, which can fix it, because the dock is never
  covered. A panel that is open but behind comes to the front; the one already in
  front closes. Every panel's controls are one click away whatever is stacked on
  top, and the raise focuses the panel head so a keyboard user lands one Tab from
  the buttons they came for.
- **A maximised panel can be dragged and resized**, and still restores to its
  pre-maximise rectangle. `Geo.pre` now means "a restore is pending" rather than
  "this panel is exactly full-board", so reshaping a maximised panel no longer has
  to choose between keeping the new shape and keeping the old one. Measured
  round-trip: `29,38,648,308` → maximised → reshaped to `440,269,1000,500` →
  restored to `29,38,648,308`, exactly. Containment holds under a 3000px drag.
  Alt+arrow snapping stopped discarding the restore rectangle, which would have
  left keyboard users strictly worse off than mouse users.
- `toLocked()` no longer tiles from a stale restore rectangle. It now checks that
  the live rectangle is still full-board before preferring `pre`, so locking a
  maximised-then-resized panel uses the shape actually on screen.
- The "New project" row lines up with the project rows above it, now that those
  have a grip gutter.

### Notes

- `supabase/schema.sql` gains `projects.target_date` and `projects.weekly_hours`
  as idempotent `add column if not exists` statements. **Run it.** Until you do,
  PostgREST rejects any write naming those columns — and it rejects the *whole*
  statement, which would take project editing down entirely rather than degrade.
  So `createProject`/`updateProject` detect that specific failure, retry without
  the planning fields, and surface one sentence naming the file that fixes it.
- `npm run preview` is now guarded: it refuses to serve a `dist/` carrying live
  Supabase credentials, because that bundle is the production app pointed at
  production data and signing up in it creates a real account. Override with
  `ALLOW_LIVE_PREVIEW=1` for a pre-deploy sanity check. The guard cannot cover
  `npx vite preview --outDir dist` — reach for `preview:demo` by habit.

## [2.6.0] — 2026-08-22

### Fixed

- **Popovers fell behind board panels after sustained use.** The board host was
  `position: relative` with `z-index: auto` — no stacking context — so the panel
  z-counter, which increments on every click and persists, escaped into the root.
  Measured: 60 panel clicks pushed panel z to **88**, past the popover layer at
  80, and `elementFromPoint` at a popover's centre returned a panel. A fresh page
  always passed, which is why earlier testing missed it. The host now carries
  `z-index: 0`. This was a **regression of a bug already fixed in the prototype**,
  whose comment reads "z-index:0 is load-bearing, not decoration"; the reasoning
  is now in the TSX so it does not get deleted a third time.
- **Panels could be dragged off the board, horizontally and vertically.** The
  clamp allowed 90px of overhang to keep a drag head grabbable, and the host was
  `overflow-x: visible`, so a panel could sit past the footer or off the right
  edge and scroll the document. Panels are now fully contained (60 clamp cases,
  0 containment failures, including drags to 4000×3000), with `overflow-clip` as
  a second line. Shrinking the window pulls stranded panels back inside.
- Saved z values are normalised to 20, 21, 22… on load, so a long-lived install
  cannot creep upward forever.
- **The last native `confirm()`** — on task delete — is gone. Deletion is now
  reversible, so a blocking dialog was asking permission for something already
  undoable.

### Added

- **Maximise on loose panels.** Double-click a header, or use the new button
  beside the ✕. Restore replays the *exact* stored rectangle — verified lossless:
  `[0,89,353,266]` → fills the board → back to `[0,89,353,266]`. Loose-only; the
  control is absent in locked mode, where a panel already fills its tile.
- **Progress, Priorities, Stale and Notes are full pages**, not shortcuts that
  bounced you back to the dashboard. Each is rebuilt at page scale from the same
  exported `insights` functions rather than reusing panel JSX — so Priorities
  shows the whole ranked queue instead of one task, and Stale shows everything
  instead of the top 8. Both Notes surfaces share one `localStorage` key
  (verified byte-identical), so a note written on either appears on the other.
- **Toasts** (`sonner`, 9.9 kB gzip, lazy) confirming project create / save /
  delete, and **a real Undo on task delete** — it re-creates the row via the
  backend, not just React state, so it survives a reload. Verified in the store.
- **A confetti burst** (`canvas-confetti`, 4.3 kB gzip, lazy) on one milestone
  only: completing the *last open task* in a project. Hard no-ops under
  `prefers-reduced-motion`, subscribed rather than sampled.
- **`src/lib/enhancements.ts`** — flip `toasts` or `celebrate` to `false` and
  Rollup drops the dependency entirely. Verified: zero trace in the bundle.
- A favicon, clearing the last console 404.

### Notes

`NumberTicker` was **rejected** during sourcing: it needs `motion` at ~116 kB
gzip — roughly half this app's bundle — to animate a counter. Recorded in
`docs/SOURCED-COMPONENTS.md`, because the reasoning outlasts the decision.

---

## [2.5.1] — 2026-08-22

### Fixed

- **Sidebar `+` popovers rendered behind the dashboard.** They were
  `position: fixed` with `z-[60]` but lived inside the sidebar's subtree, and
  `<aside>` is both `overflow: hidden` (which clips fixed descendants) and
  `z-index: 50` (which caps everything inside it). Fixed positioning escapes
  neither. All popovers now portal to `document.body`, following the precedent
  already set by `CreateTaskDialog`. Regression test is `elementFromPoint` at
  each popover's own centre — the topmost node must be inside the popover.
- **The appearance panel was taller than the screen** — 849px in a 722px
  viewport, overflowing by 175px with no scroll, so Density and the last themes
  were unreachable. The theme control is now a **dropdown** showing only the
  current theme; the panel is **353px**. It also carries a viewport-bounded
  `max-height` so no future addition can push content off-screen again.
- **Popover z-index had to rise to 80.** The pickers are used inside dialogs
  that are `z-[70]` portals; once portalled to `<body>` they became siblings
  rather than descendants, and at 60 would have rendered *behind* the dialog.
- **Placement clamped to `innerWidth`**, which grows with a page's scrollable
  width — so on a page with horizontal overflow, popovers were parked out in the
  overflow region. Now clamps to `documentElement.clientWidth`.
- **Escape could not close a nested layer.** Each popover registered its own
  *captured* window listener, and capture fires in registration order, so the
  outermost always won. Replaced with a single listener over a LIFO stack: one
  Escape closes the dropdown, a second closes the panel, and neither closes the
  sidebar.

### Changed — found while looking, not reported

- **Notes now say they are device-only.** They have no table and live in
  `localStorage`, so clearing site data or opening the app elsewhere loses them.
  Silently is the wrong way for that to happen.
- **Signing out clears the board layout, sidebar shape and notes.** On a shared
  machine those belong to whoever was signed in — notes especially, since a note
  exists nowhere else. Appearance is deliberately kept: a theme describes the
  screen, not the account.

### Known, not fixed

The dashboard board overflows horizontally below ~400px (`scrollWidth` 396 vs
`clientWidth` 375). A loose panel clamps to `MIN_W` 210 while its x may reach
`width - 90` — deliberate, so the drag head stays grabbable — and the host is
`overflow-x: visible`. The one-line fix (`overflow-x: clip`) would change
behaviour for deliberately-dragged panels, so it wants its own change.

---

## [2.5.0] — 2026-08-22

### Added

- **Six new themes** — Ember, Orchid, Tide, Clay, Vapor, Bone — promoted from
  the variants lab. Eleven families in light and dark, 22 palettes. Every value
  was copied verbatim from the prototype and re-verified: 132/132 tokens match,
  and all 11 × 2 × 9 foreground/background pairs clear WCAG AA.
- **Liquid Metal Button** (`src/components/ui/liquid-metal-button.tsx`), a
  21st.dev shader component, replacing the quick-add text box. Pressing it opens
  a **Create Task dialog** modelled on the edit dialog.
- **Username sign-in.** Sign up and sign in with a username; the email field is
  gone.
- **Create/Edit Project dialog** — name, description, colour, status.
- **Collapsible sidebar groups**, each with a `+` that edits its contents.
  Workspace can list the dashboard's panels (Progress, Priorities, Stale,
  Notes); clicking one navigates to the dashboard and opens that panel.

### Changed

- **No native browser dialogs remain.** `window.prompt('Project name')` and the
  `window.confirm` behind project deletion are both gone. Deletion now confirms
  inside the dialog, where it can name the project — something `confirm` cannot.
- `createProject` takes a status; `updateProject` is wired to the edit dialog.

### Fixed — found while integrating the component

- **A WebGL context leak in the 21st.dev original.** Its cleanup calls
  `shaderMount.destroy()`; the real method is `dispose()` (verified at
  `shader-mount.js:386`), so every unmount leaked a GL context.
- **Its label failed contrast**: `#666666` on a `#202020→#000000` slab measured
  **2.84:1**. Now driven by tokens, sampled across the full gradient in all 22
  palettes: **12.75:1 worst case**.
- **It ignored `prefers-reduced-motion`** and hardcoded a black slab that looked
  broken on light themes. Both fixed; the shader is not mounted at all when
  reduced motion is set.
- **Escape dropped focus to `<body>`** when dismissing a picker popover.
  `onClose()` unmounts the panel before the synchronous `.focus()` lands, and a
  microtask is still too early — it has to be deferred past React's commit.
- **A sidebar popover outlived the mobile drawer**, staying pinned to a trigger
  that had slid off-screen and gone `inert`.
- **A username with a trailing newline passed validation.** JS `$` matches
  before a final newline; `validateUsername` trims first so it was unreachable,
  but a future caller that forgot to trim could have put a control character in
  an email localpart.

### Notes

Supabase Auth has no username identity type — only email and phone. Usernames
are therefore mapped to `<name>@users.noreply.pt.anteneh.tech`, a domain with no
MX record. Uniqueness is real (Postgres' unique constraint on `auth.users.email`
enforces it), but **there is no deliverable address on file, so password reset is
impossible** until the planned recovery-email feature ships. The sign-up form
says so.

`npm run build:demo` is new: it builds with the Supabase vars cleared **and
verifies the bundle contains no project ref and no JWT before handing it over**.
`dist/` is built from the real `.env`, and previewing it drives the live backend
— which happened once during this work and created a real account.

---

## [2.4.0] — 2026-08-18

### Removed

- **The Editor panel.** v2.3.0 gave every task a pencil that opens a dialog with
  title, notes, priority, date, status and delete — strictly more than the panel
  offered, reachable from anywhere, and not competing for board space. Keeping
  both meant two places to edit the same task.

### Fixed

- **A saved layout naming a retired panel no longer takes the board down.** The
  restore path filtered the `open` list against the panel registry but never the
  locked tree, so a tree still holding an `editor` leaf would read `.title` off
  `undefined` on first paint. Trees are now pruned the same way.

### Changed

- **Cast shadow softened** — 2px at rest and 5px selected, at roughly half the
  earlier opacity. At 4/8px it had stopped reading as weight and started reading
  as a second border competing with the real one.

### Added

- **`/explorations/variants`** — three art directions over one dashboard and one
  set of data, plus six original palettes (Ember, Orchid, Tide, Clay, Vapor,
  Bone) shown next to the five already shipped. Every direction and palette is
  CSS on two data attributes over identical markup, which is the test: a
  direction needing different HTML is a different app, not a different skin.
  All twelve new palettes clear WCAG AA on all three surfaces.

---

## [2.3.0] — 2026-08-17

Tasks can be reordered, edited in place, and given a priority and a date from
real dropdowns.

### Added

- **Reorder by drag** — within a column or across to another one, with an
  insertion line showing where the task will land.
- **Alt+arrows move a task** without a pointer: up and down within a column,
  left and right across. The same gesture the Workboard uses for panels.
- **Edit dialog** on every task (pencil, or double-click the title): title,
  notes, priority, expected completion, status, delete.
- **`PriorityPicker` and `DatePicker`** (`src/components/ui/pickers.tsx`), also
  replacing the native `<select>` and `<input type="date">` in the Editor panel.
- **Touch support.** The old handler used HTML5 drag-and-drop, which never fires
  on a phone. Pointer events work everywhere; touch drags start from the grip so
  the page can still be scrolled with a finger.

### Fixed

- **The root cause of the ordering bug: `position` was never written after a
  task was created.** Every path that moved a task — drag to a column, "Mark
  done", the editor's status control — wrote `status` and left `position`
  alone, so tasks piled up tied at their creation number and each column
  rendered in whatever order the backend happened to return. All placement now
  goes through one position-assigning path, and columns sort by position with
  `created_at` as a tiebreak for rows predating the fix.
- **New tasks appended on the wrong scale.** `position` was the sibling count,
  so a new task took position 3 in a column already reordered to 1024, 2048 —
  and silently appeared at the top.
- **Due dates could land a day early.** `toISOString().slice(0,10)` reads the
  UTC day, so a Friday date set on Thursday evening in the Americas was stored
  as Thursday. Dates are now built from local calendar parts.
- Demo mode now maintains `updated_at`, mirroring the `tasks_touch` trigger, so
  staleness and velocity mean something without a backend.

### Notes

Positions are **sparse** (1024 spacing), not `0..n-1`. This is load-bearing: the
`tasks_touch` trigger bumps `updated_at` on every UPDATE, and the insights layer
reads that column as both `touchedAt` and `doneAt`. Renumbering a whole column on
each drop would make every shifted row look touched today — reorder Done once and
every task in it would read as completed today, and momentum, burndown and the
landing forecast would all report a pace that never happened.

So a drop takes the integer midpoint of its neighbours and writes exactly one
row. Measured over 200 random moves: **1.04 row-writes per move**, 3 renumbers,
no ties or inversions.

---

## [2.2.0] — 2026-08-07

Panels sit on a hard offset shadow — no blur, the way a misregistered print
does. Selection is carried by that same object rather than by a competing
highlight colour: the panel you are working in throws a longer, heavier cast.

### Added

- **Cast shadow on every panel**, in both loose and locked modes. 4px at rest,
  **8px when selected**, with a heavier tone to match.
- **Selection.** Touching a panel anywhere selects it — the capture phase runs
  before the header's own drag handler, so one gesture both selects and grabs.
  In loose mode selecting also brings the panel to the front, which a window
  manager should do and which the heavier cast would otherwise contradict.
- Tabbing into a panel selects it too, so selection is not pointer-only.

### Changed

- Light and dark use different cast colours, and this was measured rather than
  assumed. On cream, 30% black is exactly the reference. On a near-black page —
  Terminal's background is `#050c08` — a black cast is **invisible**: there is
  nothing darker than the background to cast onto. A screenshot made that
  obvious in seconds. The dark palettes therefore invert the physics rather than
  the colour: the plate is lifted and its edge catches light (`border` at rest,
  `muted` when selected). A brand-coloured cast was tried and rejected — at 8px
  it reads as a neon glow competing with the theme, not as depth.
- The selected panel paints above its neighbours, or the longer cast is drawn
  under the next tile and the extra weight is invisible.

### Fixed

- A failed `setPointerCapture` no longer aborts a drag. It throws when the
  pointer is already gone; uncaught, that killed the gesture before its move
  listeners were attached.

---

## [2.1.1] — 2026-08-06

Two defects found while verifying 2.1.0 against a real browser rather than
against the code.

### Fixed

- **A grabbed panel could sink.** The stacking counter restarted at its floor on
  load instead of resuming above the restored `z` values, so the first grab after
  a reload assigned a `z` *below* panels raised in an earlier session — the panel
  you just picked up went behind the others. Caught by dragging a panel and
  finding the saved `z` was 21 while another panel sat at 23.
- **The appearance button lost its accessible name** below the `sm` breakpoint,
  where its text label is hidden and only the icon remains. It now carries an
  `aria-label` that does not depend on the visible label.

### Verified this round

All eight resize handles are grabbable from 4px inside each edge. The extreme
corner tip is clipped by `overflow-hidden` against `rounded-xl`, which removes
only the 0–3px pixel that the rounded corner has already visually removed.

---

## [2.1.0] — 2026-08-06

Locked mode became a tiling window manager rather than a frozen picture, and each
of the five themes gained a light palette to go with its dark one.

### Added

- **Gutters.** Every split in the locked tree carries a draggable rule between its
  two tiles. Pull it to re-proportion; it is a `role="separator"` with a live
  `aria-valuenow`, and arrow keys move it in 4% steps.
- **Panel swapping.** Drag one panel's head onto another to exchange them. The
  target is outlined while you drag and the two ratios stay exactly where they
  were — only the contents trade.
- **Alt+arrows** move a panel in both modes: swap with the spatial neighbour when
  locked, snap to that half of the board when loose. Focus follows the panel, not
  the position.
- **Light and dark for every theme** — ten palettes across five families. Mode and
  theme are separate axes on `<html>` (`data-mode`, `data-theme`).
- **System mode**, resolved in JS against `prefers-color-scheme` and kept live via
  a `matchMedia` listener, so the page follows the OS as it changes.
- **Appearance popover** in the top bar: a three-way mode control, theme cards that
  preview themselves in the mode you are actually in, font options rendered in
  their own face, and density. Plus a one-click day/night switch beside it.
- **Versions page** (sidebar → More) listing every release, with a preview and a
  link to a running build of the archived ones.
- **`scripts/archive-version.mjs`** — builds any git tag into `public/v/<version>/`.

### Changed

- Density now drives real padding and the gap between tiles, via `--pt-pad` and
  `--pt-gap`. It was previously stored and never read.
- Tiles are separated by their gutter rather than a container `gap`, so the space
  between two panels is one rule instead of two.
- Panel headers are focusable in both modes and carry a description of what
  dragging them does.

### Fixed

- **Contrast.** Every `--color-muted` is now solved to clear WCAG AA (4.5:1)
  against all three of `background`, `surface` and `surface-2` in all ten
  palettes. Two of the failures were pre-existing in 2.0.0 (Paper light 4.43,
  Newsprint dark 4.41).
- **Appearance popover off-screen at narrow widths.** The panel right-aligns to
  its trigger; when the top bar wraps and the trigger lands near the left, that
  put the panel off the left of the window. It is now measured and nudged back
  into the viewport. A `position: fixed` fallback is not available — the header's
  `backdrop-filter` makes it the containing block for fixed descendants.

---

## [2.0.0] — 2026-08-06

Replaced the static four-column dashboard with a two-mode Workboard and gave the
app an analytics layer computed from its own history.

### Added

- **Workboard.** *Loose*: panels float, overlap, and resize from any edge or
  corner. *Locked*: panels tile the page, nothing overlaps, the page is always
  full. `Alt+Z` toggles.
- Locking preserves the arrangement you actually made. A recursive **guillotine**
  turns the floating rectangles into a real split tree, so "one tall panel beside
  a stack of three" survives — a flat list of rows cannot represent that shape and
  collapses it, which read as the lock throwing your layout away.
- Panels: List, Progress, Priorities, Stale, Notes, Editor.
- **Insights** (`src/lib/insights.ts`): momentum, landing-date forecast, staleness,
  urgency, health, an auditable "do this next" that returns its own reasoning, and
  a natural-language parser (`!high @fri /project`).
- Five themes and four font presets.
- Calendar, Reports and Settings **built** rather than padlocked.
- `public/explorations/` — the nine design prototypes this came from.

### Notes

- Geometry is stored as **fractions** of the board, never pixels, so a resize is a
  pure re-apply and opening the sidebar repeatedly cannot accumulate drift.
- The forecast refuses to lie: no pace means `Infinity`, not a guess.

---

## [1.0.0] — 2026-08-01

The original Project Tracker.

### Added

- Supabase accounts with Row Level Security scoped to `auth.uid()`.
- Hamster-wheel loader, WebGL prism hero, shader auth screen.
- Drag-and-drop board across To do / In progress / Done.
- Projects in a sidebar with open counts.

[2.7.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.7.0
[2.6.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.6.0
[2.5.1]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.5.1
[2.5.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.5.0
[2.4.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.4.0
[2.3.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.3.0
[2.2.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.2.0
[2.1.1]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.1
[2.1.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.0
[2.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.0.0
[1.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v1.0.0
