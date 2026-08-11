/* ============================================================================
   RELEASE HISTORY

   The single source of truth for what shipped when. The Versions page renders
   it, CHANGELOG.md mirrors it, and every entry marked `archived` has a real
   running build at /v/<version>/ produced by scripts/archive-version.mjs.

   Adding a release:
     1. Tag the commit:  git tag -a v2.2.0 -m "…"
     2. Archive the one it replaces:  node scripts/archive-version.mjs v2.1.0
     3. Add the entry here with archived: true on the newly archived one
     4. Mirror the entry into CHANGELOG.md

   `archived` is a claim about a directory existing. Do not set it hopefully —
   a Versions page offering a dead link is worse than one that says "current".
   ========================================================================== */
export const REPO = 'https://github.com/KiwiC0der/Project-Tracker'

export interface Release {
  version: string
  date: string
  title: string
  /** What this release was for, in one breath. */
  summary: string
  changes: string[]
  /** A build of this version is served at /v/<version>/. */
  archived: boolean
  /** The release running right now. Exactly one entry has this. */
  current?: boolean
}

export const RELEASES: Release[] = [
  {
    version: '2.2.0',
    date: '2026-08-07',
    title: 'Panels cast a shadow, and the selected one casts further',
    current: true,
    archived: false,
    summary:
      'Every panel sits on a hard offset shadow — no blur, like print ' +
      'mis-registration. Selection is carried by the same object: the panel you ' +
      'are working in throws a longer, heavier cast than the rest.',
    changes: [
      'Hard offset cast shadow on every panel, in both loose and locked modes',
      'The selected panel casts at 8px instead of 4px, in a heavier tone',
      'Touching a panel anywhere selects it; in loose mode it also comes to the front',
      'Tabbing into a panel selects it too, so the selection is not pointer-only',
      'Dark palettes light the plate edge rather than darkening it — black cannot cast on a near-black page',
      'A failed pointer capture no longer aborts a drag',
    ],
  },
  {
    version: '2.1.1',
    date: '2026-08-06',
    title: 'Stacking order and a nameless button',
    archived: true,
    summary:
      'Two defects found while verifying 2.1.0 against a real browser rather than ' +
      'against the code.',
    changes: [
      'Grabbing a panel after a reload raises it again — the stacking counter restarted at its floor instead of resuming above the saved values, so the panel you grabbed could sink behind others',
      'The appearance button keeps an accessible name when its label is hidden on narrow screens',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-08-06',
    title: 'Tiling controls and light/dark for every theme',
    archived: true,
    summary:
      'Locked mode became a tiling window manager rather than a frozen picture, ' +
      'and each of the five themes gained a light palette to go with its dark one.',
    changes: [
      'Locked mode: pull a gutter to re-proportion any split',
      'Locked mode: drag a panel head onto another to exchange them',
      'Alt+arrows move a panel — swap a neighbour when locked, snap to half the board when loose',
      'Ten palettes: five theme families, each in light and dark',
      'Mode follows the system when you ask it to, and keeps up when the system changes',
      'Appearance popover previews every theme in the mode you are actually in, and every font in its own face',
      'Density now drives real padding instead of being a stored string nothing read',
      'This Versions page, with running builds of the releases behind it',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-08-06',
    title: 'Workboard dashboard and the insights engine',
    archived: true,
    summary:
      'Replaced the static four-column dashboard with a two-mode Workboard and gave ' +
      'the app an analytics layer computed from its own history.',
    changes: [
      'Workboard: panels float and overlap in loose mode, tile the page in locked',
      'Locking preserves the arrangement via a recursive guillotine split tree',
      'Alt+Z toggles between the two modes',
      'Panels: List, Progress, Priorities, Stale, Notes, Editor',
      'Insights: momentum, landing-date forecast, staleness, urgency, health',
      '"Do this next" returns its own reasoning rather than an unexplained rank',
      'Natural-language quick add — !high @fri /project',
      'Five themes and four font presets',
      'Calendar, Reports and Settings built rather than padlocked',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-01',
    title: 'The original Project Tracker',
    archived: true,
    summary:
      'Three scenes — a hamster loader, a WebGL hero, a shader auth screen — and a ' +
      'four-column task board behind them.',
    changes: [
      'Supabase accounts with row-level security',
      'Custom GLSL hero and auth backgrounds',
      'Drag-and-drop board across To do / In progress / Done',
      'Projects in a sidebar with open counts',
    ],
  },
]
