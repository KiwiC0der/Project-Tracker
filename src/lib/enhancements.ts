/**
 * ============================================================================
 * ENHANCEMENT FLAGS — the rollback switch
 * ============================================================================
 *
 * Two pieces of feedback UI were added on top of the app: success toasts and a
 * confetti burst. Both are opinionated, both are the kind of thing you either
 * love or find noisy after a week, and neither is load-bearing — the app worked
 * without them. So they are gated here rather than woven in, and turning one
 * off is a one-character edit.
 *
 * Error reporting joined them for a different reason. It is not a matter of
 * taste — it is the one feature here that sends anything anywhere, so it needs
 * a switch that can be thrown without a code review, by someone who has just
 * decided they do not want a third party seeing crash payloads today.
 *
 * ----------------------------------------------------------------------------
 * TURNING A FEATURE OFF (temporary — keeps the code around)
 * ----------------------------------------------------------------------------
 * Flip its flag to `false` below and rebuild. That is the whole procedure.
 *
 * Every entry point checks its flag before doing anything:
 *   - `toasts`    → `<ToastPortal>` renders null and `notify.*` returns early,
 *                   so sonner is never imported, never injects its stylesheet,
 *                   and never emits a chunk request. Nothing paints, nothing
 *                   logs, no dangling <style> tag in <head>.
 *   - `celebrate` → `celebrate()` returns immediately; canvas-confetti is never
 *                   imported, so no <canvas> is ever appended to <body>.
 *   - `errorReporting`
 *                 → `reportError()` and `installGlobalErrorHandlers()` return
 *                   at the first line, so no listener is ever attached and no
 *                   payload is ever built for dispatch. The ERROR BOUNDARY IS
 *                   NOT AFFECTED: it still catches, still renders its fallback,
 *                   and its "copy error detail" button still works, because a
 *                   crash must never be harder to deal with because telemetry
 *                   is off. The browser console is untouched either way.
 *
 * Both features are behind DYNAMIC imports guarded by these flags, which is
 * deliberate: a static import would run the dependency's module side effects
 * (sonner injects a <style> block into <head> at import time) even with the
 * feature switched off. With the flag false the branch is dead and the bundler
 * drops the import along with it.
 *
 * This object is a plain `as const` literal and is NOT passed through
 * `Object.freeze()`. `as const` gives the same immutability guarantee where it
 * matters — the compiler rejects any write — while a runtime `Object.freeze()`
 * call is opaque to Rollup's scope analysis and would stop it folding
 * `ENHANCEMENTS.toasts` to a literal, which is what lets the dead branch and
 * the whole dependency chunk disappear from the build.
 *
 * ----------------------------------------------------------------------------
 * REMOVING A FEATURE PERMANENTLY
 * ----------------------------------------------------------------------------
 *
 * TOASTS
 *   1. Delete `src/components/ui/toast.tsx`.
 *   2. In `src/main.tsx`, delete the `ToastPortal` import and the
 *      `<ToastPortal />` element (2 lines).
 *   3. Strip every `notify.*(...)` call site. Find them with:
 *        grep -rn "notify\." src
 *      As of this writing the intended call sites all live in
 *      `src/scenes/DashboardScene.tsx`.
 *   4. `npm uninstall sonner`
 *   5. Delete the `toasts` key below.
 *
 * CELEBRATE
 *   1. Delete `src/components/ui/celebrate.tsx`.
 *   2. Strip every `celebrate(...)` call site. Find them with:
 *        grep -rn "celebrate" src
 *   3. `npm uninstall canvas-confetti @types/canvas-confetti`
 *   4. Delete the `celebrate` key below.
 *
 * ERROR REPORTING
 *   Do not remove this one to quieten it — set the flag to `false` instead.
 *   Deleting it means deleting `src/lib/report.ts`, which is also what
 *   `src/components/ErrorBoundary.tsx` builds its clipboard payload from, so
 *   the boundary would have to be rewritten to keep working.
 *
 * REMOVING BOTH
 *   Do both feedback-UI lists, then delete `docs/SOURCED-COMPONENTS.md`. This
 *   file stays as long as `errorReporting` does.
 *
 * ============================================================================
 */

export const ENHANCEMENTS = {
  /** Success / error / undo toasts (sonner). */
  toasts: true,
  /** Confetti burst on a genuine milestone (canvas-confetti). */
  celebrate: true,
  /** Collect and dispatch crash reports — see src/lib/report.ts. No SDK and no
      dependency; today `deliver()` is a no-op, so this gates a seam rather
      than a network call. Off still leaves the boundary and the console. */
  errorReporting: true,
} as const

export type EnhancementFlag = keyof typeof ENHANCEMENTS
