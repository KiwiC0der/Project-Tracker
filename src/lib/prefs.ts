/* ============================================================================
   Appearance preferences — theme family, light/dark mode, font, density.

   Applied by setting data attributes on <html>; all the actual work is done by
   the custom-property blocks in index.css. Stored per device, not per account:
   they describe this screen, not this user's data.

   Theme and mode are separate axes. Each of the eleven families has a light
   and a dark palette, so "Blueprint, but light today" costs one click instead
   of hunting through twenty-two differently-named themes.
   ========================================================================== */
export const THEMES = {
  original: 'Original',
  paper: 'Paper',
  newsprint: 'Newsprint',
  blueprint: 'Blueprint',
  terminal: 'Terminal',
  ember: 'Ember',
  orchid: 'Orchid',
  tide: 'Tide',
  clay: 'Clay',
  vapor: 'Vapor',
  bone: 'Bone',
} as const

/** One line each, shown under the name in the picker — a swatch tells you the
    colour, not what the theme is for. */
export const THEME_NOTE: Record<ThemeId, string> = {
  original: 'The violet this app shipped with',
  paper: 'Cream stock, red ink',
  newsprint: 'Pulp paper, coral headline',
  blueprint: 'Drafting paper and cyanotype',
  terminal: 'Phosphor green on black',
  ember: 'Cold forge, hot metal',
  orchid: 'Deep plum with an acid edge',
  tide: 'Petrol depth, coral surfacing',
  clay: 'Unfired earth, matte and dusty',
  vapor: 'Slate at night, magenta signal',
  bone: 'Hard rules, one red, no greys',
}

export const MODES = { light: 'Light', dark: 'Dark', system: 'System' } as const

export const FONTS = {
  interface: 'Interface',
  editorial: 'Editorial',
  grotesk: 'Grotesk',
  mono: 'Mono',
} as const

/** The face each option actually applies, so the picker can render its own
    label in it and you choose by looking rather than by guessing. */
export const FONT_STACK: Record<FontId, string> = {
  interface: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  editorial: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  grotesk: '"Helvetica Neue", Helvetica, "Arial Nova", Arial, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
}

export const DENSITIES = { comfortable: 'Comfortable', compact: 'Compact' } as const

export type ThemeId = keyof typeof THEMES
export type ModeId = keyof typeof MODES
export type FontId = keyof typeof FONTS
export type DensityId = keyof typeof DENSITIES
/** What actually lands on <html> — "system" never does. */
export type ResolvedMode = 'light' | 'dark'

/** Preview colours for the picker: [background, surface, brand].
    A swatch has to show its own theme while a different one is active, so
    these are literals rather than tokens — reading `var(--color-brand)` here
    would paint every swatch the same. Keep in step with index.css. */
export const THEME_SWATCH: Record<ThemeId, Record<ResolvedMode, [string, string, string]>> = {
  original: {
    dark: ['#07070a', '#0e0e14', '#7c5cff'],
    light: ['#f6f6fb', '#ffffff', '#5b3df0'],
  },
  paper: {
    dark: ['#100d09', '#1a1610', '#e0574a'],
    light: ['#f7f4ec', '#fffdf7', '#a4291f'],
  },
  newsprint: {
    dark: ['#0e0d09', '#16150f', '#e0705f'],
    light: ['#eeeae0', '#f8f6ee', '#c0432f'],
  },
  blueprint: {
    dark: ['#061119', '#0b1a26', '#38bdf8'],
    light: ['#e6eef5', '#f4f8fb', '#0369a1'],
  },
  terminal: {
    dark: ['#050c08', '#08110b', '#4ade80'],
    light: ['#e7efe8', '#f3f8f3', '#157f3c'],
  },
  ember: {
    dark: ['#12100e', '#1a1714', '#ff7a18'],
    light: ['#faf6f1', '#fffdfa', '#b8410a'],
  },
  orchid: {
    dark: ['#150e18', '#1e1423', '#b8e62e'],
    light: ['#f8f4f9', '#fffdff', '#4f7a00'],
  },
  tide: {
    dark: ['#061414', '#0a1c1d', '#ff6b5a'],
    light: ['#eef5f4', '#f8fbfb', '#c2381f'],
  },
  clay: {
    dark: ['#16120f', '#1f1a16', '#d4785a'],
    light: ['#f5f1ea', '#fdfbf6', '#9c4420'],
  },
  vapor: {
    dark: ['#0b0e17', '#121724', '#ff2fb3'],
    light: ['#f2f4fa', '#fdfdff', '#b8008a'],
  },
  bone: {
    dark: ['#0a0a0a', '#101010', '#ff3b1f'],
    light: ['#fffffd', '#ffffff', '#d81e00'],
  },
}

