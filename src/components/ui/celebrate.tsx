/**
 * ============================================================================
 * CELEBRATE — one confetti burst, for things that are actually achievements
 * ----------------------------------------------------------------------------
 * Source:  MagicUI "Confetti" — https://magicui.design/r/confetti.json (MIT),
 *          which is itself a React wrapper over canvas-confetti v1.9.4 (ISC,
 *          Kiril Vatev — https://github.com/catdad/canvas-confetti).
 * Adapted: the registry item ships a <Confetti> context provider and a
 *          <ConfettiButton>, and lists `button` as a registry dependency. None
 *          of that is wanted here — the trigger is a state transition, not a
 *          click, and this app has its own button. What survives is the firing
 *          logic and its option shape, rewritten as one imperative function.
 *
 * WHEN TO CALL THIS
 *
 * Almost never. Confetti stops meaning anything the second time you see it in
 * a session, so the bar is: something a person would actually tell a colleague
 * about. Clearing the LAST open task in a project qualifies. Ticking a
 * checkbox does not, and neither does creating something.
 *
 * There is exactly one guard against getting that wrong at the call site — the
 * 1.5s throttle below — and it is a safety net, not a licence. If you find
 * yourself relying on it, the call site is in the wrong place.
 *
 * WHAT IT COSTS
 *
 * Capped at 55 particles over 90 ticks (~1.5s). canvas-confetti runs in a Web
 * Worker with an OffscreenCanvas where the browser supports it, and paints to
 * a <canvas> it appends to <body> on fire and REMOVES on completion — verified
 * in its `done()` handler, not assumed — so there is no residue between bursts
 * and nothing at all in the DOM when the feature is off.
 * ============================================================================
 */
import { ENHANCEMENTS } from '@/lib/enhancements'

/* Type-only, so no value import of canvas-confetti reaches the module graph.
   @types/canvas-confetti uses `export default` with namespace merging, so
   `typeof import(...)` is the callable itself rather than a module record —
   which is why `loadConfetti` below normalises the two possible shapes. */
type ConfettiFn = typeof import('canvas-confetti')

/** Hard ceiling. Two of these overlapping is still under a hundred sprites. */
const MAX_PARTICLES = 55
/** ~1.5s at 60fps. Long enough to register, short enough not to be in the way. */
const TICKS = 90
/** A burst is a punctuation mark. Two in the same breath is a stutter. */
const MIN_INTERVAL_MS = 1500

/* ---------------------------------------------------------------------------
   REDUCED MOTION — subscribed, not sampled.
   ---------------------------------------------------------------------------
   Sampling once at module load is the bug this is written to avoid: the OS
   setting can be flipped mid-session (and DevTools emulation always is), and a
   value read at boot would be stale for the rest of the page's life. The
   listener keeps `prefersReducedMotion` honest for as long as the tab is open.

   canvas-confetti has its own `disableForReducedMotion` option and it is set
   below as well. Both are kept: the library's check is the backstop, and this
   one is the contract — it means `celebrate()` returns without ever loading
   the chunk, rather than loading it to be told no.
   --------------------------------------------------------------------------- */
let prefersReducedMotion = false

if (ENHANCEMENTS.celebrate && typeof window !== 'undefined') {
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion = mq.matches
    mq.addEventListener('change', (e) => {
      prefersReducedMotion = e.matches
    })
  } catch {
    /* No matchMedia (very old browser, or a non-DOM test env). Treating that
       as "no preference expressed" matches every other query in this app. */
  }
}

/* ---------------------------------------------------------------------------
   Lazy handle on the library.
   --------------------------------------------------------------------------- */
let modulePromise: Promise<ConfettiFn> | null = null

function loadConfetti(): Promise<ConfettiFn> {
  modulePromise ??= import('canvas-confetti').then((m) => {
    const mod = m as unknown as { default?: ConfettiFn }
    return mod.default ?? (m as unknown as ConfettiFn)
  })
  return modulePromise
}

/**
 * Fetch the chunk ahead of time so the first burst is not late.
 *
 * A celebration that arrives 200ms after the thing it is celebrating reads as
 * a glitch. Called on idle from the module below, but exported too so a scene
 * can warm it at a moment it knows is quiet.
 */
export function warmCelebrate(): void {
  if (!ENHANCEMENTS.celebrate || prefersReducedMotion) return
  void loadConfetti().catch(() => {})
}

/* Warm on idle. `requestIdleCallback` is not in Safari <16.4, hence the
   setTimeout fallback — a plain timeout is fine here because the work is a
   network fetch of a few KB, not a long task. */
if (ENHANCEMENTS.celebrate && typeof window !== 'undefined') {
  const idle =
    'requestIdleCallback' in window
      ? (fn: () => void) => window.requestIdleCallback(fn, { timeout: 4000 })
      : (fn: () => void) => window.setTimeout(fn, 2000)
  idle(warmCelebrate)
}

/* ---------------------------------------------------------------------------
   Palette
   --------------------------------------------------------------------------- */

/**
 * Read the live theme colours.
 *
 * Resolved at FIRE time rather than captured once, because the palette is a
 * runtime thing here — eleven families x light/dark, switched from the top bar
 * with no reload. Confetti in last week's violet on a Terminal-green board
 * would look like a bug.
 */
function themeColors(): string[] {
  try {
    const cs = getComputedStyle(document.documentElement)
    const colors = ['--color-brand', '--color-brand-soft', '--color-done']
      .map((name) => cs.getPropertyValue(name).trim())
      .filter(Boolean)
    if (colors.length) return colors
  } catch {
    /* fall through */
  }
  // The shipped brand violet, so a burst is never colourless.
  return ['#7c5cff']
}

/* ---------------------------------------------------------------------------
   Fire
   --------------------------------------------------------------------------- */
let lastFiredAt = 0

/**
 * One short burst from the lower middle of the viewport.
 *
 * Silently does nothing when: the feature is off, the user asked for reduced
 * motion, the tab is hidden (nobody is watching, and a background tab's rAF is
 * throttled into a mess anyway), or another burst went off in the last 1.5s.
 *
 * Never throws and never logs — a failed celebration must not be louder than
 * the thing it was celebrating.
 */
export function celebrate(): void {
  if (!ENHANCEMENTS.celebrate) return
  if (prefersReducedMotion) return
  if (typeof document === 'undefined' || document.hidden) return

  const now = Date.now()
  if (now - lastFiredAt < MIN_INTERVAL_MS) return
  lastFiredAt = now

  void loadConfetti()
    .then((confetti) => {
      // Re-check: the chunk may have taken a moment, and the user may have
      // switched tabs or flipped the OS setting in the meantime.
      if (prefersReducedMotion || document.hidden) return
      void confetti({
        particleCount: MAX_PARTICLES,
        ticks: TICKS,
        spread: 74,
        startVelocity: 34,
        decay: 0.92,
        gravity: 1.1,
        scalar: 0.9,
        // Slightly above centre: the burst reads as coming off the board
        // rather than off the bottom edge of the window.
        origin: { x: 0.5, y: 0.72 },
        colors: themeColors(),
        // Above the app's own stacking, below sonner's toaster (999999999) so
        // a simultaneous toast is never buried under falling paper.
        zIndex: 9999,
        disableForReducedMotion: true,
      })
    })
    .catch(() => {
      /* Chunk failed to load. Not worth a word. */
    })
}
