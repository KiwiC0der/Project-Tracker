import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import * as I from '@/lib/insights'
import { isoDay } from '@/lib/order'
import { PriorityPicker, DatePicker } from '@/components/ui/pickers'
import type { Priority, Task, TaskStatus } from '@/lib/store'
import type { Ctx } from './shared'

/* ============================================================================
   CREATE TASK DIALOG

   The composing twin of TaskDialog, and deliberately built to the same shape:
   same chrome, same focus trap, same Escape handling, same return of focus to
   whatever opened it, same backdrop-click-to-dismiss. Creating and editing a
   task should not feel like two different products.

   Two things differ, both because nothing exists yet:

   * Nothing is written until Save. TaskDialog writes through on blur because
     it is editing a row that already exists; here there is no row, so the whole
     form is local state and one create call happens at the end.

   * The Title field is still the natural-language capture the old quick-add
     input was. `I.parse` runs on every keystroke, and `!high @fri /project`
     move the Priority, Expected-completion and Project controls instead of
     being silently swallowed into the title. Touching one of those controls by
     hand pins it, until a token for that same field is typed — then the token
     wins again, because the user just said something more specific.

   Portalled to <body>. Board panels are `overflow-hidden` with their own
   stacking contexts (see the note at the top of TaskDialog.tsx), and this
   dialog is opened from inside one of them, so mounting it in place would
   clip it to the panel that opened it.
   ========================================================================== */

const BLANK = { title: '', notes: '' }

