/**
 * ============================================================================
 * ERROR REPORTING — one seam, three inputs
 * ----------------------------------------------------------------------------
 * Before this file the app had no error boundary, no `window.onerror`, and no
 * `unhandledrejection` handler. A throw during render unmounted the tree to a
 * white page, and because nothing recorded it the first person to find out was
 * whoever opened the site next. That is OWASP A09 and A10 in one failure.
 *
 * Three paths can now produce an error, and they all end here:
 *
 *   render phase        → <ErrorBoundary> (componentDidCatch)
 *   everything else     → window 'error'          (event handlers, timers)
 *   rejected promises   → window 'unhandledrejection'
 *
 * They funnel into `reportError`, which builds a redacted record and hands it
 * to `deliver`. `deliver` is the seam: wiring a real service is an edit to
 * that one function body, not to three call sites. See the comment on it.
 *
 * ----------------------------------------------------------------------------
 * WHAT MAY LEAVE THE DEVICE — the redaction rule
 * ----------------------------------------------------------------------------
 * An error report is a payload built on this machine and (once a service is
 * wired) posted to a third party. Two things in this app must never be in it:
 *
 *   - USER CONTENT. Task titles, project names and note bodies are the whole
 *     substance of what someone keeps here. They are private by default.
 *   - THE SESSION. A Supabase access token lives in localStorage under
 *     `project-tracker-auth`. A token in a bug report is a handed-over account.
 *
 * So collection is an ALLOWLIST, not a filter: the fields on `ErrorReport`
 * below are the only things ever read. Nothing in this module touches
 * localStorage, sessionStorage, cookies, component props or component state.
 * `location` is read for `pathname` alone — never `search` or `hash`, which is
 * where an id or a token would be if one ever ended up in a URL.
 *
 * That leaves the free-text fields — `message` and `stack` — which are the one
 * way user content can arrive here without anyone deciding it should. It does
 * happen: `store.ts` rethrows PostgREST messages verbatim, and a unique-
 * constraint violation reads `Key (name)=(Q3 layoffs) already exists`. So both
 * fields go through `scrub`, which blanks quoted spans, `Key (col)=(value)`
 * details, addresses and token-shaped runs before anything is kept.
 *
 * `scrub` runs on the way IN, not on the way out. The unredacted string is
 * never stored on the report object at all, so there is no field a later edit
 * can accidentally start sending.
 *
 * ----------------------------------------------------------------------------
 * THE CONSOLE IS NOT TOUCHED
 * ----------------------------------------------------------------------------
 * Neither handler calls `preventDefault`, and nothing here wraps or replaces a
 * console method. The browser's own logging is currently the maintainer's only
 * signal that anything went wrong, and a reporting layer that quietly ate it
 * would leave the app observably worse than it was with no reporting at all.
 * ============================================================================
 */
import { ENHANCEMENTS } from '@/lib/enhancements'

export type ErrorSource = 'render' | 'window.error' | 'unhandledrejection' | 'resource'

/** The allowlist. Nothing outside these fields is ever collected. */
export interface ErrorReport {
  source: ErrorSource
  /** Constructor name — `TypeError`, `Error`. Never user-supplied. */
  name: string
  /** Scrubbed. See `scrub`. */
  message: string
  /** Scrubbed and truncated. Frame URLs are same-origin bundle paths. */
  stack: string
  /** React's component stack, render path only. Empty for the global paths. */
  componentStack: string
  at: string
  /** `location.pathname` only — never search or hash. */
  path: string
  userAgent: string
  /** Vite's build mode, so a demo build's noise is separable from production. */
  mode: string
}

/* --------------------------------------------------------------------------
   REDACTION
   -------------------------------------------------------------------------- */

const MAX_MESSAGE = 400
const MAX_STACK = 2000
const MAX_COMPONENT_STACK = 1500

/**
 * Blank the places user content and credentials turn up inside a free-text
 * error string. Order matters: the token and address patterns run before the
 * quote pattern, because a quoted token should be reported as a token rather
 * than disappearing into a generic redaction.
 *
 * This is deliberately blunt. A scrubber that tries to keep as much as
 * possible is one that fails open the first time a backend phrases a message
 * in a way nobody anticipated, and the cost of over-redacting is a slightly
 * duller bug report — while the cost of under-redacting is someone's task
 * titles in a third party's database.
 */
