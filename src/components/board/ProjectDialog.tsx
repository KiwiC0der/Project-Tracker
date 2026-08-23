import { useEffect, useId, useRef, useState } from 'react'
import { Check, Loader2, Trash2, X } from 'lucide-react'
import { DatePicker } from '@/components/ui/pickers'
import type { ProjectStatus } from '@/lib/store'

/* ============================================================================
   PROJECT DIALOG

   Replaces `window.prompt('Project name')`. A prompt could only ever collect
   one string, so `projects.description`, `.color` and `.status` were columns
   nothing could ever set — every row was born violet and active with no blurb.

   Mounted at scene level for the same reason TaskDialog is: board panels are
   `overflow-hidden` with their own stacking contexts and would clip a dialog
   opened from inside them.

   Structure, focus trap, Escape handling, focus return, backdrop dismissal and
   the header/footer language are deliberately the same as TaskDialog's — two
   dialogs in one app that behave differently are two bugs waiting to be filed.

   The one real divergence: TaskDialog edits a row that already exists, so it
   commits field by field on blur. There is no row here yet, so this one buffers
   everything locally and writes once on submit. That is also why Escape can
   mean "never mind" — there is nothing written to undo.
   ========================================================================== */

/** projects.name is `check (char_length(name) between 1 and 120)`. */
export const PROJECT_NAME_MAX = 120

export const PROJECT_COLORS: { id: string; label: string; tone: string }[] = [
  /* 'violet' is the column default and the value every pre-existing row carries,
     so it resolves to the live theme accent. Those rows keep rendering exactly
     as they did when the sidebar dot was a hard-coded `bg-brand`, and the
     default choice still tracks whichever palette the user is on. The rest are
     literal hexes: a project colour is an identity, and it should not shuffle
     when someone switches theme. */
  { id: 'violet', label: 'Default', tone: 'var(--color-brand)' },
  { id: 'rose', label: 'Rose', tone: '#f43f5e' },
  { id: 'amber', label: 'Amber', tone: '#f59e0b' },
  { id: 'lime', label: 'Lime', tone: '#84cc16' },
  { id: 'emerald', label: 'Emerald', tone: '#10b981' },
  { id: 'cyan', label: 'Cyan', tone: '#06b6d4' },
  { id: 'blue', label: 'Blue', tone: '#3b82f6' },
  { id: 'fuchsia', label: 'Fuchsia', tone: '#d946ef' },
]

/**
 * Resolve a stored colour to something paintable. Anything unrecognised — a row
 * written by an older build, or hand-edited in the SQL editor — falls back to
 * the theme accent rather than rendering an invisible dot.
 */
export function projectTone(color: string | null | undefined): string {
  return PROJECT_COLORS.find((c) => c.id === color)?.tone ?? 'var(--color-brand)'
}

export const PROJECT_STATUSES: { id: ProjectStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archived' },
]

export interface ProjectDraft {
  name: string
  description: string
  color: string
  status: ProjectStatus
  /** ISO yyyy-mm-dd, or null for "no target". See Project.target_date. */
  target_date: string | null
  /** Null for "not budgeted" — deliberately distinct from 0. */
  weekly_hours: number | null
}

const EMPTY: ProjectDraft = {
  name: '', description: '', color: 'violet', status: 'active',
  target_date: null, weekly_hours: null,
}

/** projects.weekly_hours is `check (weekly_hours between 1 and 168)`. */
const HOURS_MIN = 1
const HOURS_MAX = 168

