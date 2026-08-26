import { useRef, useState } from 'react'
import { GripVertical, Pencil, Plus } from 'lucide-react'
import * as I from '@/lib/insights'
import * as O from '@/lib/order'
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button'
import { CreateTaskDialog } from './CreateTaskDialog'
import { projectTone } from './ProjectDialog'
import type { Project, Task, TaskStatus, User } from '@/lib/store'

/** The scope that means "every project at once". A sentinel rather than null,
    because null already means "this account has no projects" — an empty account
    and an all-projects view are opposite states, and conflating them would make
    a brand new account render as if it were showing everything. Never a real
    row id, so no `project_id` may ever be written with it. */
export const ALL_PROJECTS = '__all__'

/** Ask this rather than string-comparing at each of the two dozen call sites. */
export const isAllScope = (id: string | null): boolean => id === ALL_PROJECTS

/** Everything a panel or view needs. Passed down rather than context-ed so a
    panel is trivially testable and its dependencies are visible. */
export interface Ctx {
  projects: Project[]
  tasks: Task[]
  projectTasks: Task[]
  activeProject: string | null
  selected: string | null
  setSelected: (id: string | null) => void
  /** The task open in the edit dialog. Rendered at scene level, not in a panel. */
  editing: string | null
  setEditing: (id: string | null) => void
  patch: (id: string, p: Partial<Task>) => Promise<void>
  move: (id: string, s: TaskStatus) => Promise<void>
  /** Place a task at an explicit index of a status column. */
  reorder: (id: string, s: TaskStatus, index: number) => Promise<void>
  remove: (id: string) => Promise<void>
  add: (text: string, projectId?: string) => Promise<Task | null>
  user: User
}

/* ============================================================================
   TASK CARD

   A wrapper div, not a button. The card carries three separate controls — a
   grip, the title, and an edit pencil — and nesting buttons inside a button is
   invalid HTML that screen readers flatten into one confusing control.
   ========================================================================== */