export function scrub(input: unknown, limit = MAX_MESSAGE): string {
  if (typeof input !== 'string') return ''
  return input
    // JWTs — the Supabase access token's shape. Three base64url segments.
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[token]')
    // Any other long opaque run: api keys, bearer tokens, raw row ids.
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[token]')
    .replace(/\b[^\s@]+@[^\s@.]+\.[^\s@]+\b/g, '[email]')
    // PostgREST echoes the offending row back in constraint violations:
    // `Key (name)=(Q3 layoffs) already exists.` The column name is schema and
    // is worth keeping; the value is the user's.
    .replace(/(\bKey\s*\([^)]*\)\s*=\s*\()[^)]*\)/g, '$1[redacted])')
    // Everything this app quotes in a message is a title or a name.
    .replace(/"[^"]*"/g, '"[redacted]"')
    .replace(/'[^']*'/g, "'[redacted]'")
    .replace(/`[^`]*`/g, '`[redacted]`')
    .replace(/[“‘][^”’]*[”’]/g, '[redacted]')
    // A query string is the one place in a URL a secret hides.
    .replace(/([?#])[^\s)'"]*/g, '$1[redacted]')
    .slice(0, limit)
}

/* --------------------------------------------------------------------------
   BUILDING
   -------------------------------------------------------------------------- */

/**
 * Assemble a redacted record.
 *
 * Not gated behind the feature flag, and deliberately so: the error boundary's
 * "copy error detail" button calls this directly, and that button has to keep
 * working when reporting is switched off. A crash must never be harder to
 * diagnose because telemetry is disabled.
 */
export function buildReport(
  source: ErrorSource,
  error: unknown,
  componentStack = '',
): ErrorReport {
  const e = error instanceof Error ? error : null
  return {
    source,
    name: e?.name || (error === null || error === undefined ? 'NonError' : typeof error),
    // A thrown non-Error (`throw 'boom'`, or a rejected promise carrying a
    // response object) still has to say something useful, so fall back to
    // String() — through the same scrubber, since it can carry anything.
    message: scrub(e ? e.message : safeString(error)),
    stack: scrub(e?.stack ?? '', MAX_STACK),
    componentStack: scrub(componentStack, MAX_COMPONENT_STACK),
    at: new Date().toISOString(),
    path: typeof location === 'undefined' ? '' : location.pathname,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 200),
    mode: import.meta.env.MODE,
  }
}

/** `String(x)` throws for a null-prototype object or a hostile `toString`. */
function safeString(v: unknown): string {
  try {
    return String(v)
  } catch {
    return '[unstringifiable]'
  }
}

/** The clipboard payload for the boundary's fallback. Same redacted record —
    what a person pastes into a public bug tracker must be safe to paste. */
export function formatReport(r: ErrorReport): string {
  return [
    `Project Tracker error report`,
    `source:    ${r.source}`,
    `when:      ${r.at}`,
    `path:      ${r.path}`,
    `build:     ${r.mode}`,
    `agent:     ${r.userAgent}`,
    ``,
    `${r.name}: ${r.message}`,
    ``,
    r.stack || '(no stack)',
    r.componentStack ? `\ncomponent stack:${r.componentStack}` : '',
    ``,
    `Quoted values, addresses and token-shaped strings are replaced with`,
    `placeholders before this text is produced. No task or note content and no`,
    `session token is included.`,
  ].join('\n')
}

/* --------------------------------------------------------------------------
   DISPATCH
   -------------------------------------------------------------------------- */

/**
 * THE SEAM.
 *
 * Today this drops the report. That is the honest state of things — there is
 * no reporting service and adding an SDK would have meant a dependency, a
 * bundle, and a third party seeing every message before anyone had decided
 * what may be sent.
 *
 * Wiring one is an edit to this function body and nothing else:
 *
 *     navigator.sendBeacon(
 *       'https://<collector>/report',
 *       new Blob([JSON.stringify(report)], { type: 'application/json' }),
 *     )
 *
 * `sendBeacon` rather than `fetch` because the common case is a page that is
 * already coming apart, and a beacon survives the unload that a fetch does
 * not. It is also fire-and-forget, which matters here: a reporting call that
 * can itself reject would feed `unhandledrejection` and loop.
 *
 * Whatever goes here must not throw — see the guard in `reportError`.
 */
function deliver(report: ErrorReport): void {
  void report
}

/**
 * Report an error from any of the three paths.
 *
 * Reads the flag first so that with `errorReporting: false` the whole body
 * folds away at build time, exactly as the toast and confetti features do —
 * see src/lib/enhancements.ts.
 */
export function reportError(source: ErrorSource, error: unknown, componentStack = ''): void {
  if (!ENHANCEMENTS.errorReporting) return
  try {
    deliver(buildReport(source, error, componentStack))
  } catch {
    /* A reporter that throws while reporting turns one broken view into a
       broken page, and if it throws from inside the global handler it does it
       recursively. Failing silently is the only correct behaviour here — the
       browser console still has the original error, untouched. */
  }
}

/* --------------------------------------------------------------------------
   GLOBAL HANDLERS
   -------------------------------------------------------------------------- */

/** Marked on `window`, not in a module-level `let`. Vite re-executes a module
    on HMR, which would reset a local flag while the previously registered
    listeners are still attached — every subsequent error would then be
    reported twice, or four times, for as long as the dev session lasted. */
const INSTALLED = '__ptErrorHandlersInstalled'

/**
 * Idempotent. Safe to call from StrictMode's double-invoked effects and safe
 * across an HMR update.
 *
 * `addEventListener('error')` rather than assigning `window.onerror`: the
 * property form is a single slot, so whoever assigns last wins and everyone
 * else's handler silently stops running. It also picks up resource load
 * failures, which the property form reports only as "Script error." — and a
 * failed chunk request is the exact shape of a stale index.html after a
 * deploy, which is worth knowing about.
 */
export function installGlobalErrorHandlers(): void {
  if (!ENHANCEMENTS.errorReporting) return
  if (typeof window === 'undefined') return
  const w = window as unknown as Record<string, unknown>
  if (w[INSTALLED]) return
  w[INSTALLED] = true

  addEventListener('error', (event: ErrorEvent) => {
    if (event.error !== undefined && event.error !== null) {
      reportError('window.error', event.error)
      return
    }
    // No `error` property means a resource failed to load rather than a script
    // throwing; the event's target is the element. Only its origin and path go
    // in — a query string on an asset URL could be a signed one.
    const target = event.target
    const src =
      target instanceof HTMLScriptElement ? target.src
      : target instanceof HTMLLinkElement ? target.href
      : target instanceof HTMLImageElement ? target.src
      : ''
    if (!src) return
    let where = src
    try {
      const u = new URL(src, location.href)
      where = `${u.origin}${u.pathname}`
    } catch {
      /* a data: or blob: URL — reported as-is, scrub handles the rest */
    }
    reportError('resource', new Error(`Failed to load ${where}`))
  })

  addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError('unhandledrejection', event.reason)
  })

  /* Neither listener calls preventDefault. The browser still logs both to the
     console, which is the only signal the maintainer has today. */
}
