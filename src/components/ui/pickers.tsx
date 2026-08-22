import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

   (Fixed is safe here. It is NOT safe in the top bar: that header has a
   backdrop-filter, which makes it the containing block for fixed descendants.)
   ========================================================================== */

export const PANEL =
  'fixed z-[60] rounded-xl border border-border bg-surface p-1.5 shadow-2xl'

/**
 * Exported so the sidebar's group editors get the same popover behaviour these
 * pickers have rather than a second, subtly different implementation:
 * fixed placement that escapes an overflow-hidden ancestor, dismissal on
 * outside pointerdown and on scroll, and — the part that matters most in the
 * sidebar — Escape captured and stopped so it closes the popover WITHOUT also
 * reaching the window-level listener that closes the whole drawer.
 */
export function usePopover(open: boolean, onClose: () => void) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const t = trigger.current, p = panel.current
    if (!t || !p) return
    const place = () => {
      const a = t.getBoundingClientRect()
      const b = p.getBoundingClientRect()
      const gap = 6
      // Below unless there is no room, then above.
      const below = a.bottom + gap
      const top = below + b.height > innerHeight - 8 && a.top - gap - b.height > 8
        ? a.top - gap - b.height
        : below
      const left = Math.max(8, Math.min(a.left, innerWidth - b.width - 8))
      setPos({ top, left })
    }
    place()
    // A fixed panel does not travel with its trigger, so any scroll would leave
    // it stranded mid-page. Native selects close too.
    const bye = () => onClose()
    addEventListener('scroll', bye, true)
    addEventListener('resize', bye)
    return () => { removeEventListener('scroll', bye, true); removeEventListener('resize', bye) }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const n = e.target as Node
      if (!panel.current?.contains(n) && !trigger.current?.contains(n)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()          // do not also close a dialog behind this
      const back = trigger.current
      onClose()
      // Refocus AFTER React has committed the unmount. Both a synchronous call
      // and a microtask run BEFORE the commit, so focus lands on a node that is
      // then removed and the browser falls back to <body> — dumping a keyboard
      // user at the top of the document every time they dismiss a popover.
      // A rAF is past the commit; the guard covers the trigger itself having
      // unmounted in the meantime.
      requestAnimationFrame(() => { if (back?.isConnected) back.focus() })
    }
    addEventListener('pointerdown', down)
    addEventListener('keydown', key, true)
    return () => { removeEventListener('pointerdown', down); removeEventListener('keydown', key, true) }
  }, [open, onClose])

  // Rendered off-screen for one frame so it can be measured before placing.
  const style = pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }
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
        <div ref={panel} role="listbox" aria-label="Priority" style={style} className={`${PANEL} w-[10rem]`}>
          {PRIORITIES.map((p) => (
            <button
              key={p.id} type="button" role="option" aria-selected={p.id === value}
              onClick={() => { onChange(p.id); close(); trigger.current?.focus() }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm
                ${p.id === value ? 'bg-brand/15' : 'hover:bg-surface-2'}`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: p.tone }} />
              {p.label}
            </button>
          ))}
        </div>
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
  const pick = (d: Date) => { onChange(isoDay(d)); close(); trigger.current?.focus() }

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
              onClick={() => { onChange(null); close(); trigger.current?.focus() }}
              className="flex-1 rounded-md py-1 text-xs text-muted hover:bg-surface-2">Clear</button>
          </div>
        </div>
      )}
    </>
  )
}
