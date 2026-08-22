import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Calendar as CalIcon, X } from 'lucide-react'
import { isoDay } from '@/lib/order'
import type { Priority } from '@/lib/store'

/* ============================================================================
   PICKERS — a priority menu and a calendar, both on one popover primitive.

   The panel is `position: fixed`, not absolute. These live inside board panels
   whose bodies are `overflow-auto`, and an absolutely positioned menu is
   clipped at the panel edge — you would open the calendar and see the top two
   rows of it. Fixed escapes the scroll container, at the cost of having to
   close on scroll, which is exactly what a native <select> does anyway.

   Fixed alone is NOT enough, though, and that was the sidebar bug: `fixed` is
   still CLIPPED by an ancestor's `overflow: hidden`, and it is still trapped
   inside an ancestor's stacking context. The sidebar's <aside> is both
   (`overflow-hidden`, `z-50`) with a scrolling `overflow-y-auto` region inside
   it, so a fixed z-[80] panel rendered in that subtree came out clipped to the
   sidebar AND painted under the dashboard. The same trap applies in the top
   bar, whose `backdrop-filter` makes the header a containing block for fixed
   descendants.

   The cure for all three at once is to render the panel through a portal to
   <body> — <PopoverPortal> below — so it has no clipping, filtering or
   stacking ancestor at all. Placement is already computed in viewport
   coordinates, which is exactly what `fixed` on <body> wants, so the maths is
   unchanged by the move.
   ========================================================================== */

/* Above the dialogs (z-[70]): a picker opened from inside TaskDialog is now a
   sibling of that dialog in <body> rather than a descendant of it, so it no
   longer inherits the dialog's stacking context to sit on top of. */
export const PANEL =
  'fixed z-[80] max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain ' +
  'rounded-xl border border-border bg-surface p-1.5 shadow-2xl'

/**
 * Renders a popover panel at the end of <body>.
 *
 * A component rather than an inline `createPortal(...)` at each call site so
 * every popover escapes the same way, and declared at module scope so its
 * identity is stable across renders (a component defined inside another
 * component is a new type every render, and React would unmount and remount
 * the whole panel — losing focus and any open nested layer — on every keystroke
 * elsewhere in the tree).
 */
export function PopoverPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/* ----------------------------------------------------------------------------
   ESCAPE STACK

   Escape must close exactly ONE layer: the innermost open one. Every layer
   listening on its own captured window keydown cannot do that — capture runs
   outermost-listener-first by registration order, so the popover that opened
   first would win and an inner dropdown could never see the key.

   So there is one captured window listener, and layers push onto a LIFO stack.
   Only the top of the stack is invoked, and propagation is stopped there, which
   is what keeps a single Escape from also reaching the dialog behind the
   popover or the window listener that closes the sidebar drawer.
   -------------------------------------------------------------------------- */
const escapeStack: Array<() => void> = []
let escapeBound = false

function onWindowEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const top = escapeStack[escapeStack.length - 1]
  if (!top) return
  e.stopPropagation()
  top()
}

/** Claim Escape for as long as a layer is open. Returns its own release. */
export function pushEscape(handler: () => void) {
  escapeStack.push(handler)
  if (!escapeBound) {
    addEventListener('keydown', onWindowEscape, true)
    escapeBound = true
  }
  return () => {
    const i = escapeStack.lastIndexOf(handler)
    if (i !== -1) escapeStack.splice(i, 1)
  }
}

/**
 * Return focus to `el` AFTER React has committed the unmount that Escape (or a
 * selection) just triggered. Both a synchronous call and a microtask run BEFORE
 * the commit, so focus lands on a node that is then removed and the browser
 * falls back to <body> — dumping a keyboard user at the top of the document
 * every time they dismiss a popover. A rAF is past the commit; the guard covers
 * the target itself having unmounted in the meantime.
 */
export function refocus(el: HTMLElement | null) {
  requestAnimationFrame(() => { if (el?.isConnected) el.focus() })
}

