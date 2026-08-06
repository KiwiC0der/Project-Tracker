import { useState } from 'react'
import * as I from '@/lib/insights'
import type { Project, Task, TaskStatus, User } from '@/lib/store'

/** Everything a panel or view needs. Passed down rather than context-ed so a
    panel is trivially testable and its dependencies are visible. */
export interface Ctx {
  projects: Project[]
  tasks: Task[]
  projectTasks: Task[]
  activeProject: string | null
  selected: string | null
  setSelected: (id: string | null) => void
  patch: (id: string, p: Partial<Task>) => Promise<void>
  move: (id: string, s: TaskStatus) => Promise<void>
  remove: (id: string) => Promise<void>
  add: (text: string, projectId?: string) => Promise<Task | null>
  user: User
}

export function TaskCard({ t, ctx }: { t: Task; ctx: Ctx }) {
  const od = I.isOverdue(t)
  const due = I.dueAt(t)
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); ctx.setSelected(t.id) }}
      onClick={() => ctx.setSelected(t.id)}
      className={`w-full cursor-grab rounded-lg border bg-background p-2.5 text-left transition-colors
        ${ctx.selected === t.id ? 'border-brand' : 'border-border hover:border-border-soft'}
        ${od ? 'border-l-2 border-l-brand' : ''}`}
    >
      <span className={`block text-sm leading-snug ${t.status === 'done' ? 'text-muted line-through' : ''}`}>
        {t.title}
      </span>
      <span className="num mt-1 block text-[0.65rem] text-muted">
        {t.priority}
        {due != null && (
          <> · <span className={od ? 'font-semibold text-brand' : ''}>
            {od ? 'overdue ' : ''}{I.relDay(due)}
          </span></>
        )}
      </span>
    </button>
  )
}

export function BoardColumns({ ctx, stacked }: { ctx: Ctx; stacked?: boolean }) {
  return (
    <div className={`grid gap-3 ${stacked ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
      {I.COLUMNS.map((col) => {
        const items = ctx.projectTasks.filter((t) => t.status === col.id)
        return (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain')
              if (id) ctx.move(id, col.id)
            }}
            className="flex min-h-[5rem] flex-col gap-2"
          >
            <div className="ui-face flex items-center gap-2 border-b border-border pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
              {col.name}<span className="num ml-auto">{items.length}</span>
            </div>
            {items.map((t) => <TaskCard key={t.id} t={t} ctx={ctx} />)}
          </div>
        )
      })}
    </div>
  )
}

export function QuickAdd({ ctx, placeholder }: { ctx: Ctx; placeholder?: string }) {
  const [v, setV] = useState('')
  const preview = v.trim() ? I.parse(v, ctx.projects) : null
  return (
    <div>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (await ctx.add(v)) setV('')
        }}
        placeholder={placeholder ?? 'ship the hero !high @fri'}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <p className="num mt-1 text-[0.65rem] text-muted">
        {preview
          ? <>Creates <b className="text-foreground">{preview.title || '(no title)'}</b> · {preview.priority} · {preview.due ? I.relDay(preview.due) : 'no date'}</>
          : <>!high · @fri · /project — Enter to add</>}
      </p>
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
