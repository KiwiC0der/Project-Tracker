import { useEffect, useId, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import * as I from '@/lib/insights'
import { PriorityPicker, DatePicker } from '@/components/ui/pickers'
import type { Priority, Task, TaskStatus } from '@/lib/store'
import type { Ctx } from './shared'

/* ============================================================================
   TASK DIALOG

   Rendered once at scene level, never inside a panel. Board panels are
   `overflow-hidden` with their own stacking contexts, so a dialog mounted in
   one would be clipped by the panel that opened it.

   Text fields commit on blur and on close rather than on every keystroke: each
   write is a round trip, and the `tasks_touch` trigger means each one also
   moves the task's staleness clock.
   ========================================================================== */
export function TaskDialog({ ctx }: { ctx: Ctx }) {
  const t = ctx.tasks.find((x) => x.id === ctx.editing) ?? null
  const opener = useRef<Element | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  // Local buffer for the text fields only; selects and pickers write straight
  // through, because there is no half-typed state to lose.
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!t) return
    setTitle(t.title)
    setNotes(t.notes ?? '')
    opener.current = document.activeElement
    titleRef.current?.focus()
    titleRef.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.editing])

  const close = () => {
    if (t) {
      const clean = title.trim()
      if (clean && clean !== t.title) ctx.patch(t.id, { title: clean })
      if (notes !== (t.notes ?? '')) ctx.patch(t.id, { notes })
    }
    ctx.setEditing(null)
    // Focus has to come back where it left, or a keyboard user is dropped at
    // the top of the document every time they edit a task.
    ;(opener.current as HTMLElement | null)?.focus?.()
  }

  useEffect(() => {
    if (!t) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close() }
      if (e.key !== 'Tab' || !box.current) return
      // A modal that lets Tab wander behind it is not modal.
      const f = box.current.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  if (!t) return null

  const label = 'ui-face mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted'
  const field = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 sm:items-center"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={box}
        role="dialog" aria-modal="true" aria-labelledby={`${uid}-h`}
        className="pane-cast max-h-full w-full max-w-md overflow-auto rounded-xl border border-border bg-surface"
        data-active="true"
      >
        <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
          <h2 id={`${uid}-h`} className="ui-face text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted">
            Edit task
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={close} aria-label="Close"
            className="rounded p-0.5 text-muted hover:bg-brand/20 hover:text-foreground">
            <X size={14} />
          </button>
        </header>

        <div className="p-3">
          <label className="mb-2.5 block">
            <span className={label}>Title</span>
            <input ref={titleRef} className={field} value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { const c = title.trim(); if (c && c !== t.title) ctx.patch(t.id, { title: c }) }} />
          </label>

          <label className="mb-2.5 block">
            <span className={label}>Notes</span>
            <textarea className={`${field} min-h-[4.5rem] resize-y`} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (t.notes ?? '')) ctx.patch(t.id, { notes }) }} />
          </label>

          <div className="mb-2.5 grid gap-2.5 sm:grid-cols-2">
            <div>
              <span className={label} id={`${uid}-p`}>Priority</span>
              <PriorityPicker value={t.priority}
                onChange={(p: Priority) => ctx.patch(t.id, { priority: p })} />
            </div>
            <div>
              <span className={label} id={`${uid}-d`}>Expected completion</span>
              <DatePicker value={t.due_date}
                onChange={(d) => ctx.patch(t.id, { due_date: d })} />
            </div>
          </div>

          <div className="mb-3">
            <span className={label}>Status</span>
            <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Status">
              {I.COLUMNS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={t.status === c.id}
                  onClick={() => ctx.move(t.id, c.id as TaskStatus)}
                  className={`flex-1 rounded-md py-1 text-xs transition-colors
                    ${t.status === c.id ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2.5">
            <span className="num text-[0.62rem] text-muted">
              Rank {I.score(t)} · {Math.round(I.staleness(t) * 100)}% stale · added{' '}
              {I.shortDate(new Date(t.created_at).getTime())}
            </span>
            <span className="flex-1" />
            {/* No confirm() here any more. Deleting a task now raises an Undo
                toast that genuinely re-creates the row, so a blocking dialog
                would ask permission for something already reversible — and
                the native one is unstyled, unthemed, and stops the world. */}
            <button type="button"
              onClick={() => { ctx.remove(t.id); ctx.setEditing(null) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/50 px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
              <Trash2 size={12} />Delete
            </button>
            <button type="button" onClick={close}
              className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export type { Task }
