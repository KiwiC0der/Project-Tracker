/**
 * ============================================================================
 * TOASTS — a themed wrapper around sonner
 * ----------------------------------------------------------------------------
 * Source:  sonner v2.0.8 — https://sonner.emilkowal.ski/ (MIT, Emil Kowalski)
 * Adapted: repainted onto this app's design tokens, gated behind
 *          ENHANCEMENTS.toasts, and narrowed to a four-call API.
 *
 * WHY A WRAPPER AND NOT `import { toast } from 'sonner'` AT CALL SITES
 *
 * Three reasons, in order of how much they matter:
 *
 * 1. THEMING. This app has eleven palettes x light/dark. sonner ships its own
 *    hardcoded greys, so out of the box a toast looks right in exactly one of
 *    the twenty-two and wrong in the other twenty-one. The <style> block below
 *    rebinds every colour sonner reads to a design token, so the toast takes
 *    the palette for free — including ones added later.
 *
 * 2. THE ROLLBACK SWITCH. sonner injects its stylesheet into <head> as a
 *    module side effect, at import time, before any component renders. A
 *    static import would therefore leave a dead <style> block in the document
 *    even with the feature switched off. Importing it dynamically behind the
 *    flag means "off" really is off — see src/lib/enhancements.ts.
 *
 * 3. RESTRAINT. Exposing four verbs instead of sonner's full surface keeps the
 *    vocabulary of this app's feedback small and consistent. There is no
 *    `notify.warning` because nothing here warrants one yet.
 *
 * ACCESSIBILITY — verified against sonner's compiled output, not assumed:
 *   - the container is a <section aria-live="polite" aria-relevant="additions
 *     text" aria-atomic="false">, so new toasts are announced without
 *     interrupting;
 *   - it carries tabIndex={-1} and nothing inside is focused on mount, so a
 *     toast cannot steal focus from whatever the user was typing in;
 *   - the toast list is reachable on demand via sonner's hotkey (alt+T);
 *   - `closeButton` is on, so dismissal never depends on a swipe gesture.
 *
 * REDUCED MOTION is handled three times over: this file's own @media block,
 * sonner's built-in one, and the global rule at the bottom of src/index.css.
 * The belt-and-braces is deliberate — sonner's block does not cover the
 * container's own `transition: transform .4s`, only the toasts inside it.
 * ============================================================================
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { ENHANCEMENTS } from '@/lib/enhancements'

/* Type-only — erased at compile time, so it does not pull sonner into the
   graph the way a value import would. */
type SonnerModule = typeof import('sonner')
type SonnerToast = SonnerModule['toast']

/** Options a caller may pass. Deliberately a subset of sonner's — the point of
    the wrapper is that call sites do not reach for sonner's whole surface. */
export interface NotifyOptions {
  /** Second line, smaller and muted. Use for the detail, not the headline. */
  description?: string
  /** Milliseconds on screen. Defaults to 4000, or 8000 for `notify.undo`. */
  duration?: number
  /** Reuse an id to replace an existing toast rather than stacking a new one. */
  id?: string
}

/* ---------------------------------------------------------------------------
   Lazy handle on sonner. Resolved once and cached; every later call reuses the
   same module instance, so the toast store is shared.
   --------------------------------------------------------------------------- */
let modulePromise: Promise<SonnerModule> | null = null

function loadSonner(): Promise<SonnerModule> {
  modulePromise ??= import('sonner')
  return modulePromise
}

/**
 * Run something against sonner's imperative API, but only if toasts are on.
 *
 * The `.catch` is not decoration: if the chunk fails to load (offline, a stale
 * service worker, a hash miss after a deploy) an unhandled rejection would
 * print to the console. A missing toast is not worth a console error — the
 * mutation it was reporting on already succeeded.
 */
function emit(run: (toast: SonnerToast) => void): void {
  if (!ENHANCEMENTS.toasts) return
  void loadSonner()
    .then((m) => run(m.toast))
    .catch(() => {
      /* Feedback is a nicety. Failing to deliver it is not an error. */
    })
}

/**
 * The app's notification vocabulary.
 *
 * Every method is fire-and-forget and safe to call from anywhere, including
 * inside a `catch`. With `ENHANCEMENTS.toasts` off they are all no-ops.
 */
export const notify = {
  /** A mutation landed. Keep the message short and past-tense: "Project saved". */
  success(message: string, opts: NotifyOptions = {}): void {
    emit((toast) => toast.success(message, opts))
  },

  /** A mutation failed. Errors are styled in `brand`, not red — see the CSS note. */
  error(message: string, opts: NotifyOptions = {}): void {
    emit((toast) => toast.error(message, opts))
  },

  /** Neutral acknowledgement. Rare by design. */
  info(message: string, opts: NotifyOptions = {}): void {
    emit((toast) => toast(message, opts))
  },

  /**
   * A destructive action landed, with a way back.
   *
   * The delete has ALREADY happened by the time this is called — `onUndo` is a
   * restore, not a cancel. That is the honest model for an optimistic UI: the
   * row is gone from the screen either way, and this offers to put it back.
   *
   * Held for 8s rather than 4s, because reading "Deleted X", deciding it was a
   * mistake and travelling to the button does not fit in four seconds.
   */
  undo(message: string, onUndo: () => void, opts: NotifyOptions = {}): void {
    emit((toast) =>
      toast(message, {
        duration: 8000,
        ...opts,
        action: { label: 'Undo', onClick: () => onUndo() },
      }),
    )
  },

  /** Clear everything on screen — e.g. when a scene unmounts. */
  dismissAll(): void {
    emit((toast) => toast.dismiss())
  },
} as const