/**
 * Exported so the sidebar's group editors and the appearance panel get the same
 * popover behaviour these pickers have rather than a second, subtly different
 * implementation: fixed placement (portalled, so no ancestor can clip it),
 * dismissal on outside pointerdown and on scroll, and Escape claimed through
 * the stack above so it closes this popover WITHOUT also reaching whatever is
 * behind it.
 *
 * `align: 'end'` right-aligns the panel to the trigger instead of left-aligning
 * it — for triggers that live at the right edge of the window.
 */
export function usePopover(
  open: boolean,
  onClose: () => void,
  { align = 'start' }: { align?: 'start' | 'end' } = {},
) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const t = trigger.current, p = panel.current
    if (!t || !p) return
    const pad = 8, gap = 6
    const place = () => {
      // The INITIAL containing block, not `innerWidth`. They differ by the
      // scrollbars, and — the case that actually bit — by any horizontal
      // overflow elsewhere on the page: `innerWidth` grows with the scrollable
      // width, so clamping to it parks a popover out in the overflow where the
      // reader has to scroll sideways to find it. documentElement's client box
      // is the part of the page that is genuinely on screen.
      const vw = document.documentElement.clientWidth || innerWidth
      const vh = document.documentElement.clientHeight || innerHeight
      const a = t.getBoundingClientRect()
      const b = p.getBoundingClientRect()
      // Below unless there is no room, then above.
      const below = a.bottom + gap
      const above = a.top - gap - b.height
      let top = below + b.height > vh - pad && above > pad ? above : below
      // ...and clamp regardless, so a panel that fits in NEITHER direction is
      // pinned inside the viewport and scrolls internally rather than running
      // off the bottom of the screen. This is what stops the appearance panel
      // from being 849px tall in a 722px window with its last rows unreachable.
      top = Math.max(pad, Math.min(top, vh - b.height - pad))
      const anchor = align === 'end' ? a.right - b.width : a.left
      const left = Math.max(pad, Math.min(anchor, vw - b.width - pad))
      setPos({ top, left, maxHeight: vh - pad * 2 })
    }
    place()
    // A fixed panel does not travel with its trigger, so any scroll would leave
    // it stranded mid-page. Native selects close too. Scrolling INSIDE the
    // panel is not that — with a max-height the panel has its own scrollbar,
    // and using it must not dismiss the thing you are reading.
    const bye = (e: Event) => {
      const n = e.target as Node | null
      if (n && n.nodeType === 1 && panel.current?.contains(n)) return
      onClose()
    }
    addEventListener('scroll', bye, true)
    addEventListener('resize', bye)
    return () => { removeEventListener('scroll', bye, true); removeEventListener('resize', bye) }
  }, [open, onClose, align])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const n = e.target as Node
      if (!panel.current?.contains(n) && !trigger.current?.contains(n)) onClose()
    }
    const release = pushEscape(() => {
      const back = trigger.current
      onClose()
      refocus(back)
    })
    addEventListener('pointerdown', down)
    return () => { removeEventListener('pointerdown', down); release() }
  }, [open, onClose])

  // Rendered off-screen for one frame so it can be measured before placing.
  const style = pos
    ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
    : { top: -9999, left: -9999 }
  return { trigger, panel, style }
}

const FIELD =
  'flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none hover:border-brand focus-visible:border-brand'

/* ---------------------------------------------------------------------- */

export const PRIORITIES: { id: Priority; label: string; tone: string }[] = [
  { id: 'high', label: 'High', tone: 'var(--color-brand)' },
  { id: 'medium', label: 'Medium', tone: 'var(--color-doing)' },
  { id: 'low', label: 'Low', tone: 'var(--color-muted)' },
]

