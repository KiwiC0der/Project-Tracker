/* ============================================================================
   Appearance preferences — theme, font, density.

   Applied by setting data attributes on <html>; all the actual work is done by
   the custom-property blocks in index.css. Stored per device, not per account:
   they describe this screen, not this user's data.
   ========================================================================== */
export const THEMES = {
  original: 'Original',
  paper: 'Paper',
  newsprint: 'Newsprint',
  blueprint: 'Blueprint',
  terminal: 'Terminal',
} as const

export const FONTS = {
  interface: 'Interface',
  editorial: 'Editorial',
  grotesk: 'Grotesk',
  mono: 'Mono',
} as const

export const DENSITIES = { comfortable: 'Comfortable', compact: 'Compact' } as const

export type ThemeId = keyof typeof THEMES
export type FontId = keyof typeof FONTS
export type DensityId = keyof typeof DENSITIES

/** Swatch colours for the picker — a swatch must show its own theme even
    while a different one is active, so these are literals, not tokens. */
export const THEME_SWATCH: Record<ThemeId, [string, string]> = {
  original: ['#0e0e14', '#7c5cff'],
  paper: ['#f7f4ec', '#a4291f'],
  newsprint: ['#16150f', '#e0705f'],
  blueprint: ['#0b1a26', '#38bdf8'],
  terminal: ['#08110b', '#4ade80'],
}

const KEY = 'project-tracker-appearance'

export interface Appearance {
  theme: ThemeId
  font: FontId
  density: DensityId
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'original',
  font: 'interface',
  density: 'comfortable',
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const p = JSON.parse(raw) as Partial<Appearance>
    return {
      theme: p.theme && p.theme in THEMES ? p.theme : DEFAULT_APPEARANCE.theme,
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
  el.dataset.font = a.font
  el.dataset.density = a.density
  try {
    localStorage.setItem(KEY, JSON.stringify(a))
  } catch {
    /* nothing persistable — the choice still applies for this session */
  }
}
