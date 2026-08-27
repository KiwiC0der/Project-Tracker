/**
 * ============================================================================
 * ERROR BOUNDARY
 * ----------------------------------------------------------------------------
 * A class, because there is no hook equivalent — `componentDidCatch` and
 * `getDerivedStateFromError` have no function-component form and React has no
 * plans for one. This is the only class in the app and it is not a style
 * lapse.
 *
 * WHAT IT CANNOT DO, so nobody assumes otherwise: a boundary catches errors
 * thrown during render, in lifecycle methods, and in constructors of the tree
 * BELOW it. It does not catch event handlers, `setTimeout` callbacks, rejected
 * promises, or its own render. Those are covered by the global handlers in
 * src/lib/report.ts, which is why both exist.
 *
 * ----------------------------------------------------------------------------
 * THE FALLBACK'S CONSTRAINTS
 * ----------------------------------------------------------------------------
 * It renders on the worst day this app has, so it holds itself to rules the
 * rest of the UI does not need:
 *
 *  - IT IMPORTS NOTHING FROM THE APP except the reporting module, which is a
 *    leaf with no dependency of its own beyond a plain flags object. No icon
 *    library, no `cn`, no store, no toast. Anything it imported would be
 *    another thing that could be the reason it is on screen.
 *
 *  - NO LITERAL COLOURS. Eleven theme families times light and dark is
 *    twenty-two palettes, and a hardcoded hex is wrong in at least twenty-one
 *    of them. Every colour is a design token, so the fallback takes whatever
 *    palette is live — including one added later.
 *
 *  - EVERY CONTROL IS THE SAME NEUTRAL TREATMENT. The obvious move is a brand
 *    filled primary button, and it was rejected: `--color-brand` is chosen per
 *    family for accent contrast against the surface, not for legibility of
 *    text sitting ON it, and in the lighter families (Orchid's acid green,
 *    Terminal's phosphor) foreground-on-brand is not reliably readable.
 *    `--color-foreground` on `--color-surface-2` is solved in every palette,
 *    so that is what all three buttons use. Emphasis comes from order, not
 *    from colour.
 *
 *  - IT SAYS WHAT HAPPENED AND WHAT TO DO. No stack trace on screen: the
 *    person looking at it is the user, and a stack is noise to them and a
 *    small information leak to anyone else at their shoulder. The detail is
 *    behind a copy button instead, redacted, for pasting into a bug report.
 * ============================================================================
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { buildReport, formatReport, reportError, type ErrorReport } from '@/lib/report'

interface Props {
  children: ReactNode
  /** Fill the viewport and centre. For the outermost boundary, where there is
      no surviving chrome to sit inside. */
  full?: boolean
  /** Ran before a retry, so the parent can drop whatever state led here. */
  onReset?: () => void
}

interface State {
  report: ErrorReport | null
  /** Retries so far. See the cap in `render`. */
  attempts: number
  copy: 'idle' | 'copied' | 'manual'
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { report: null, attempts: 0, copy: 'idle' }

  /* Runs first and without the component stack, so it only has to flip the
     tree into the fallback. The report is filled in a beat later by
     componentDidCatch, which is the only place React hands over the stack. */
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { report: buildReport('render', error), copy: 'idle' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = buildReport('render', error, info.componentStack ?? '')
    this.setState({ report })
    reportError('render', error, info.componentStack ?? '')
  }

  private retry = (): void => {
    this.props.onReset?.()
    this.setState((s) => ({ report: null, attempts: s.attempts + 1, copy: 'idle' }))
  }

  private copy = (): void => {
    const { report } = this.state
    if (!report) return
    const text = formatReport(report)
    /* clipboard.writeText is unavailable outside a secure context and can be
       refused by permissions policy. Falling through to a selectable textarea
       keeps the detail reachable rather than leaving a button that does
       nothing — which is exactly the kind of dead control that makes a crash
       screen feel like a second failure. */
    navigator.clipboard?.writeText(text).then(
      () => this.setState({ copy: 'copied' }),
      () => this.setState({ copy: 'manual' }),
    ) ?? this.setState({ copy: 'manual' })
  }

  render(): ReactNode {
    const { report, attempts, copy } = this.state
    if (!report) return this.props.children

    // A retry re-renders the same subtree with the same inputs, so a
    // deterministic crash comes straight back. Offering the button a third
    // time is offering a loop; past two, reloading is the only honest advice.
    const canRetry = attempts < 2

    const panel = (
      <div
        role="alert"
        className="pane-cast ui-face flex max-w-lg flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-foreground"
      >
        {/* The outermost boundary has no surviving chrome around it, so "this
            part of the page" would be describing something the reader cannot
            see any other part of. */}
        <p className="font-medium">
          {this.props.full ? 'Project Tracker could not be displayed.' : 'This part of the page stopped working.'}
        </p>
        {/* Deliberately makes no claim about where the data lives: the same
            build runs against Supabase and against the localStorage demo
            backend, and "stored on the server" would be a lie in one of them.
            What is true in both is that the failure was in the drawing, not in
            the saving. */}
        <p className="text-muted">
          This is a display problem — nothing you had saved was changed or lost.{' '}
          {canRetry ? 'Try again, or reload the page.' : 'Reloading the page should clear it.'}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {canRetry && (
            <button type="button" onClick={this.retry} className={BUTTON}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => location.reload()} className={BUTTON}>
            Reload the page
          </button>
          <button type="button" onClick={this.copy} className={BUTTON}>
            Copy error detail
          </button>
        </div>

        {/* Announced rather than only shown, so the outcome of pressing Copy
            reaches someone who is not looking at the button. */}
        <p aria-live="polite" className="min-h-4 text-xs text-muted">
          {copy === 'copied' ? 'Copied. It contains no task or note text.' : ''}
          {copy === 'manual' ? 'Clipboard unavailable — select and copy the text below.' : ''}
        </p>

        {copy === 'manual' && (
          <textarea
            readOnly
            rows={8}
            aria-label="Error detail"
            className="scroll-thin w-full resize-none rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs text-foreground"
            value={formatReport(report)}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
    )

    if (!this.props.full) return <div className="p-3">{panel}</div>

    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-4">{panel}</div>
    )
  }
}

/* Focus is not styled here on purpose: `:focus-visible` in src/index.css
   already paints a 2px brand outline on everything, and a local override is
   one more thing to keep correct across twenty-two palettes. */
const BUTTON =
  'rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground ' +
  'transition-colors hover:border-brand'