/* ---------------------------------------------------------------------------
   The portal
   --------------------------------------------------------------------------- */

/* Only constructed when the feature is on, so with the flag off there is no
   reference to `import('sonner')` left for the bundler to emit a chunk for. */
const LazyToaster = ENHANCEMENTS.toasts
  ? lazy(() => import('sonner').then((m) => ({ default: m.Toaster })))
  : null

/** `data-mode` on <html> is only ever written as `light` or `dark` — "system"
    is resolved in JS by src/lib/prefs.ts before it ever reaches the DOM. */
function readMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark'
}

/**
 * Track the resolved light/dark mode.
 *
 * The palette itself comes from the tokens, so this only drives sonner's own
 * `data-sonner-theme` attribute — which still matters for the handful of its
 * rules that are keyed on it. An attribute observer rather than a prop because
 * the appearance state lives in DashboardScene, and reaching into it would
 * couple the toaster to a scene it is deliberately mounted above.
 */
function useDocumentMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(readMode)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setMode(readMode())
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['data-mode'] })
    sync() // the attribute may have been written between first render and here
    return () => observer.disconnect()
  }, [])

  return mode
}

/**
 * Mount once, at the app root, above every scene.
 *
 * Renders nothing at all when `ENHANCEMENTS.toasts` is false.
 */
export function ToastPortal() {
  if (!ENHANCEMENTS.toasts || !LazyToaster) return null
  return <ToastPortalInner Toaster={LazyToaster} />
}

/* Split so the hooks above never run in the disabled build — an early return
   before a hook would be a rules-of-hooks violation. */
function ToastPortalInner({ Toaster }: { Toaster: NonNullable<typeof LazyToaster> }) {
  const mode = useDocumentMode()

  return (
    <>
      <style>{TOAST_CSS}</style>
      <Suspense fallback={null}>
        <Toaster
          className="pt-toaster"
          position="bottom-right"
          theme={mode}
          duration={4000}
          gap={10}
          visibleToasts={3}
          closeButton
          offset={16}
          containerAriaLabel="Notifications"
        />
      </Suspense>
    </>
  )
}

/* ---------------------------------------------------------------------------
   THEME BRIDGE
   ---------------------------------------------------------------------------
   Kept here rather than in src/index.css on purpose: the whole feature is then
   one deletable file, which is what the rollback instructions promise.

   On the selectors — sonner's rules are mostly `[data-sonner-toast][data-
   styled=true] X`, which is specificity 0,3,0, and its palette lives on
   `[data-sonner-toaster][data-sonner-theme=light|dark]` at 0,2,0. Every rule
   below is written to clear those outright rather than to tie and win on
   document order, because document order here depends on where React happens
   to mount a <style> relative to a stylesheet sonner injected into <head> —
   which is not a thing to stake a colour scheme on.

   On the ERROR colour — this app has no red token. Its existing error banner
   in DashboardScene is `border-brand/40 bg-brand/10`, so `brand` IS the app's
   alert colour. A hardcoded red here would be the one element on the page that
   ignores the palette, which is exactly the failure this file exists to avoid.
   --------------------------------------------------------------------------- */
const TOAST_CSS = `
.pt-toaster[data-sonner-toaster][data-sonner-theme] {
  --normal-bg: var(--color-surface);
  --normal-bg-hover: var(--color-surface-2);
  --normal-border: var(--color-border);
  --normal-border-hover: var(--color-brand);
  --normal-text: var(--color-foreground);
  --gray2: var(--color-surface-2);
  --gray5: var(--color-border);
  --border-radius: 10px;
  font-family: var(--app-ui);
}

/* A hard offset cast, not a blurred drop shadow — the same depth language the
   board panels use (.pane-cast). A soft black shadow is literally invisible on
   the near-black palettes; index.css already worked this out the hard way. */
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] {
  box-shadow: 3px 3px 0 var(--pt-cast-c);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-title] {
  font-weight: 500;
  color: var(--color-foreground);
}

.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-description] {
  color: var(--color-muted);
  font-size: 0.75rem;
}

/* The Undo affordance. Brand on background is a token PAIR, so it stays legible
   in every palette: brand is dark on the light modes and bright on the dark
   ones, and background moves with it. */
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-button] {
  background: var(--color-brand);
  color: var(--color-background);
  border-radius: 6px;
  font-family: inherit;
  font-weight: 600;
  height: 26px;
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-button]:hover {
  background: var(--color-brand-soft);
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-button]:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
  box-shadow: none;
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-cancel] {
  background: var(--color-surface-2);
  color: var(--color-foreground);
}

/* sonner's built-in icons are drawn with fill:currentColor, so a colour on the
   wrapper is enough — no need to ship replacement SVGs. */
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-type='success'] [data-icon] {
  color: var(--color-done);
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-type='error'] [data-icon] {
  color: var(--color-brand);
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-type='warning'] [data-icon] {
  color: var(--color-doing);
}
.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-type='info'] [data-icon] {
  color: var(--color-brand-soft);
}

.pt-toaster[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .pt-toaster[data-sonner-toaster],
  .pt-toaster[data-sonner-toaster] [data-sonner-toast],
  .pt-toaster[data-sonner-toaster] [data-sonner-toast] * {
    transition: none !important;
    animation: none !important;
  }
}
`
