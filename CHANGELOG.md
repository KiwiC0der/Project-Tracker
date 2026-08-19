# Changelog

Every release, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/).

This file mirrors [`src/lib/releases.ts`](./src/lib/releases.ts), which the in-app
**Versions** page renders. Releases marked *archived* have a running build served
at `/v/<version>/` — see [`docs/VERSIONING.md`](./docs/VERSIONING.md).

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

[2.4.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.4.0
[2.3.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.3.0
[2.2.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.2.0
[2.1.1]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.1
[2.1.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.0
[2.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.0.0
[1.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v1.0.0
