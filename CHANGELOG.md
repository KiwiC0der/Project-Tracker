# Changelog

Every release, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/).

This file mirrors [`src/lib/releases.ts`](./src/lib/releases.ts), which the in-app
**Versions** page renders. Releases marked *archived* have a running build served
at `/v/<version>/` — see [`docs/VERSIONING.md`](./docs/VERSIONING.md).

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

[2.1.1]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.1
[2.1.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.1.0
[2.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v2.0.0
[1.0.0]: https://github.com/KiwiC0der/Project-Tracker/releases/tag/v1.0.0