const KEY = 'project-tracker-appearance'

export interface Appearance {
  theme: ThemeId
  mode: ModeId
  font: FontId
  density: DensityId
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'original',
  mode: 'dark',
  font: 'interface',
  density: 'comfortable',
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** "system" is resolved here rather than in CSS, so every palette needs one
    rule instead of a rule plus an @media twin. */
export function resolveMode(mode: ModeId): ResolvedMode {
  if (mode !== 'system') return mode
  try {
    return matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

/** Fires when the OS flips, and only matters while mode is "system".
    Returns its own unsubscribe so a caller cannot leak the listener. */
export function watchSystemMode(fn: (m: ResolvedMode) => void): () => void {
  try {
    const mq = matchMedia(DARK_QUERY)
    const on = (e: MediaQueryListEvent) => fn(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  } catch {
    return () => {}
  }
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const p = JSON.parse(raw) as Partial<Appearance>
    return {
      theme: p.theme && p.theme in THEMES ? p.theme : DEFAULT_APPEARANCE.theme,
      // Saved before modes existed: those palettes were the dark ones, except
      // Paper, which only had a light form. Restore what they were looking at.
      mode: p.mode && p.mode in MODES
        ? p.mode
        : p.theme === 'paper' ? 'light' : DEFAULT_APPEARANCE.mode,
      font: p.font && p.font in FONTS ? p.font : DEFAULT_APPEARANCE.font,
      density: p.density && p.density in DENSITIES ? p.density : DEFAULT_APPEARANCE.density,
    }
  } catch {
    /* private mode or corrupt value — the defaults are always safe */
    return { ...DEFAULT_APPEARANCE }
  }
}

export function applyAppearance(a: Appearance) {
  const el = document.documentElement
  el.dataset.theme = a.theme
  el.dataset.mode = resolveMode(a.mode)
  el.dataset.font = a.font
  el.dataset.density = a.density
  try {
    localStorage.setItem(KEY, JSON.stringify(a))
  } catch {
    /* nothing persistable — the choice still applies for this session */
  }
}

/* ============================================================================
   SIDEBAR PREFERENCES — which navigation groups are collapsed, and which
   entries the editable groups show.

   Deliberately a separate key from the appearance blob above. These describe
   the navigation furniture rather than the palette, they are written by
   different controls, and a corrupt value in one must not cost you the other:
   a single object would mean one bad parse resets the theme too.

   `workspace` / `more` are null until the user actually edits a group. Null
   means "whatever this build ships as the default set", so adding a new entry
   in a later version shows up for everyone who never touched the picker,
   instead of being invisible because an older list was frozen into storage.
   ========================================================================== */
const SIDEBAR_KEY = 'project-tracker-sidebar'

export type SidebarGroupId = 'workspace' | 'projects' | 'more'

export const SIDEBAR_GROUPS: SidebarGroupId[] = ['workspace', 'projects', 'more']

export interface SidebarPrefs {
  collapsed: Record<SidebarGroupId, boolean>
  /** Entry ids to show, in the order the group renders them. Null = default. */
  workspace: string[] | null
  more: string[] | null
}

export const DEFAULT_SIDEBAR: SidebarPrefs = {
  collapsed: { workspace: false, projects: false, more: false },
  workspace: null,
  more: null,
}

/** Anything unrecognised is dropped rather than trusted — the same guard style
    as loadAppearance. A hand-edited or older value can only ever cost you the
    setting it names, never take the sidebar down. */
export function loadSidebar(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    if (!raw) return { ...DEFAULT_SIDEBAR, collapsed: { ...DEFAULT_SIDEBAR.collapsed } }
    const p = JSON.parse(raw) as Partial<SidebarPrefs>
    const collapsed = { ...DEFAULT_SIDEBAR.collapsed }
    for (const g of SIDEBAR_GROUPS) {
      if (typeof p.collapsed?.[g] === 'boolean') collapsed[g] = p.collapsed[g]
    }
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
    return { collapsed, workspace: list(p.workspace), more: list(p.more) }
  } catch {
    /* private mode or corrupt value — the defaults are always safe */
    return { ...DEFAULT_SIDEBAR, collapsed: { ...DEFAULT_SIDEBAR.collapsed } }
  }
}

export function saveSidebar(s: SidebarPrefs) {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s))
  } catch {
    /* nothing persistable — the choice still applies for this session */
  }
}