/** `YYYY-MM-DD` back to a LOCAL date. `new Date('2026-08-25')` is UTC midnight
    and reads as the 24th west of Greenwich, which would make the preview line
    disagree with the DatePicker sitting right under it. */
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function CreateTaskDialog({
  ctx, open, onClose,
}: {
  ctx: Ctx
  open: boolean
  onClose: () => void
}) {
  const opener = useRef<Element | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  // Raw, token-bearing text. `parsed.title` is what actually gets stored.
  const [raw, setRaw] = useState(BLANK.title)
  const [notes, setNotes] = useState(BLANK.notes)
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [saving, setSaving] = useState(false)

  // `null` means "still following the tokens in the title".
  const [pinPriority, setPinPriority] = useState<Priority | null>(null)
  const [pinDue, setPinDue] = useState<{ v: string | null } | null>(null)
  const [pinProject, setPinProject] = useState<string | null>(null)
  // The due token is remembered as a calendar day, not a timestamp: `@3d`
  // resolves off `Date.now()` and would otherwise differ on every keystroke.
  const lastTokens = useRef({ priority: 'medium' as Priority, due: null as string | null, project: null as string | null })

  const parsed = I.parse(raw, ctx.projects)
  const priority: Priority = pinPriority ?? parsed.priority
  const due: string | null = pinDue
    ? pinDue.v
    : parsed.due != null ? isoDay(new Date(parsed.due)) : null
  const projectId: string | null = pinProject ?? parsed.projectId ?? ctx.activeProject
  const clean = parsed.title.trim()

  /* Reset every time the dialog opens, and remember who opened it. */
  useEffect(() => {
    if (!open) return
    setRaw(BLANK.title)
    setNotes(BLANK.notes)
    setStatus('todo')
    setPinPriority(null)
    setPinDue(null)
    setPinProject(null)
    setSaving(false)
    lastTokens.current = { priority: 'medium', due: null, project: null }
    opener.current = document.activeElement
    // One frame, so the field exists before it is asked to take focus.
    const id = requestAnimationFrame(() => titleRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const close = () => {
    onClose()
    // Focus has to come back where it left, or a keyboard user is dropped at
    // the top of the document every time they cancel.
    ;(opener.current as HTMLElement | null)?.focus?.()
  }

  const submit = async () => {
    if (!clean || saving) return
    setSaving(true)
    // `add` re-parses what it is given; `clean` has already had its tokens
    // stripped, so it carries only the title and lands on the default
    // priority/status. Everything the create call cannot express follows in
    // one patch — the same two-step DashboardScene's own `add` uses for @fri.
    const t = await ctx.add(clean, projectId ?? undefined)
    if (!t) { setSaving(false); return }

    const rest: Partial<Task> = {}
    if (priority !== t.priority) rest.priority = priority
    if (due !== (t.due_date ?? null)) rest.due_date = due
    if (notes.trim()) rest.notes = notes
    if (status !== t.status) rest.status = status
    if (Object.keys(rest).length) await ctx.patch(t.id, rest)

    close()
  }

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); return }
      if (e.key !== 'Tab' || !box.current) return
      // A modal that lets Tab wander behind it is not modal.
      const f = box.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  if (!open) return null

  /** Typing a token for a field un-pins that field: the most recent, most
      specific thing the user said should win. */
  const onTitle = (next: string) => {
    const p = I.parse(next, ctx.projects)
    const day = p.due != null ? isoDay(new Date(p.due)) : null
    const was = lastTokens.current
    if (p.priority !== was.priority) setPinPriority(null)
    if (day !== was.due) setPinDue(null)
    if (p.projectId !== was.project) setPinProject(null)
    lastTokens.current = { priority: p.priority, due: day, project: p.projectId }
    setRaw(next)
  }

  const label = 'ui-face mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted'
  const field = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand'
  const project = ctx.projects.find((p) => p.id === projectId)

  return createPortal(
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
            New task
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={close} aria-label="Close"
            className="rounded p-0.5 text-muted hover:bg-brand/20 hover:text-foreground">
            <X size={14} />
          </button>
        </header>

        <div className="p-3">
          <label className="mb-1 block">
            <span className={label}>Title</span>
            <input
              ref={titleRef} name="title" className={field} value={raw}
              placeholder="ship the hero !high @fri /project"
              aria-describedby={`${uid}-hint`}
              aria-required="true"
              onChange={(e) => onTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void submit()
              }}
            />
          </label>

          {/* The quick-add hint, kept verbatim in spirit: what the tokens do,
              and what the form will actually create once they are typed. */}
          <p id={`${uid}-hint`} className="num mb-2.5 text-[0.65rem] text-muted" aria-live="polite">
            {clean
              ? <>Creates <b className="text-foreground">{clean}</b> · {priority} · {due ? I.relDay(fromIso(due).getTime()) : 'no date'}{project ? <> · {project.name}</> : null}</>
              : <>!high · @fri · /project — tokens fill the fields below</>}
          </p>

          <label className="mb-2.5 block">
            <span className={label}>Notes</span>
            <textarea name="notes" className={`${field} min-h-[4.5rem] resize-y`} value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="mb-2.5 grid gap-2.5 sm:grid-cols-2">
            <div>
              <span className={label} id={`${uid}-p`}>Priority</span>
              <PriorityPicker value={priority} onChange={(p: Priority) => setPinPriority(p)} />
            </div>
            <div>
              <span className={label} id={`${uid}-d`}>Expected completion</span>
              <DatePicker value={due} onChange={(d) => setPinDue({ v: d })} />
            </div>
          </div>

          {ctx.projects.length > 1 && (
            <label className="mb-2.5 block">
              <span className={label}>Project</span>
              <select name="project" className={field} value={projectId ?? ''}
                onChange={(e) => setPinProject(e.target.value)}>
                {ctx.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="mb-3">
            <span className={label}>Status</span>
            <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Status">
              {I.COLUMNS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={status === c.id}
                  onClick={() => setStatus(c.id)}
                  className={`flex-1 rounded-md py-1 text-xs transition-colors
                    ${status === c.id ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2.5">
            <span className="num text-[0.62rem] text-muted">Enter to add · Esc to cancel</span>
            <span className="flex-1" />
            <button type="button" onClick={close}
              className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">Cancel</button>
            <button type="button" onClick={() => void submit()}
              disabled={!clean || saving}
              className="rounded-lg border border-brand/50 bg-brand/10 px-2.5 py-1 text-xs text-foreground
                         disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-brand/20">
              {saving ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