export function PriorityPicker({
  value, onChange, id,
}: { value: Priority; onChange: (p: Priority) => void; id?: string }) {
  const [open, setOpen] = useState(false)
  const close = useRef(() => setOpen(false)).current
  const { trigger, panel, style } = usePopover(open, close)
  const current = PRIORITIES.find((p) => p.id === value) ?? PRIORITIES[1]

  return (
    <>
      <button
        ref={trigger} id={id} type="button"
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={FIELD}
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: current.tone }} />
        <span className="flex-1 text-left">{current.label}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>

      {open && (
        <PopoverPortal>
          <div ref={panel} role="listbox" aria-label="Priority" style={style} className={`${PANEL} w-[10rem]`}>
            {PRIORITIES.map((p) => (
              <button
                key={p.id} type="button" role="option" aria-selected={p.id === value}
                onClick={() => { onChange(p.id); close(); refocus(trigger.current) }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm
                  ${p.id === value ? 'bg-brand/15' : 'hover:bg-surface-2'}`}
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: p.tone }} />
                {p.label}
              </button>
            ))}
          </div>
        </PopoverPortal>
      )}
    </>
  )
}

/* ---------------------------------------------------------------------- */

const DAY = 86_400_000
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Parse `YYYY-MM-DD` as a LOCAL date. `new Date('2026-08-11')` is parsed as
    UTC midnight and renders as the 10th in the Americas. */
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function DatePicker({
  value, onChange, id,
}: { value: string | null; onChange: (d: string | null) => void; id?: string }) {
  const [open, setOpen] = useState(false)
  const close = useRef(() => setOpen(false)).current
  const { trigger, panel, style } = usePopover(open, close)

  const selected = value ? fromIso(value) : null
  const [month, setMonth] = useState(() => {
    const d = selected ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  // Reopening on a task with a different date should land on that month.
  useEffect(() => {
    if (!open) return
    const d = value ? fromIso(value) : new Date()
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [open, value])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const gridStart = new Date(month.getTime() - month.getDay() * DAY)
  const pick = (d: Date) => { onChange(isoDay(d)); close(); refocus(trigger.current) }

  return (
    <>
      <button
        ref={trigger} id={id} type="button"
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={FIELD}
      >
        <CalIcon size={14} className="shrink-0 text-muted" />
        <span className={`flex-1 text-left ${selected ? '' : 'text-muted'}`}>
          {selected
            ? selected.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : 'No date'}
        </span>
        {selected && (
          // A nullable field needs a way back to null, and burying that in the
          // calendar means opening a menu to un-set something.
          <span
            role="button" tabIndex={0} aria-label="Clear due date"
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(null) } }}
            className="rounded p-0.5 text-muted hover:bg-brand/20 hover:text-foreground"
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>

      {open && (
        <PopoverPortal>
        <div ref={panel} role="dialog" aria-label="Choose a due date" style={style} className={`${PANEL} w-[16rem]`}>
          <div className="mb-1 flex items-center gap-1 px-1">
            <button type="button" aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground">‹</button>
            <span className="ui-face flex-1 text-center text-xs font-semibold">
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground">›</button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEK.map((d) => (
              <span key={d} className="ui-face py-0.5 text-center text-[0.55rem] uppercase tracking-wider text-muted">{d}</span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(gridStart.getTime() + i * DAY)
              d.setHours(0, 0, 0, 0)
              const out = d.getMonth() !== month.getMonth()
              const isToday = d.getTime() === today.getTime()
              const on = selected != null && d.getTime() === selected.getTime()
              return (
                <button
                  key={i} type="button" onClick={() => pick(d)}
                  aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  aria-current={isToday ? 'date' : undefined}
                  className={`num rounded-md py-1 text-center text-xs transition-colors
                    ${on ? 'bg-brand text-white' : out ? 'text-muted/50 hover:bg-surface-2' : 'hover:bg-surface-2'}
                    ${isToday && !on ? 'ring-1 ring-inset ring-brand' : ''}`}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-1 flex gap-1 border-t border-border-soft pt-1">
            <button type="button" onClick={() => pick(new Date())}
              className="flex-1 rounded-md py-1 text-xs hover:bg-surface-2">Today</button>
            <button type="button" onClick={() => pick(new Date(Date.now() + DAY))}
              className="flex-1 rounded-md py-1 text-xs hover:bg-surface-2">Tomorrow</button>
            <button type="button"
              onClick={() => { onChange(null); close(); refocus(trigger.current) }}
              className="flex-1 rounded-md py-1 text-xs text-muted hover:bg-surface-2">Clear</button>
          </div>
        </div>
        </PopoverPortal>
      )}
    </>
  )
}