function TaskCard({
  t, ctx, onGrab, dragging, onKey, project, keyShortcuts, grabbable,
}: {
  t: Task
  ctx: Ctx
  onGrab: (e: React.PointerEvent, id: string) => void
  dragging: boolean
  onKey: (e: React.KeyboardEvent, id: string) => void
  /** Set only in All scope. Inside one project every card would carry the
      same label, which is noise, not information. */
  project?: Project | null
  keyShortcuts: string
  /** False in All scope. A grip and a grab cursor on a card that cannot be
      dragged is a promise the board does not keep. */
  grabbable: boolean
}) {
  const od = I.isOverdue(t)
  const due = I.dueAt(t)
  const tone = t.priority === 'high' ? 'var(--color-brand)'
    : t.priority === 'medium' ? 'var(--color-doing)' : 'var(--color-muted)'

  return (
    <div
      data-task={t.id}
      onPointerDown={(e) => onGrab(e, t.id)}
      className={`group/card relative flex items-start gap-1 rounded-lg border bg-background p-2.5 transition-colors
        ${ctx.selected === t.id ? 'border-brand' : 'border-border hover:border-border-soft'}
        ${od ? 'border-l-2 border-l-brand' : ''}
        ${dragging ? 'pointer-events-none opacity-60' : ''}`}
    >
      {/* Touch drags start here and only here — `touch-action: none` on the
          whole card would stop the page scrolling under a finger. */}
      {grabbable && <span
        data-grip
        aria-hidden="true"
        style={{ touchAction: 'none' }}
        className="mt-0.5 shrink-0 cursor-grab text-muted opacity-0 transition-opacity group-hover/card:opacity-60 active:cursor-grabbing"
      >
        <GripVertical size={13} />
      </span>}

      <button
        type="button"
        onClick={() => ctx.setSelected(t.id)}
        onDoubleClick={() => ctx.setEditing(t.id)}
        onKeyDown={(e) => onKey(e, t.id)}
        aria-keyshortcuts={keyShortcuts}
        data-drag-ok
        className={`min-w-0 flex-1 text-left ${grabbable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span className={`block text-sm leading-snug ${t.status === 'done' ? 'text-muted line-through' : ''}`}>
          {t.title}
        </span>
        <span className="num mt-1 flex items-center gap-1 text-[0.65rem] text-muted">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
          {t.priority}
          {due != null && (
            <> · <span className={od ? 'font-semibold text-brand' : ''}>
              {od ? 'overdue ' : ''}{I.relDay(due)}
            </span></>
          )}
        </span>
        {project && (
          <span className="num mt-1 flex items-center gap-1 text-[0.65rem] text-muted">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full"
              style={{ background: projectTone(project.color) }} />
            {project.name}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label={`Edit ${t.title}`}
        onClick={() => ctx.setEditing(t.id)}
        className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-brand/20 hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}

/* ============================================================================
   BOARD COLUMNS — drag to reorder within a column, or across columns.

   Pointer events rather than HTML5 drag-and-drop, which does not fire on touch
   at all, and rather than a sortable library, because Alt+arrow keyboard moves
   are the same gesture the Workboard already uses for panels.

   The drag lifts only after ~6px of travel, so a plain click still selects.
   ========================================================================== */
const LIFT = 6

interface Drag {
  id: string
  from: TaskStatus
  x0: number; y0: number
  dx: number; dy: number
  live: boolean
  to: TaskStatus | null
  index: number
}

export function BoardColumns({ ctx, stacked }: { ctx: Ctx; stacked?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const all = isAllScope(ctx.activeProject)
  const byId = new Map(ctx.projects.map((p) => [p.id, p]))

  /* A merged column has no hand-order to honour: `position` is only comparable
     within one project and one status (see the header of lib/order.ts), so
     interleaving two projects by position would sort by numbers that were never
     measured against each other. Sorting by the sidebar's project order FIRST
     and only then by position keeps each project's own hand-order intact as a
     contiguous block — the one arrangement the user actually authored — and
     makes the merged list stable across reloads. */
  const rank = new Map(ctx.projects.map((p, i) => [p.id, i]))
  const columnFor = (status: TaskStatus) =>
    all
      ? ctx.tasks
        .filter((t) => t.status === status)
        .sort((a, b) =>
          (rank.get(a.project_id) ?? Infinity) - (rank.get(b.project_id) ?? Infinity) ||
          O.byOrder(a, b))
      : O.column(ctx.tasks, ctx.activeProject, status)

  /** Which column, and which slot in it, is under the pointer. Indices are
      counted with the dragged card excluded, which is exactly the frame
      planMove expects — "drop at 3" then means the same thing whether the task
      came from this column or another. */
  const targetAt = (x: number, y: number, id: string) => {
    const cols = [...(root.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [])]
    const col = cols.find((c) => {
      const r = c.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    })
    if (!col) return null
    const cards = [...col.querySelectorAll<HTMLElement>('[data-task]')].filter((c) => c.dataset.task !== id)
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) { index = i; break }
    }
    return { to: col.dataset.col as TaskStatus, index }
  }

  const onGrab = (e: React.PointerEvent, id: string) => {
    // Reordering is per-project and there is no merged order to drop into.
    if (all) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const el = e.target as HTMLElement
    // The title is a button and covers most of the card, so it has to be
    // draggable — only the action buttons (the pencil) block a grab.
    if (el.closest('button') && !el.closest('[data-drag-ok]')) return
    // Touch may only drag from the grip; a finger anywhere else is a scroll.
    if (e.pointerType === 'touch' && !el.closest('[data-grip]')) return

    const t = ctx.tasks.find((x) => x.id === id)
    if (!t) return
    const start: Drag = { id, from: t.status, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, live: false, to: null, index: 0 }
    let cur = start

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x0, dy = ev.clientY - start.y0
      const live = cur.live || Math.hypot(dx, dy) > LIFT
      const hit = live ? targetAt(ev.clientX, ev.clientY, id) : null
      cur = { ...cur, dx, dy, live, to: hit?.to ?? null, index: hit?.index ?? 0 }
      if (live) ev.preventDefault()
      setDrag(cur)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      if (cur.live) {
        // A completed drag still emits a click. Left alone it would select the
        // card the user was only moving, so the next one is swallowed.
        const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
        addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => removeEventListener('click', swallow, true), 0)
        if (cur.to) ctx.reorder(id, cur.to, cur.index)
      }
      setDrag(null)
    }
    addEventListener('pointermove', move, { passive: false })
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
  }

  /* Alt+arrows: the same language the Workboard uses to move panels. Up and
     down move within the column, left and right across columns. */
  const onKey = (e: React.KeyboardEvent, id: string) => {
    if (!e.altKey) return
    const t = ctx.tasks.find((x) => x.id === id)
    if (!t) return
    const here = O.column(ctx.tasks, t.project_id, t.status)
    const at = here.findIndex((x) => x.id === id)
    const cols = I.COLUMNS.map((c) => c.id)
    const ci = cols.indexOf(t.status)

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Same reason the pointer drag is off in All scope. Left/right stay live:
      // those write a status, not a position.
      if (all) return
      const to = at + (e.key === 'ArrowUp' ? -1 : 1)
      if (to < 0 || to >= here.length) return
      e.preventDefault()
      ctx.reorder(id, t.status, to)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const nc = cols[ci + (e.key === 'ArrowLeft' ? -1 : 1)]
      if (!nc) return
      e.preventDefault()
      ctx.reorder(id, nc, Math.min(at, O.column(ctx.tasks, t.project_id, nc).length))
    }
  }

  return (
    <div ref={root}>
      {all && (
        <p className="num mb-2 text-[0.65rem] text-muted">
          Every project at once · ordering is per-project — open one to reorder
        </p>
      )}
      <div className={`grid gap-3 ${stacked ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
      {I.COLUMNS.map((col) => {
        const items = columnFor(col.id)
        const rest = items.filter((t) => t.id !== drag?.id)
        const showLine = drag?.live && drag.to === col.id

        return (
          <div key={col.id} data-col={col.id} className="flex min-h-[5rem] flex-col gap-2">
            <div className="ui-face flex items-center gap-2 border-b border-border pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
              {col.name}<span className="num ml-auto">{items.length}</span>
            </div>

            {/* The dragged card keeps its slot in the flow — pulling it out
                would reflow the list under the pointer mid-gesture. */}
            {items.map((t) => {
              const line = showLine && rest[drag!.index]?.id === t.id
              return (
                <div key={t.id} className="contents">
                  {line && <Insertion />}
                  <div
                    style={drag?.id === t.id && drag.live
                      ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 40, position: 'relative' }
                      : undefined}
                  >
                    <TaskCard
                      t={t} ctx={ctx} onGrab={onGrab} onKey={onKey}
                      dragging={drag?.id === t.id && drag.live}
                      project={all ? byId.get(t.project_id) ?? null : null}
                      grabbable={!all}
                      keyShortcuts={all
                        ? 'Alt+ArrowLeft Alt+ArrowRight'
                        : 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight'}
                    />
                  </div>
                </div>
              )
            })}
            {showLine && drag!.index >= rest.length && <Insertion />}
          </div>
        )
      })}
      </div>
    </div>
  )
}

const Insertion = () => (
  <div aria-hidden="true" className="-my-1 h-0.5 shrink-0 rounded-full bg-brand" />
)

/* ---------------------------------------------------------------------- */

/**
 * QUICK ADD — the entry point to creating a task.
 *
 * Was a bare text input that created on Enter. It is now a button that opens
 * CreateTaskDialog, which is the same natural-language field plus the Notes,
 * Status and Project a task actually has, and a preview you can correct before
 * anything is written. `!high @fri /project` still work; they just fill the
 * dialog's controls instead of being invisible.
 *
 * The name and props are unchanged, because two scenes render this.
 * `placeholder` now names the button — a panel that wants "Capture" instead of
 * "New task" keeps working.
 *
 * No token hint under the button. The dialog states the tokens itself, in the
 * field they act on, at the moment you are typing into it — a second copy out
 * here was the same sentence twice, and the one further from the input is the
 * one that reads as clutter.
 */
export function QuickAdd({ ctx, placeholder }: { ctx: Ctx; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  return (
    /* The gap is explicit now. It used to come from the token-hint line sitting
       under the button; with that gone the button's glow ran straight into the
       column headings. */
    <div className="mb-3">
      <LiquidMetalButton
        label={placeholder ?? 'New task'}
        icon={<Plus size={14} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      {/* Portals itself to <body>: this panel is overflow-hidden. */}
      <CreateTaskDialog ctx={ctx} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

export function Burndown({ tasks, days = 30, height = 90 }: { tasks: Task[]; days?: number; height?: number }) {
  const series = I.timeline(tasks, days)
  if (series.length < 2) return null
  const W = 320, PADL = 24, PADB = 14, PADT = 6
  const max = Math.max(1, ...series.map((d) => d.total))
  const x = (i: number) => PADL + (i / (series.length - 1)) * (W - PADL - 6)
  const y = (v: number) => PADT + (1 - v / max) * (height - PADT - PADB)
  const path = (key: 'open' | 'done') =>
    series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ')
  const last = series[series.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img"
      aria-label={`${last.open} open and ${last.done} done over ${days} days`}>
      <line x1={PADL} x2={W - 6} y1={y(0)} y2={y(0)} stroke="var(--color-border)" strokeWidth=".5" />
      <line x1={PADL} x2={W - 6} y1={y(max)} y2={y(max)} stroke="var(--color-border)" strokeWidth=".5" />
      <text x={PADL - 4} y={y(max) + 3} textAnchor="end" fill="var(--color-muted)" fontSize="7">{max}</text>
      <text x={PADL - 4} y={y(0) + 3} textAnchor="end" fill="var(--color-muted)" fontSize="7">0</text>
      <path d={path('open')} fill="none" stroke="var(--color-brand)" strokeWidth="1.4" />
      <path d={path('done')} fill="none" stroke="var(--color-muted)" strokeWidth="1.4" strokeDasharray="3 2" />
      <text x={W - 6} y={y(last.open) - 4} textAnchor="end" fill="var(--color-foreground)" fontSize="7" fontWeight="700">open {last.open}</text>
      <text x={W - 6} y={y(last.done) + 9} textAnchor="end" fill="var(--color-muted)" fontSize="7" fontWeight="700">done {last.done}</text>
    </svg>
  )
}