export function ProjectDialog({
  open,
  mode = 'create',
  initial,
  onSubmit,
  onDelete,
  armDelete = false,
  onClose,
}: {
  open: boolean
  /** Drives the heading and the submit label. The fields are the same either way. */
  mode?: 'create' | 'edit'
  initial?: Partial<ProjectDraft>
  /**
   * Return a message to keep the dialog open and show it inline; return
   * null/undefined once the write has landed and the caller has closed.
   */
  onSubmit: (draft: ProjectDraft) => Promise<string | null | void>
  /**
   * Supplied only in edit mode, and only by callers that can actually delete.
   * Same contract as onSubmit: a returned message means it failed and the
   * dialog stays put. Confirmation is this dialog's job, not the caller's —
   * `window.confirm` is unstyled, unthemed and cannot say which project it
   * means, and the answer belongs next to the thing being deleted.
   */
  onDelete?: () => Promise<string | null | void>
  /** Open straight into the confirmation, for a caller whose button already
      said "Delete project" and should not make the user say it twice. */
  armDelete?: boolean
  onClose: () => void
}) {
  const opener = useRef<Element | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const killRef = useRef<HTMLButtonElement>(null)
  const uid = useId()

  const [draft, setDraft] = useState<ProjectDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** The footer swaps to a confirmation row rather than stacking a second
      dialog: a modal over a modal has two focus traps and one of them loses. */
  const [confirming, setConfirming] = useState(false)

  // Re-seed on every open, not on mount: one dialog instance outlives any one
  // project, so a stale draft would otherwise leak into the next one.
  useEffect(() => {
    if (!open) return
    setDraft({ ...EMPTY, ...initial })
    setProblem(null)
    setBusy(false)
    const arm = armDelete && mode === 'edit' && Boolean(onDelete)
    setConfirming(arm)
    opener.current = document.activeElement
    if (!arm) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* Arming the confirmation moves focus onto it — both when the user clicks
     "Delete" and when the dialog opens already armed, which is why this is an
     effect rather than a line in the click handler. */
  useEffect(() => {
    if (open && confirming) killRef.current?.focus()
  }, [open, confirming])

  const close = () => {
    onClose()
    // Focus has to come back where it left, or a keyboard user is dropped at the
    // top of the document every time they open this.
    ;(opener.current as HTMLElement | null)?.focus?.()
  }

  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const submit = async () => {
    // Saving is off the table while the confirmation is showing: Enter in the
    // name field would otherwise quietly answer a question about deletion.
    if (busy || confirming) return
    const name = draft.name.trim()
    if (!name) {
      // Refuse rather than disable the button: a disabled control is
      // unfocusable and announces nothing, so a keyboard user just finds a
      // dead button and no explanation.
      setProblem('A project needs a name.')
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    setProblem(null)
    const failed = await onSubmit({ ...draft, name, description: draft.description.trim() })
    // On success the caller flips `open` and this subtree goes away, so only the
    // failure path has state left to write.
    if (failed) {
      setBusy(false)
      setProblem(failed)
    }
  }

  const destroy = async () => {
    if (busy || !onDelete) return
    setBusy(true)
    setProblem(null)
    const failed = await onDelete()
    // Success closes this subtree from the caller; only a failure has state
    // left to write — and it drops back out of the confirmation, because
    // re-pressing a "Delete" that just failed should be a deliberate act.
    if (failed) {
      setBusy(false)
      setConfirming(false)
      setProblem(failed)
    }
  }

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirming) {
        // Back out of the confirmation first. Still captured and stopped, so
        // this Escape does not reach the sidebar either.
        e.preventDefault()
        e.stopPropagation()
        setConfirming(false)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Captured and stopped, the way pickers.tsx stops Escape reaching the
        // dialog behind a popover. The sidebar closes itself on Escape at the
        // window level, and this dialog is opened FROM the sidebar: without
        // this, one Escape would dismiss the dialog and the drawer together,
        // and the drawer going `inert` would blur the button we just restored
        // focus to, dropping a keyboard user on <body>.
        e.stopPropagation()
        close()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); return }
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
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })

  if (!open) return null

  const label = 'ui-face mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted'
  const field = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand'
  const left = PROJECT_NAME_MAX - draft.name.length
  const heading = mode === 'edit' ? 'Edit project' : 'New project'

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
            {heading}
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={close} aria-label="Close"
            className="rounded p-0.5 text-muted hover:bg-brand/20 hover:text-foreground">
            <X size={14} />
          </button>
        </header>

        <form className="p-3" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
          <label className="mb-2.5 block">
            <span className={label}>
              Name
              {left <= 24 && (
                <span className="num ml-1.5 font-normal normal-case tracking-normal">{left} left</span>
              )}
            </span>
            <input
              ref={nameRef} className={field} value={draft.name}
              /* The form never submits natively, but a field with neither id
                 nor name trips a DevTools issue and invites browser autofill
                 into a project title. */
              name="project-name" autoComplete="off"
              /* Matches the column's CHECK, so the limit is felt in the field
                 rather than reported back as a constraint violation. */
              maxLength={PROJECT_NAME_MAX}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${uid}-err` : undefined}
              placeholder="Website redesign"
              onChange={(e) => { set('name', e.target.value); if (problem) setProblem(null) }}
            />
          </label>

          <label className="mb-2.5 block">
            <span className={label}>
              Description <span className="font-normal normal-case tracking-normal">optional</span>
            </span>
            <textarea
              className={`${field} min-h-[4.5rem] resize-y`} value={draft.description}
              name="project-description" autoComplete="off"
              placeholder="What is this project for?"
              onChange={(e) => set('description', e.target.value)}
            />
          </label>

          <div className="mb-2.5">
            <span className={label} id={`${uid}-c`}>Colour</span>
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-labelledby={`${uid}-c`}>
              {PROJECT_COLORS.map((c) => {
                const on = draft.color === c.id
                return (
                  <button
                    key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label}
                    onClick={() => set('color', c.id)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors
                      ${on ? 'border-foreground' : 'border-border hover:border-brand'}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: c.tone }}
                    >
                      {on && <Check size={10} strokeWidth={3} className="text-white" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mb-3">
            <span className={label}>Status</span>
            <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Status">
              {PROJECT_STATUSES.map((s) => (
                <button
                  key={s.id} type="button" role="radio" aria-checked={draft.status === s.id}
                  onClick={() => set('status', s.id)}
                  className={`flex-1 rounded-md py-1 text-xs transition-colors
                    ${draft.status === s.id ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Planning sits after identity (name, colour, status) because it is the
              part a new project often cannot answer yet. Two fields side by side
              rather than stacked: the dialog is already near the height of a
              laptop viewport, and the box scrolls rather than overflowing. */}
          <div className="mb-3 grid gap-2.5 sm:grid-cols-2">
            <div>
              <span className={label} id={`${uid}-t`}>
                Target date <span className="font-normal normal-case tracking-normal">optional</span>
              </span>
              <DatePicker
                id={`${uid}-t-btn`}
                value={draft.target_date}
                onChange={(d) => set('target_date', d)}
              />
            </div>
            <div>
              <label className={label} htmlFor={`${uid}-w`}>
                Hours a week <span className="font-normal normal-case tracking-normal">optional</span>
              </label>
              <input
                id={`${uid}-w`} name="project-weekly-hours" type="number" inputMode="numeric"
                className={`${field} num`}
                min={HOURS_MIN} max={HOURS_MAX} step={1}
                placeholder="—"
                value={draft.weekly_hours ?? ''}
                /* An empty field is "not budgeted", not zero — and the column's
                   CHECK starts at 1, so a cleared box must send null rather than
                   a value Postgres would reject. */
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  if (!raw) return set('weekly_hours', null)
                  const n = Math.round(Number(raw))
                  set('weekly_hours', Number.isFinite(n)
                    ? Math.min(HOURS_MAX, Math.max(HOURS_MIN, n))
                    : null)
                }}
              />
            </div>
          </div>

          {problem && (
            <p id={`${uid}-err`} role="alert"
              className="mb-2.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs">
              {problem}
            </p>
          )}

          {confirming ? (
            <div className="border-t border-border-soft pt-2.5">
              <p role="alert" className="mb-2 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs">
                Delete <b>{draft.name.trim() || 'this project'}</b> and all of its tasks?
                This cannot be undone.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1" />
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-60">
                  Keep it
                </button>
                <button ref={killRef} type="button" onClick={() => void destroy()} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  Delete project
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2.5">
              {mode === 'edit' && onDelete && (
                <button type="button" onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-brand/50 hover:text-foreground">
                  <Trash2 size={12} />Delete
                </button>
              )}
              <span className="flex-1" />
              <button type="button" onClick={close}
                className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                {busy && <Loader2 size={12} className="animate-spin" />}
                {mode === 'edit' ? 'Save' : 'Create project'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
