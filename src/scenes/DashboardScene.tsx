import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard, ListTodo, Plus, LogOut, Trash2, Loader2,
  FolderKanban, Calendar as CalIcon, BarChart3, Settings as GearIcon,
  Sun, Moon, Monitor, Palette, History, ExternalLink, Check,
  Pencil, Gauge, Flag, Hourglass, StickyNote, ChevronDown, GripVertical,
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarCollapsibleGroup, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarTrigger, sidebarIconButton, useSidebar,
} from '@/components/ui/sidebar'
import { usePopover, PopoverPortal, pushEscape, refocus, PANEL as POPOVER } from '@/components/ui/pickers'
import {
  listProjects, listTasks, createProject, createTask, updateTask, deleteTask,
  deleteProject, updateProject, seedIfEmpty, signOut, usingRealBackend, applyOrder,
  takeMigrationWarning,
  type Project, type Task, type TaskStatus, type User,
} from '@/lib/store'
import * as I from '@/lib/insights'
import * as O from '@/lib/order'
import {
  THEMES, THEME_NOTE, MODES, FONTS, FONT_STACK, DENSITIES, THEME_SWATCH,
  loadAppearance, applyAppearance, resolveMode, watchSystemMode,
  loadSidebar, saveSidebar,
  type Appearance, type ThemeId, type ModeId, type FontId, type DensityId,
  type ResolvedMode, type SidebarPrefs, type SidebarGroupId,
} from '@/lib/prefs'
import { notify } from '@/components/ui/toast'
import { celebrate } from '@/components/ui/celebrate'
import { RELEASES, REPO } from '@/lib/releases'
import { Workboard, PANELS, type PanelId } from '@/components/board/Workboard'
import { TaskDialog } from '@/components/board/TaskDialog'
import {
  ProjectDialog, projectTone, PROJECT_STATUSES, type ProjectDraft,
} from '@/components/board/ProjectDialog'
import { BoardColumns, QuickAdd, Burndown, ALL_PROJECTS, isAllScope, type Ctx } from '@/components/board/shared'

type View =
  | 'dashboard' | 'list' | 'progress' | 'priorities' | 'stale' | 'notes'
  | 'calendar' | 'reports' | 'versions' | 'settings'

const VIEWS: Record<View, { title: string; icon: JSX.Element }> = {
  dashboard: { title: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  list: { title: 'List', icon: <ListTodo size={16} /> },
  progress: { title: 'Progress', icon: <Gauge size={16} /> },
  priorities: { title: 'Priorities', icon: <Flag size={16} /> },
  stale: { title: 'Stale', icon: <Hourglass size={16} /> },
  notes: { title: 'Notes', icon: <StickyNote size={16} /> },
  calendar: { title: 'Calendar', icon: <CalIcon size={16} /> },
  reports: { title: 'Reports', icon: <BarChart3 size={16} /> },
  versions: { title: 'Versions', icon: <History size={16} /> },
  settings: { title: 'Settings', icon: <GearIcon size={16} /> },
}

/* ============================================================================
   SIDEBAR ENTRIES

   Every entry is one kind of thing: a destination, a full view. Progress,
   Priorities, Stale and Notes used to be a second kind that sent you back to
   the dashboard and popped a panel open there — a sidebar row that moved you
   somewhere you had not asked to go. They are pages now, so the discriminated
   union those needed is gone and this group does one job again.

   The dashboard's floating board still carries all five panels. This list is
   about where a click TAKES you, not about what the board contains.
   ========================================================================== */
interface Entry { id: string; view: View; label: string; icon: JSX.Element }

const entryFor = (v: View): Entry =>
  ({ id: v, view: v, label: VIEWS[v].title, icon: VIEWS[v].icon })

const WORKSPACE_ENTRIES: Entry[] =
  (['dashboard', 'list', 'progress', 'priorities', 'stale', 'notes'] as View[]).map(entryFor)

const MORE_ENTRIES: Entry[] =
  (['calendar', 'reports', 'versions', 'settings'] as View[]).map(entryFor)

/** Ids saved by builds where those four were panel entries (`panel:notes` and
    friends). They name the same destinations, so an already-customised sidebar
    keeps its rows rather than quietly losing them to the filter below. */
const canonicalId = (id: string) => (id.startsWith('panel:') ? id.slice('panel:'.length) : id)

/** Which entries a group shows. `null` prefs mean "this build's default set",
    so a later version adding an entry shows it to everyone who never opened
    the picker — rather than it being invisible because an old list was frozen
    into storage. Unknown saved ids are dropped on the way out. */
function visibleEntries(all: Entry[], chosen: string[] | null, fallback: string[]): Entry[] {
  const want = chosen ?? fallback
  return want
    .map((id) => all.find((e) => e.id === canonicalId(id)))
    .filter((e): e is Entry => Boolean(e))
}

/** All six by default. They were opt-in while they were panel shortcuts —
    half-destinations worth hiding. Each is a page like List now, and a page
    nobody can find is a page nobody has. */
const WORKSPACE_DEFAULT = WORKSPACE_ENTRIES.map((e) => e.id)
const MORE_DEFAULT = MORE_ENTRIES.map((e) => e.id)

/** Views showing one project's work, so the picker in the top bar changes what
    you are reading rather than sitting there inert. Stale is deliberately not
    among them: work you have forgotten is not filed by project in your head. */
const PROJECT_SCOPED = new Set<View>(['dashboard', 'list', 'progress', 'priorities', 'notes'])

/* ============================================================================
   GROUP EDITOR — the "+" on a group header

   A checklist popover rather than a dialog: it is a small, reversible setting,
   and the sidebar it edits should stay visible while you edit it.

   It reuses `usePopover` from the pickers rather than growing a second
   implementation. That hook is what stops Escape from closing the sidebar
   drawer as well as the popover — it captures the key and stops it before the
   drawer's own window listener sees it.
   ========================================================================== */
function EntryPicker({
  label, all, chosen, fallback, onChange,
}: {
  label: string
  all: Entry[]
  chosen: string[] | null
  fallback: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const close = useRef(() => setOpen(false)).current
  const { trigger, panel, style } = usePopover(open, close)
  // A popover anchored inside the mobile drawer must not outlive it: the
  // drawer slides off-screen and goes inert, and a fixed-position panel would
  // otherwise stay put, pinned to a trigger nobody can see or reach.
  const { open: drawerOpen } = useSidebar()
  useEffect(() => { if (!drawerOpen) setOpen(false) }, [drawerOpen])
  const shown = new Set((chosen ?? fallback).filter((id) => all.some((e) => e.id === id)))

  const toggle = (id: string) => {
    const next = shown.has(id)
      ? all.filter((e) => e.id !== id && shown.has(e.id)).map((e) => e.id)
      // Rebuilt from `all` so the group keeps its canonical order however the
      // boxes were ticked — the list is a set, not a sequence the user authors.
      : all.filter((e) => e.id === id || shown.has(e.id)).map((e) => e.id)
    onChange(next)
  }

  return (
    <>
      <button
        ref={trigger} type="button"
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Edit ${label} items`}
        title={`Edit ${label} items`}
        onClick={() => setOpen((o) => !o)}
        className={sidebarIconButton}
      >
        <Plus size={13} />
      </button>

      {open && (
        <PopoverPortal>
        <div ref={panel} role="dialog" aria-label={`${label} items`} style={style}
          className={`${POPOVER} w-[13rem]`}>
          <p className="ui-face px-2 pb-1 pt-0.5 text-[0.58rem] uppercase tracking-wider text-muted">
            Show in {label}
          </p>
          {all.map((e) => {
            const on = shown.has(e.id)
            return (
              <label key={e.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox" checked={on} onChange={() => toggle(e.id)}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand)]"
                />
                <span aria-hidden="true" className="shrink-0 text-muted">{e.icon}</span>
                <span className="truncate">{e.label}</span>
              </label>
            )
          })}
          <p className="num border-t border-border-soft px-2 pb-0.5 pt-1.5 text-[0.58rem] text-muted">
            Hiding one only removes it here.
          </p>
        </div>
        </PopoverPortal>
      )}
    </>
  )
}

/* ============================================================================
   PROJECT MANAGER — the "+" on the Projects group

   Lists every project with an edit affordance, plus a "New project" row. Edit
   opens the same ProjectDialog in edit mode, where deleting also lives, so
   there is exactly one place a project's details are changed.
   ========================================================================== */
function ProjectPicker({
  projects, onNew, onEdit,
}: { projects: Project[]; onNew: () => void; onEdit: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const close = useRef(() => setOpen(false)).current
  const { trigger, panel, style } = usePopover(open, close)
  const { open: drawerOpen } = useSidebar()
  useEffect(() => { if (!drawerOpen) setOpen(false) }, [drawerOpen])

  return (
    <>
      <button
        ref={trigger} type="button"
        aria-haspopup="dialog" aria-expanded={open}
        aria-label="Add or edit projects" title="Add or edit projects"
        onClick={() => setOpen((o) => !o)}
        className={sidebarIconButton}
      >
        <Plus size={13} />
      </button>

      {open && (
        <PopoverPortal>
        <div ref={panel} role="dialog" aria-label="Projects" style={style}
          className={`${POPOVER} w-[15rem]`}>
          <p className="ui-face px-2 pb-1 pt-0.5 text-[0.58rem] uppercase tracking-wider text-muted">
            Projects
          </p>
          {projects.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted">None yet.</p>
          )}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: projectTone(p.color) }} />
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              <button
                type="button" aria-label={`Edit ${p.name}`}
                onClick={() => { close(); onEdit(p.id) }}
                className="shrink-0 rounded p-1 text-muted hover:bg-brand/20 hover:text-foreground"
              >
                <Pencil size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { close(); onNew() }}
            className="mt-0.5 flex w-full items-center gap-2 border-t border-border-soft px-2 pb-0.5 pt-2 text-left text-sm hover:text-brand"
          >
            <Plus size={14} />New project
          </button>
        </div>
        </PopoverPortal>
      )}
    </>
  )
}

/* ============================================================================
   PROJECT ROWS — the sidebar's project list, reorderable.

   Pointer events, not HTML5 drag-and-drop, for the reason BoardColumns already
   gives: HTML5 DnD never fires on touch, so a phone could not reorder at all.

   The drag starts from a grip BESIDE the row, not from the row. The row is a
   navigation button; if it also owned pointerdown, opening a project would be
   a coin flip against a 6px threshold and every mis-drag would navigate away.
   ========================================================================== */
const PROJECT_LIFT = 6

interface ProjectDrag {
  id: string
  dy: number
  live: boolean
  /** Slot in the list WITHOUT the dragged row — the frame `onReorder` takes. */
  index: number
}

function ProjectRows({
  projects, tasks, activeProject, onOpen, onReorder, onNew,
}: {
  projects: Project[]
  tasks: Task[]
  /** The id whose List view is on screen, or null — drives `active`. */
  activeProject: string | null
  onOpen: (id: string) => void
  onReorder: (id: string, index: number) => void
  onNew: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<ProjectDrag | null>(null)
  const [note, setNote] = useState('')

  const announce = (id: string, index: number) => {
    const name = projects.find((p) => p.id === id)?.name ?? 'Project'
    setNote(`${name} moved to position ${index + 1} of ${projects.length}`)
  }

  /** Which slot the pointer is over, counted with the dragged row excluded so
      "drop at 2" means the same thing whichever direction it travelled. */
  const slotAt = (y: number, id: string) => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-project]') ?? [])]
      .filter((r) => r.dataset.project !== id)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) return i
    }
    return rows.length
  }

  const onGrab = (e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const from = projects.findIndex((p) => p.id === id)
    if (from < 0) return
    const y0 = e.clientY
    let cur: ProjectDrag = { id, dy: 0, live: false, index: from }

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0
      const live = cur.live || Math.abs(dy) > PROJECT_LIFT
      cur = { ...cur, dy, live, index: live ? slotAt(ev.clientY, id) : cur.index }
      // Cancels the scroll a finger would otherwise start under the grip.
      if (live) ev.preventDefault()
      setDrag(cur)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      // A drop back into the row's own slot is not a move: no write, and no
      // announcement, because nothing happened for a screen reader to report.
      if (cur.live && cur.index !== from) { onReorder(id, cur.index); announce(id, cur.index) }
      setDrag(null)
    }
    addEventListener('pointermove', move, { passive: false })
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
  }

  /* Alt+arrows — the same language TaskCard and the Workboard headers use for
     moving something without a pointer. */
  const onKey = (e: React.KeyboardEvent, id: string) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const at = projects.findIndex((p) => p.id === id)
    const to = at + (e.key === 'ArrowUp' ? -1 : 1)
    if (at < 0 || to < 0 || to >= projects.length) return
    e.preventDefault()
    onReorder(id, to)
    announce(id, to)
    /* Reordering re-keys the list, so React unmounts the row this keypress came
       from and focus falls to <body> — leaving a keyboard user unable to press
       Alt+Arrow a second time without tabbing back in. Deferred to the frame
       after commit for the reason pickers.tsx documents on `refocus`: a
       synchronous focus() runs before the new row exists. */
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-project="${id}"] button`)
        ?.focus()
    })
  }

  const rest = drag ? projects.filter((p) => p.id !== drag.id) : projects

  const openAll = tasks.filter((t) => t.status !== 'done').length

  return (
    <div ref={root}>
      <SidebarMenu>
        {/* A scope, not a project: no grip, no `data-project`, and outside the
            reorder list entirely, so dropping a real project at the very top
            still lands at index 0 rather than fighting this row for it. Padded
            like the New-project row so its dot lines up with the ones below. */}
        <SidebarMenuItem className="flex items-center gap-0.5 pl-[calc(0.75rem+2px)]">
          <SidebarMenuButton
            active={isAllScope(activeProject)}
            onClick={() => onOpen(ALL_PROJECTS)}
            className="min-w-0 flex-1"
          >
            <span className="h-2 w-2 shrink-0 rounded-full border border-muted" />
            <span className="truncate">All projects</span>
            <span className="num ml-auto text-[0.7rem] text-muted">{openAll}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {projects.map((p) => {
          const s = I.stats(tasks.filter((t) => t.project_id === p.id))
          const lifted = drag?.id === p.id && drag.live
          const before = drag?.live && rest[drag.index]?.id === p.id
          const after = drag?.live && drag.index >= rest.length && rest[rest.length - 1]?.id === p.id
          return (
            <SidebarMenuItem
              key={p.id}
              data-project={p.id}
              className="relative flex items-center gap-0.5"
              style={lifted ? { transform: `translateY(${drag!.dy}px)`, zIndex: 30 } : undefined}
            >
              {(before || after) && (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-brand ${before ? '-top-0.5' : '-bottom-0.5'}`}
                />
              )}
              <span
                data-grip
                aria-hidden="true"
                onPointerDown={(e) => onGrab(e, p.id)}
                style={{ touchAction: 'none' }}
                className="shrink-0 cursor-grab rounded p-0.5 text-muted opacity-40 transition-opacity hover:opacity-100 active:cursor-grabbing motion-reduce:transition-none"
              >
                <GripVertical size={13} />
              </span>
              <SidebarMenuButton
                active={activeProject === p.id}
                onClick={() => onOpen(p.id)}
                onKeyDown={(e) => onKey(e, p.id)}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className={`min-w-0 flex-1 ${lifted ? 'bg-surface-2 shadow-lg' : ''}`}
              >
                {/* The dot is the only place a project's colour is visible, so
                    it reads `p.color` rather than a fixed accent. 'violet' —
                    every legacy row — resolves back to the theme brand, so
                    nothing changes appearance. */}
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: projectTone(p.color) }}
                />
                <span className="truncate">{p.name}</span>
                <span className="num ml-auto text-[0.7rem] text-muted">
                  {s.total - s.done}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
        {/* Padded by the width of a grip so this row's icon lines up with the
            project dots above it. An empty spacer span would be one more thing
            for a screen reader to skip past for no gain. */}
        <SidebarMenuItem className="flex items-center gap-0.5 pl-[calc(0.75rem+2px)]">
          <SidebarMenuButton onClick={onNew} className="min-w-0 flex-1">
            <Plus size={16} />New project
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <p aria-live="polite" className="sr-only">{note}</p>
    </div>
  )
}

export function DashboardScene({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <SidebarProvider>
      <DashboardInner user={user} onSignOut={onSignOut} />
    </SidebarProvider>
  )
}

function DashboardInner({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [view, setView] = useState<View>('dashboard')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  /* Project creation is a dialog, not a `window.prompt`. Held at scene level
     next to `editing` so the sidebar button can open it from anywhere. */
  const [creatingProject, setCreatingProject] = useState(false)
  /* Sidebar shape: which groups are collapsed, and which entries each shows.
     Persisted per device like the appearance prefs — it describes this screen,
     not this account's data. */
  const [sidebar, setSidebar] = useState<SidebarPrefs>(() => loadSidebar())
  const putSidebar = useCallback((next: SidebarPrefs) => {
    setSidebar(next)
    saveSidebar(next)
  }, [])
  const toggleGroup = useCallback((g: SidebarGroupId) => {
    setSidebar((cur) => {
      const next = { ...cur, collapsed: { ...cur.collapsed, [g]: !cur.collapsed[g] } }
      saveSidebar(next)
      return next
    })
  }, [])

  /** The project open in the edit dialog, or null. Separate from `creating` so
      one dialog component can serve both without a mode flag at the call site. */
  const [editingProject, setEditingProject] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance())

  useEffect(() => { applyAppearance(appearance) }, [appearance])

  /* On "system", the OS can change under us — nothing else would notice, and
     the page would sit in yesterday's mode until a reload. */
  useEffect(() => {
    if (appearance.mode !== 'system') return
    return watchSystemMode(() => applyAppearance(appearance))
  }, [appearance])

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedIfEmpty()
        const [ps, ts] = [await listProjects(), await listTasks()]
        if (cancelled) return
        setProjects(ps)
        setTasks(ts)
        setActiveProject(ps[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* The All scope is the whole board, not a project that happens to match
     nothing — filtering on the sentinel would hand every panel an empty list. */
  const projectTasks = useMemo(
    () => (isAllScope(activeProject) ? tasks
      : activeProject ? tasks.filter((t) => t.project_id === activeProject) : []),
    [tasks, activeProject],
  )

  /* ---- mutations. Optimistic, with rollback — the board must never stall
     waiting on a round trip, and a failure must not silently diverge. ---- */
  const patch = useCallback(async (id: string, p: Partial<Task>) => {
    const prev = tasks
    const now = new Date().toISOString()
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...p, updated_at: now } : t)))
    try {
      await updateTask(id, p)
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Could not save that change.')
    }
  }, [tasks])

  /* Placing a task is always a position write, never a status write on its own.
     Every earlier path — drag to a column, "Mark done", the editor's status
     control — patched status and left position untouched, so tasks piled up
     tied at whatever number they were created with and the column's order was
     whatever the backend happened to return. */
  const reorder = useCallback(async (id: string, status: TaskStatus, index: number) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    const rest = O.column(tasks, t.project_id, status).filter((x) => x.id !== id)
    const plan = O.planMove(rest, index)
    const prev = tasks
    const now = new Date().toISOString()

    setTasks((cur) => cur.map((x) => {
      if (x.id === id) return { ...x, status, position: plan.position, updated_at: now }
      const r = plan.renumber.find((q) => q.id === x.id)
      // Shifted rows keep their updated_at: nobody touched them, and both
      // staleness and completion dates read that column.
      return r ? { ...x, position: r.position } : x
    }))

    /* The one milestone worth celebrating: this task was the LAST open one in
       its project. Firing on every completed task would make the gesture
       meaningless within a morning — and `t.status !== status` keeps a
       reorder WITHIN the done column from re-triggering it. */
    const finishedProject =
      status === 'done' &&
      t.status !== 'done' &&
      !tasks.some((x) => x.project_id === t.project_id && x.id !== id && x.status !== 'done')

    try {
      await applyOrder({ id, status, position: plan.position }, plan.renumber)
      if (finishedProject) {
        celebrate()
        notify.success(`Every task in "${projects.find((p) => p.id === t.project_id)?.name ?? 'this project'}" is done`)
      }
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Could not move that task.')
    }
  }, [tasks, projects])

  /** Status change with no opinion about where — lands at the end of the column. */
  const move = useCallback((id: string, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return Promise.resolve()
    const rest = O.column(tasks, t.project_id, status).filter((x) => x.id !== id)
    return reorder(id, status, rest.length)
  }, [tasks, reorder])

  /**
   * Delete a task, offering a real undo.
   *
   * The undo re-creates the row rather than just restoring React state. A
   * toast that says "Undo" and only repaints the board would be a lie: the
   * row is already gone from the backend, and the task would evaporate on the
   * next load. Re-creating means a new id — acceptable, because nothing the
   * user can see is keyed on it — and the restored row carries its status,
   * priority, notes and due date back.
   */
  const remove = useCallback(async (id: string) => {
    const prev = tasks
    const doomed = tasks.find((t) => t.id === id)
    setTasks((cur) => cur.filter((t) => t.id !== id))
    if (selected === id) setSelected(null)
    try {
      await deleteTask(id)
      if (!doomed) return
      notify.undo(`Deleted "${doomed.title}"`, async () => {
        try {
          const back = await createTask(doomed.project_id, doomed.title, doomed.status, doomed.priority)
          const rest: Partial<Task> = {
            notes: doomed.notes,
            due_date: doomed.due_date,
            position: doomed.position,
          }
          await updateTask(back.id, rest)
          setTasks((cur) => [...cur, { ...back, ...rest }])
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not restore that task.')
        }
      })
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Could not delete that task.')
    }
  }, [tasks, selected])

  const add = useCallback(async (text: string, projectId?: string) => {
    const p = I.parse(text, projects)
    /* The All sentinel is not a row id. Writing it as `project_id` would create
       a task belonging to a project that does not exist, invisible from every
       project view — so All falls back to the first project instead. Callers
       that care (CreateTaskDialog) pass an explicit id and never reach this. */
    const scoped = isAllScope(activeProject) ? projects[0]?.id ?? null : activeProject
    const pid = p.projectId || projectId || scoped
    if (!p.title || !pid) return null
    try {
      const t = await createTask(pid, p.title, 'todo', p.priority)
      // Tokens the create call cannot carry are applied straight after, so
      // "@fri" in a quick-add still lands on the row.
      if (p.due) {
        const due = O.isoDay(new Date(p.due))
        await updateTask(t.id, { due_date: due })
        t.due_date = due
      }
      setTasks((cur) => [...cur, t])
      setSelected(t.id)
      /* Only when the scope could not name a project and we picked one on the
         user's behalf. Every other path either had an explicit id or a single
         active project, and announcing those would be narrating their own
         click back at them. */
      if (!p.projectId && !projectId && isAllScope(activeProject)) {
        notify.success(`Added to "${projects.find((x) => x.id === pid)?.name ?? 'a project'}"`)
      }
      return t
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that task.')
      return null
    }
  }, [projects, activeProject])

  /* Unlike the task mutations above this one is NOT optimistic, and for the
     same reason `add` isn't: the row's id comes from the backend, so there is
     nothing to render until the insert returns. The dialog holds the draft and
     stays open on failure, which is the rollback — no half-created project is
     ever put on screen. */
  /** Save edits to an existing project. Optimistic like every other mutation
      here, and rolled back on failure so the sidebar never shows a name the
      backend rejected. */
  const saveProject = useCallback(async (id: string, d: ProjectDraft) => {
    const prev = projects
    setProjects((cur) => cur.map((p) => (p.id === id ? { ...p, ...d } : p)))
    try {
      await updateProject(id, d)
      // The planning columns can be missing from a database that has not had
      // schema.sql re-run. store.ts retries without them rather than failing
      // the whole save; this is the only place the user finds out it happened.
      const pending = takeMigrationWarning()
      if (pending) setError(pending)
      notify.success('Project saved')
      setEditingProject(null)
      return null
    } catch (err) {
      setProjects(prev)
      const msg = err instanceof Error ? err.message : 'Could not save that project.'
      setError(msg)
      return msg
    }
  }, [projects])

  /**
   * Put a project at `index` of the sidebar list, `index` counted with the
   * moved project already removed.
   *
   * Positions here are DENSE (0, 1, 2, …), deliberately not the sparse
   * ORDER_STEP scheme `planMove` uses for tasks. That scheme exists purely to
   * protect `tasks.updated_at`, which the insights layer reads as staleness
   * and as a completion date — renumbering a column would date every task in
   * it today. Nothing reads `projects.updated_at`, and a sidebar holds a
   * handful of rows, so dense numbering is the cheaper trade here. Do not
   * "fix" this into the sparse scheme by analogy with tasks.
   */
  const reorderProject = useCallback(async (id: string, index: number) => {
    const from = projects.findIndex((p) => p.id === id)
    if (from < 0) return
    const next = [...projects]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, moved)

    // Only rows whose number actually changed are written — a drag that lands
    // back where it started issues nothing at all.
    const writes = next
      .map((p, i) => ({ id: p.id, position: i }))
      .filter((w, i) => next[i].position !== i)
    if (!writes.length) return

    const prev = projects
    setProjects(next.map((p, i) => ({ ...p, position: i })))
    try {
      await Promise.all(writes.map((w) => updateProject(w.id, { position: w.position })))
    } catch (err) {
      setProjects(prev)
      setError(err instanceof Error ? err.message : 'Could not reorder your projects.')
    }
  }, [projects])

  /** Open the edit dialog already showing its delete confirmation. The button
      that got here said "Delete project", so asking again from scratch would
      be a second unrelated question rather than a confirmation. */
  const [armDelete, setArmDelete] = useState(false)
  const askDeleteProject = useCallback((id: string) => {
    setArmDelete(true)
    setEditingProject(id)
  }, [])

  const submitProject = useCallback(async (d: ProjectDraft) => {
    try {
      const p = await createProject(d.name, d.description, d.color, d.status, {
        target_date: d.target_date,
        weekly_hours: d.weekly_hours,
      })
      const pending = takeMigrationWarning()
      if (pending) setError(pending)
      setProjects((cur) => [...cur, p])
      setActiveProject(p.id)
      setView('list')
      setCreatingProject(false)
      notify.success(`Created "${p.name}"`)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create that project.'
      // Shown inline in the dialog, and left in the scene banner so it survives
      // the user giving up and closing it.
      setError(msg)
      return msg
    }
  }, [])

  /**
   * Delete a project and its tasks.
   *
   * Confirmation is the CALLER's job now, not a `window.confirm` in here: both
   * entry points (the List header button and the edit dialog) route through
   * ProjectDialog, which asks in a themed, labelled step that can name the
   * project — something the native dialog cannot do. Returning a message
   * instead of throwing lets the dialog show the failure inline and stay open.
   */
  const removeProject = useCallback(async (id: string) => {
    const doomed = projects.find((p) => p.id === id)
    try {
      await deleteProject(id)
      const rest = projects.filter((p) => p.id !== id)
      setProjects(rest)
      setTasks((cur) => cur.filter((t) => t.project_id !== id))
      if (activeProject === id) setActiveProject(rest[0]?.id ?? null)
      // No undo offered: restoring a project means re-creating it AND every
      // task under it, and a button labelled Undo that half-works is worse
      // than no button. The dialog already confirmed by name.
      notify.success(`Deleted "${doomed?.name ?? 'project'}"`)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete that project.'
      setError(msg)
      return msg
    }
  }, [projects, activeProject])

  /** The row being edited, resolved from state so a rename or delete elsewhere
      cannot leave the dialog rendering a project that no longer exists. */
  const editProject = useMemo(
    () => projects.find((p) => p.id === editingProject) ?? null,
    [projects, editingProject],
  )


  const ctx = {
    projects, tasks, projectTasks, activeProject, selected,
    setSelected, editing, setEditing, patch, move, reorder, remove, add, user,
  }

  return (
    <div className="flex min-h-dvh w-full">
      <Sidebar>
        <SidebarHeader>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <FolderKanban size={15} />
          </div>
          <span className="ui-face text-sm font-semibold">Project Tracker</span>
        </SidebarHeader>

        <SidebarContent>
          <SidebarCollapsibleGroup
            label="Workspace"
            contentId="sb-workspace"
            open={!sidebar.collapsed.workspace}
            onToggle={() => toggleGroup('workspace')}
            action={
              <EntryPicker
                label="Workspace"
                all={WORKSPACE_ENTRIES}
                chosen={sidebar.workspace}
                fallback={WORKSPACE_DEFAULT}
                onChange={(next) => putSidebar({ ...sidebar, workspace: next })}
              />
            }
          >
            <SidebarMenu>
              {visibleEntries(WORKSPACE_ENTRIES, sidebar.workspace, WORKSPACE_DEFAULT).map((e) => (
                <SidebarMenuItem key={e.id}>
                  <SidebarMenuButton
                    active={view === e.view}
                    onClick={() => setView(e.view)}
                  >
                    {e.icon}{e.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarCollapsibleGroup>

          <SidebarCollapsibleGroup
            label="Projects"
            contentId="sb-projects"
            open={!sidebar.collapsed.projects}
            onToggle={() => toggleGroup('projects')}
            action={
              <ProjectPicker
                projects={projects}
                onNew={() => setCreatingProject(true)}
                onEdit={setEditingProject}
              />
            }
          >
            <ProjectRows
              projects={projects}
              tasks={tasks}
              activeProject={view === 'list' ? activeProject : null}
              onOpen={(id) => { setActiveProject(id); setView('list') }}
              onReorder={reorderProject}
              onNew={() => setCreatingProject(true)}
            />
          </SidebarCollapsibleGroup>

          <SidebarCollapsibleGroup
            label="More"
            contentId="sb-more"
            open={!sidebar.collapsed.more}
            onToggle={() => toggleGroup('more')}
            action={
              <EntryPicker
                label="More"
                all={MORE_ENTRIES}
                chosen={sidebar.more}
                fallback={MORE_DEFAULT}
                onChange={(next) => putSidebar({ ...sidebar, more: next })}
              />
            }
          >
            <SidebarMenu>
              {visibleEntries(MORE_ENTRIES, sidebar.more, MORE_DEFAULT).map((e) => (
                <SidebarMenuItem key={e.id}>
                  <SidebarMenuButton
                    active={view === e.view}
                    onClick={() => setView(e.view)}
                  >
                    {e.icon}{e.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarCollapsibleGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold uppercase">
              {user.displayName.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user.displayName}</p>
              <p className="num truncate text-[0.7rem] text-muted">{user.username}</p>
            </div>
          </div>
          <SidebarMenuButton onClick={async () => { await signOut(); onSignOut() }}>
            <LogOut size={16} />Sign out
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          view={view}
          projects={projects}
          activeProject={activeProject}
          onProject={setActiveProject}
          appearance={appearance}
          onAppearance={setAppearance}
          tasks={tasks}
        />

        <main className="flex min-h-0 flex-1 flex-col">
          {error && (
            <div role="alert" className="m-3 flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
              {error}
              <button onClick={() => setError(null)} className="ml-auto text-xs underline" type="button">
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : view === 'dashboard' ? (
            <Workboard ctx={ctx} />
          ) : (
            <div className="scene-enter flex-1 overflow-auto p-4 sm:p-6">
              {view === 'list' && (
                <ListView ctx={ctx} onEditProject={setEditingProject} onDeleteProject={askDeleteProject} />
              )}
              {view === 'progress' && <ProgressView ctx={ctx} />}
              {view === 'priorities' && <PrioritiesView ctx={ctx} />}
              {view === 'stale' && <StaleView ctx={ctx} />}
              {view === 'notes' && <NotesView ctx={ctx} />}
              {view === 'calendar' && <CalendarView ctx={ctx} />}
              {view === 'reports' && <ReportsView ctx={ctx} />}
              {view === 'versions' && <VersionsView />}
              {view === 'settings' && (
                <SettingsView appearance={appearance} onAppearance={setAppearance} ctx={ctx} />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Scene level, not inside a panel: panels are overflow-hidden with their
          own stacking contexts and would clip it. */}
      <TaskDialog ctx={ctx} />
      <ProjectDialog
        open={creatingProject}
        onSubmit={submitProject}
        onClose={() => setCreatingProject(false)}
      />

      {/* Keyed on the project id so switching which one you are editing
          remounts the dialog — otherwise its internal draft state would carry
          the previous project's values into the next one. */}
      {editProject && (
        <ProjectDialog
          key={editProject.id}
          open
          mode="edit"
          initial={{
            name: editProject.name,
            description: editProject.description,
            color: editProject.color,
            status: editProject.status,
            /* Coalesced because a row read from a database that predates these
               columns has them as undefined, and the draft's contract is
               "a date or null" — undefined would leave the field uncontrolled. */
            target_date: editProject.target_date ?? null,
            weekly_hours: editProject.weekly_hours ?? null,
          }}
          armDelete={armDelete}
          onSubmit={(d) => saveProject(editProject.id, d)}
          onDelete={async () => {
            const msg = await removeProject(editProject.id)
            if (!msg) setEditingProject(null)
            return msg
          }}
          onClose={() => { setEditingProject(null); setArmDelete(false) }}
        />
      )}
    </div>
  )
}

/* ==========================================================================
   TOP BAR
   ========================================================================== */
function TopBar({
  view, projects, activeProject, onProject, appearance, onAppearance, tasks,
}: {
  view: View
  projects: Project[]
  activeProject: string | null
  onProject: (id: string) => void
  appearance: Appearance
  onAppearance: (a: Appearance) => void
  tasks: Task[]
}) {
  const s = I.stats(tasks)
  const avg = projects.length
    ? projects.reduce((a, p) => a + I.health(tasks.filter((t) => t.project_id === p.id)), 0) / projects.length
    : 1
  const conditions = avg > 0.72 ? 'Clear' : avg > 0.55 ? 'Fair' : avg > 0.42 ? 'Unsettled' : 'Heavy weather'

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md">
      <SidebarTrigger />
      <h1 className="ui-face text-sm font-semibold">{VIEWS[view].title}</h1>

      {PROJECT_SCOPED.has(view) && projects.length > 0 && (
        <>
          <label className="sr-only" htmlFor="proj">Active project</label>
          <select
            id="proj"
            value={activeProject ?? ''}
            onChange={(e) => onProject(e.target.value)}
            className="num max-w-[10rem] rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}

      <span className="flex-1" />

      <span className="num hidden text-[0.65rem] uppercase tracking-wider text-muted sm:inline">
        {conditions} · {s.overdue} overdue · {s.hoursLeft}h left
      </span>

      <DayNightSwitch appearance={appearance} onAppearance={onAppearance} />
      <AppearanceMenu appearance={appearance} onAppearance={onAppearance} />

      {!usingRealBackend && (
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[0.6rem] font-medium">
          Demo
        </span>
      )}
    </header>
  )
}

/* ==========================================================================
   APPEARANCE
   --------------------------------------------------------------------------
   Two controls, because there are two different jobs. Flipping day to night
   is the thing people do daily and it gets a one-click switch. Choosing a
   theme, a face and a density is the thing people do once, and it gets a
   panel with room to show what each option looks like.
   ========================================================================== */

/** A three-position preference driven by a two-position switch: clicking it
    always sets an explicit light or dark, and "System" is chosen deliberately
    in the panel. A switch that silently meant three things would be a lie. */
function DayNightSwitch({
  appearance, onAppearance,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const now: ResolvedMode = resolveMode(appearance.mode)
  const next: ResolvedMode = now === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      data-on={now}
      onClick={() => onAppearance({ ...appearance, mode: next })}
      aria-label={`Switch to ${next} mode`}
      title={`${MODES[appearance.mode]} — switch to ${next}`}
      className="daynight"
    >
      <span aria-hidden="true" className="dn-hint dn-hint-sun"><Sun size={11} /></span>
      <span aria-hidden="true" className="dn-hint dn-hint-moon"><Moon size={11} /></span>
      <span aria-hidden="true" className="dn-knob">
        <Sun size={11} className="dn-icon dn-sun" />
        <Moon size={11} className="dn-icon dn-moon" />
      </span>
    </button>
  )
}

/* --------------------------------------------------------------------------
   THEME SELECT — a collapsed combobox, not eleven cards

   Eleven theme cards at ~46px each pushed this panel to 849px in a 722px
   window: Density and the last few themes were simply off the bottom of the
   screen with no way to reach them. So the list collapses to the ONE theme
   that is currently applied — same swatch, same name, same one-line note — and
   opens on demand.

   ARIA: the collapsed control is a `combobox` with `aria-haspopup="listbox"`
   and `aria-expanded`, named "Theme" and reading its current value from its
   own content, so a screen reader announces the active theme without the list
   being open. The options carry `aria-selected`.

   Escape closes the LIST only. That works because the shared escape stack in
   pickers.tsx invokes just the innermost claim: this one, pushed after the
   appearance popover's, wins the first Escape and the popover survives it.
   -------------------------------------------------------------------------- */
function ThemeSwatch({ theme, mode }: { theme: ThemeId; mode: ResolvedMode }) {
  const [bg, surface, brand] = THEME_SWATCH[theme][mode]
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-11 shrink-0 flex-col justify-between overflow-hidden rounded-md p-1 ring-1 ring-black/20"
      style={{ background: bg }}
    >
      <span className="block h-1.5 w-full rounded-[2px]" style={{ background: surface }} />
      <span className="block h-1.5 w-2/3 rounded-[2px]" style={{ background: brand }} />
    </span>
  )
}

function ThemeSelect({
  value, mode, onChange,
}: { value: ThemeId; mode: ResolvedMode; onChange: (t: ThemeId) => void }) {
  const ids = Object.keys(THEMES) as ThemeId[]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, ids.indexOf(value)))
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const items = useRef<Array<HTMLDivElement | null>>([])
  const uid = useId()

  const shut = useCallback((back = true) => {
    setOpen(false)
    // rAF, not a synchronous focus(): the list unmounts on the next commit and
    // focusing before that lands on a node about to be removed, which drops a
    // keyboard user on <body>. Same reason usePopover does it.
    if (back) refocus(btn.current)
  }, [])

  /* Escape belongs to this layer while it is open — see the note above. */
  useEffect(() => {
    if (!open) return
    return pushEscape(() => shut())
  }, [open, shut])

  /* Opening moves focus into the list, onto the theme already in use, which is
     also what scrolls it into view inside the panel's own scroll box. Keyed on
     `open` alone: re-running per `active` would fight the arrow keys, which
     move focus themselves. */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) items.current[active]?.focus()
    wasOpen.current = open
  }, [open, active])

  const openAt = (i: number) => { setActive(i); setOpen(true) }
  const choose = (i: number) => { onChange(ids[i]); setActive(i); shut() }

  const move = (i: number) => {
    const n = (i + ids.length) % ids.length
    setActive(n)
    items.current[n]?.focus()
  }

  const onListKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(active + 1); break
      case 'ArrowUp': e.preventDefault(); move(active - 1); break
      case 'Home': e.preventDefault(); move(0); break
      case 'End': e.preventDefault(); move(ids.length - 1); break
      case 'Enter':
      case ' ': e.preventDefault(); choose(active); break
    }
  }

  return (
    <div
      /* Tabbing past the last option, or clicking anywhere else in the panel,
         leaves the list — which should close it rather than stranding an open
         dropdown behind the rest of the controls. */
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null
        if (to && (list.current?.contains(to) || btn.current?.contains(to))) return
        setOpen(false)
      }}
    >
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={uid + '-list'}
        aria-label={'Theme: ' + THEMES[value]}
        onClick={() => (open ? shut(false) : openAt(Math.max(0, ids.indexOf(value))))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) openAt(Math.max(0, ids.indexOf(value)))
          }
        }}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background p-1.5 text-left outline-none transition-colors hover:border-brand focus-visible:border-brand"
      >
        <ThemeSwatch theme={value} mode={mode} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{THEMES[value]}</span>
          <span className="block truncate text-[0.62rem] text-muted">{THEME_NOTE[value]}</span>
        </span>
        <ChevronDown
          size={14} aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={list}
          id={uid + '-list'}
          role="listbox"
          aria-label="Theme"
          onKeyDown={onListKey}
          className="pop-in mt-1 max-h-[14rem] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {ids.map((id, i) => {
            const on = id === value
            return (
              <div
                key={id}
                ref={(el) => { items.current[i] = el }}
                role="option"
                aria-selected={on}
                tabIndex={0}
                onClick={() => choose(i)}
                onFocus={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-1.5 text-left outline-none transition-colors
                  ${on ? 'border-brand bg-brand/10' : 'border-transparent hover:bg-surface-2'}
                  focus-visible:border-brand focus-visible:bg-surface-2`}
              >
                <ThemeSwatch theme={id} mode={mode} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{THEMES[id]}</span>
                  <span className="block truncate text-[0.62rem] text-muted">{THEME_NOTE[id]}</span>
                </span>
                {on && <Check size={14} className="shrink-0 text-brand" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AppearanceMenu({
  appearance, onAppearance,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const [open, setOpen] = useState(false)
  const close = useRef(() => setOpen(false)).current
  /* The same popover primitive the pickers use, portalled to <body>. That is
     what finally makes `fixed` legal here: the header's backdrop-blur makes it
     a containing block for fixed descendants, but a portalled panel is not a
     descendant of it. `align: 'end'` keeps the panel hanging off the right of
     its trigger the way it always has, and usePopover clamps it into the
     viewport — vertically as well, which is the belt-and-braces half of the
     height fix: whatever is added here later, the panel stays on screen and
     grows a scrollbar instead. */
  const { trigger, panel, style } = usePopover(open, close, { align: 'end' })

  const mode = resolveMode(appearance.mode)

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        // The visible label is hidden below `sm`, which would leave the button
        // named by nothing but an icon. The name has to be independent of it.
        aria-label={`Appearance — ${THEMES[appearance.theme]}`}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs hover:border-brand"
      >
        <Palette size={13} />
        <span aria-hidden="true" className="hidden sm:inline">{THEMES[appearance.theme]}</span>
      </button>

      {open && (
        <PopoverPortal>
          <div
            ref={panel}
            role="dialog"
            aria-label="Appearance"
            style={style}
            className={`${POPOVER} w-[19rem] max-w-[calc(100vw-1rem)]`}
          >
            {/* POPOVER already carries p-1.5; this tops it up to the p-3 this
                panel wants, rather than fighting it with a second padding
                utility on the same element. */}
            <div className="p-1.5">
              <Group label="Mode">
                <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Mode">
                  {(Object.keys(MODES) as ModeId[]).map((m) => {
                    const Icon = m === 'light' ? Sun : m === 'dark' ? Moon : Monitor
                    const on = appearance.mode === m
                    return (
                      <button
                        key={m} type="button" role="radio" aria-checked={on}
                        onClick={() => onAppearance({ ...appearance, mode: m })}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs transition-colors
                          ${on ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}
                      >
                        <Icon size={13} />{MODES[m]}
                      </button>
                    )
                  })}
                </div>
                {appearance.mode === 'system' && (
                  <p className="num mt-1 text-[0.62rem] text-muted">
                    Following this device — currently {mode}.
                  </p>
                )}
              </Group>

              <Group label="Theme">
                {/* Every swatch previews itself in the mode you are actually
                    in, so what you see on the card is what the page becomes. */}
                <ThemeSelect
                  value={appearance.theme}
                  mode={mode}
                  onChange={(theme) => onAppearance({ ...appearance, theme })}
                />
              </Group>

              <Group label="Font">
                <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Font">
                  {(Object.keys(FONTS) as FontId[]).map((f) => {
                    const on = appearance.font === f
                    return (
                      <button
                        key={f} type="button" role="radio" aria-checked={on}
                        onClick={() => onAppearance({ ...appearance, font: f })}
                        // Rendered in its own face: you pick by looking, not by
                        // guessing what "Grotesk" is going to turn out to mean.
                        style={{ fontFamily: FONT_STACK[f] }}
                        className={`rounded-lg border px-2 py-1.5 text-xs transition-colors
                          ${on ? 'border-brand bg-brand/10' : 'border-border hover:bg-surface-2'}`}
                      >
                        {FONTS[f]}
                      </button>
                    )
                  })}
                </div>
              </Group>

              <Group label="Density">
                <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Density">
                  {(Object.keys(DENSITIES) as DensityId[]).map((d) => {
                    const on = appearance.density === d
                    return (
                      <button
                        key={d} type="button" role="radio" aria-checked={on}
                        onClick={() => onAppearance({ ...appearance, density: d })}
                        className={`flex-1 rounded-md py-1 text-xs transition-colors
                          ${on ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}
                      >
                        {DENSITIES[d]}
                      </button>
                    )
                  })}
                </div>
              </Group>

              <p className="num mt-2 border-t border-border-soft pt-2 text-[0.6rem] text-muted">
                Stored on this device. Your tasks live in your account.
              </p>
            </div>
          </div>
        </PopoverPortal>
      )}
    </>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="ui-face mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">{label}</p>
      {children}
    </div>
  )
}


/**
 * The declared plan, next to what the numbers actually say.
 *
 * `target_date` and `weekly_hours` would be dead columns if the app only stored
 * them, so this is the surface that reads them back. Two separate claims, kept
 * visibly separate: the MEASURED landing date from forecast(), and — only when
 * there is no velocity to measure — the date the owner's own hours budget
 * implies. The second is labelled "at N h/wk" precisely so it is never mistaken
 * for the first.
 *
 * Renders nothing at all when neither column is set. A project that declared no
 * plan should not be given an empty row of dashes implying it failed to.
 */
function ProjectPlan({ project, ctx }: { project: Project; ctx: Ctx }) {
  const measured = I.forecast(ctx.projectTasks, ctx.tasks)
  const budget = measured.date ? null : I.budgetForecast(ctx.projectTasks, project.weekly_hours)
  const landing = measured.date ?? budget?.date ?? null
  const verdict = I.targetVerdict(project.target_date, landing)

  if (!project.target_date && !project.weekly_hours) return null

  return (
    <p className="num w-full text-xs text-muted">
      {project.target_date && <>Target {I.shortDate(new Date(`${project.target_date}T17:00:00`).getTime())}</>}
      {project.target_date && landing && ' · '}
      {landing && (
        <>
          {measured.date ? 'on pace for ' : 'plan lands '}
          {I.shortDate(landing.getTime())}
          {budget && <> at {project.weekly_hours} h/wk</>}
        </>
      )}
      {verdict && (
        <>
          {' · '}
          <b className={verdict.tone === 'late' ? 'text-brand' : 'text-foreground'}>{verdict.label}</b>
        </>
      )}
    </p>
  )
}

/* ==========================================================================
   LIST
   ========================================================================== */
function ListView({ ctx, onEditProject, onDeleteProject }: {
  ctx: Ctx
  onEditProject: (id: string) => void
  onDeleteProject: (id: string) => void
}) {
  const p = ctx.projects.find((x) => x.id === ctx.activeProject)
  const s = I.stats(ctx.projectTasks)
  const all = isAllScope(ctx.activeProject)

  /* All scope gets a header of its own rather than a project header with holes
     in it. Nothing here edits or deletes: there is no single project to act on,
     and a "Delete project" button under a heading that reads "All projects"
     is a question nobody should be asked. */
  if (all) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-border pb-3">
          <h2 className="text-2xl font-semibold tracking-tight">All projects</h2>
          <p className="num text-xs text-muted">
            {ctx.projects.length} {ctx.projects.length === 1 ? 'project' : 'projects'} ·{' '}
            {s.done} of {s.total} done · {s.todo} to do · {s.doing} in progress
            {s.overdue > 0 && <> · <b className="text-brand">{s.overdue} overdue</b></>}
          </p>
        </div>
        <QuickAdd ctx={ctx} />
        <BoardColumns ctx={ctx} />
      </div>
    )
  }

  if (!p) {
    return <p className="text-sm text-muted">No projects yet — create one from the sidebar.</p>
  }
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-border pb-3">
        <h2 className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
            style={{ background: projectTone(p.color) }}
          />
          {p.name}
        </h2>
        {/* Status is only worth collecting if it is visible somewhere. 'active'
            is the overwhelming default, so only the exceptions get a pill. */}
        {p.status !== 'active' && (
          <span className="ui-face rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">
            {PROJECT_STATUSES.find((x) => x.id === p.status)?.label ?? p.status}
          </span>
        )}
        <p className="num text-xs text-muted">
          {s.done} of {s.total} done · {s.todo} to do · {s.doing} in progress
          {s.overdue > 0 && <> · <b className="text-brand">{s.overdue} overdue</b></>}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {/* Editing was previously reachable only from the "+" popover on the
              sidebar's Projects group — a place nobody looks when they are
              already reading the project. The page that shows a project is
              where changing it belongs, next to the button that deletes it. */}
          <button
            type="button"
            onClick={() => onEditProject(p.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
          >
            <Pencil size={13} />Edit project
          </button>
          <button
            type="button"
            onClick={() => onDeleteProject(p.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
          >
            <Trash2 size={13} />Delete project
          </button>
        </div>
        <ProjectPlan project={p} ctx={ctx} />
        {/* Last child with `w-full`, so it takes a row of its own under the
            title rather than pushing the delete button onto a third line. */}
        {p.description && <p className="w-full text-sm text-muted">{p.description}</p>}
      </div>
      <QuickAdd ctx={ctx} />
      <BoardColumns ctx={ctx} />
    </div>
  )
}

/* ==========================================================================
   PAGE FURNITURE

   The four analysis pages below are the full-page form of what the dashboard's
   floating board shows in a panel. They are drawn from `lib/insights` again
   rather than being the panel bodies stretched, because a 300px panel and a
   1100px page are not the same design: a panel abbreviates to survive, a page
   can afford the ranked list, the comparison table and the axis labels that
   the abbreviation was standing in for. The board keeps its panels either way.
   ========================================================================== */

/** The heading every page opens with — what you are looking at, then one line
    saying what it means. Same rule and rhythm as ListView's header. */
function PageHead({ title, lede, project, all }: {
  title: string
  lede: React.ReactNode
  project?: Project | null
  /** All scope. Named rather than left blank: a page with no scope chip at all
      reads as "one project, unlabelled", which is the wrong answer. */
  all?: boolean
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {all && (
        <span className="ui-face rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">
          All projects
        </span>
      )}
      {project && (
        <span className="num flex items-baseline gap-1.5 text-xs text-muted">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 self-center rounded-full"
            style={{ background: projectTone(project.color) }}
          />
          {project.name}
        </span>
      )}
      <p className="w-full text-sm text-muted">{lede}</p>
    </div>
  )
}

function Tile({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className={`num text-2xl font-semibold ${warn ? 'text-brand' : ''}`}>{value}</p>
      <p className="ui-face mt-1 text-[0.6rem] uppercase tracking-wider text-muted">{label}</p>
    </div>
  )
}

function PageCard({ title, aside, className, children }: {
  title: string
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className ?? ''}`}>
      <h3 className="ui-face mb-2 flex items-baseline gap-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
        {title}
        {aside != null && <span className="num ml-auto tracking-normal">{aside}</span>}
      </h3>
      {children}
    </section>
  )
}

/** Key/value row — the page-scale twin of the board's `Fig`. */
function KV({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-soft py-1.5 last:border-0">
      <span className="text-sm text-muted">{k}</span>
      <span className={`num text-sm font-semibold ${warn ? 'text-brand' : ''}`}>{v}</span>
    </div>
  )
}

/** Same answer on every project-scoped page, so it is written once. */
const NoProject = () => (
  <p className="text-sm text-muted">No projects yet — create one from the sidebar.</p>
)

/**
 * Which project a row belongs to, as the sidebar's own dot plus the name.
 *
 * Rendered ONLY in All scope. Inside one project every row would carry the same
 * label, which is chrome rather than information; merged, a bare task title is
 * genuinely ambiguous — two projects can both have a "write the copy".
 */
const ProjectMark = ({ project }: { project?: Project | null }) => (
  <>
    <span
      aria-hidden="true"
      className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
      style={{ background: project ? projectTone(project.color) : 'var(--color-muted)' }}
    />
    {project?.name ?? 'no project'} ·{' '}
  </>
)

/** A task's priority as the dot the board uses, so the two read alike. */
const PRIORITY_TONE: Record<string, string> = {
  high: 'var(--color-brand)',
  medium: 'var(--color-doing)',
  low: 'var(--color-muted)',
}

/** "at this pace, this date" — or an honest refusal. */
const landing = (f: I.Forecast) =>
  f.done ? 'complete' : !isFinite(f.days) ? 'no pace' : I.shortDate(f.date!.getTime())

/* ==========================================================================
   PROGRESS

   The panel answers "how is this project doing" in nine figures and a sparkline.
   The page answers it, then answers the question that always comes next —
   "compared to what?" — with the same numbers for every project at once.
   ========================================================================== */
function ProgressView({ ctx }: { ctx: Ctx }) {
  const all = isAllScope(ctx.activeProject)
  const p = ctx.projects.find((x) => x.id === ctx.activeProject)
  if (!p && !all) return <NoProject />

  const s = I.stats(ctx.projectTasks)
  const m = I.momentum(ctx.tasks)
  const f = I.forecast(ctx.projectTasks, ctx.tasks)
  const trend = m.trend > 0.15 ? 'rising' : m.trend < -0.15 ? 'falling' : 'steady'
  const health = Math.round(I.health(ctx.projectTasks) * 100)
  const lands = landing(f)
  const open = s.total - s.done

  const bar = [
    { k: 'Done', n: s.done, c: 'var(--color-done)' },
    { k: 'In progress', n: s.doing, c: 'var(--color-doing)' },
    { k: 'To do', n: s.todo, c: 'var(--color-todo)' },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHead
        title="Progress"
        project={p}
        all={all}
        lede={
          s.total === 0
            ? 'Nothing filed yet, so there is nothing to measure.'
            : `${s.pct}% done, ${open} still open${s.overdue > 0 ? `, ${s.overdue} overdue` : ''} · ` +
              `${lands === 'no pace' ? 'no measurable pace, so no landing date' : `at this pace it lands ${lands}`}.`
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="To do" value={s.todo} />
        <Tile label="In progress" value={s.doing} />
        <Tile label="Done" value={`${s.done}/${s.total}`} />
        <Tile label="Overdue" value={s.overdue} warn={s.overdue > 0} />
        <Tile label="Hours left" value={`${s.hoursLeft}h`} />
        <Tile label="Health" value={`${health}%`} warn={health < 50} />
      </div>

      <PageCard title="Where the work sits" aside={`${s.total} tasks`} className="mb-4">
        <div
          role="img"
          aria-label={`${s.done} done, ${s.doing} in progress, ${s.todo} to do`}
          className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
        >
          {bar.map((b) => (
            <span key={b.k} style={{ width: `${(b.n / Math.max(1, s.total)) * 100}%`, background: b.c }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {bar.map((b) => (
            <span key={b.k} className="num flex items-center gap-1.5 text-[0.7rem] text-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: b.c }} />
              {b.k} {b.n}
            </span>
          ))}
        </div>
      </PageCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageCard title="Burndown — 30 days">
          <Burndown tasks={ctx.projectTasks} height={170} />
          <p className="num mt-1 text-[0.65rem] text-muted">
            Solid = still open · dashed = finished. Rebuilt from created and completion
            dates, so deleted work is simply gone rather than rewritten.
          </p>
        </PageCard>

        <PageCard title="Pace" aside={`${m.windowDays}-day window`}>
          <KV k="Finished in the window" v={m.completed} />
          <KV k="Per week" v={`${m.perWeek}/wk`} />
          <KV k="Per day" v={m.perDay} />
          <KV k="Trend" v={trend} warn={m.trend < -0.15} />
          <KV k="Remaining here" v={f.remaining} />
          <KV k="Lands" v={lands} warn={!isFinite(f.days)} />
        </PageCard>
      </div>

      <PageCard title="Every project" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="ui-face text-[0.6rem] uppercase tracking-wider text-muted">
                <th scope="col" className="py-1 text-left font-semibold">Project</th>
                <th scope="col" className="py-1 text-left font-semibold">Complete</th>
                <th scope="col" className="py-1 text-right font-semibold">Open</th>
                <th scope="col" className="py-1 text-right font-semibold">Overdue</th>
                <th scope="col" className="py-1 text-right font-semibold">Lands</th>
              </tr>
            </thead>
            <tbody>
              {ctx.projects.map((row) => {
                const rt = ctx.tasks.filter((t) => t.project_id === row.id)
                const rs = I.stats(rt)
                const rf = I.forecast(rt, ctx.tasks)
                return (
                  <tr key={row.id} className="border-t border-border-soft">
                    <th scope="row" className="max-w-[12rem] truncate py-1.5 text-left font-normal">
                      <span
                        aria-hidden="true"
                        className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: projectTone(row.color) }}
                      />
                      {row.name}
                    </th>
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${rs.pct}%` }} />
                        </span>
                        <span className="num text-[0.7rem] text-muted">{rs.pct}%</span>
                      </span>
                    </td>
                    <td className="num py-1.5 text-right">{rs.total - rs.done}</td>
                    <td className={`num py-1.5 text-right ${rs.overdue > 0 ? 'font-semibold text-brand' : ''}`}>
                      {rs.overdue}
                    </td>
                    <td className={`num py-1.5 text-right ${!isFinite(rf.days) ? 'text-brand' : ''}`}>
                      {landing(rf)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  )
}

/* ==========================================================================
   PRIORITIES

   The panel shows the single next action. The page shows the whole queue and
   the arithmetic behind it — `score()` was written to be readable back to the
   user, and a page is the only place there is room to actually do that.
   ========================================================================== */
function PrioritiesView({ ctx }: { ctx: Ctx }) {
  const all = isAllScope(ctx.activeProject)
  const p = ctx.projects.find((x) => x.id === ctx.activeProject)
  if (!p && !all) return <NoProject />
  const byId = new Map(ctx.projects.map((x) => [x.id, x]))

  const ranked = ctx.projectTasks
    .filter((t) => t.status !== 'done')
    .map((t) => ({ t, s: I.score(t), why: I.explain(t) }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  const rest = ranked.slice(1)

  const act = (t: Task) => ctx.move(t.id, t.status === 'doing' ? 'done' : 'doing')

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHead
        title="Priorities"
        project={p}
        all={all}
        lede={
          top
            ? `${ranked.length} open ${ranked.length === 1 ? 'task' : 'tasks'}, ranked by deadline pressure, stated priority, whether you already started, and how long it has sat.`
            : `Nothing open in ${all ? 'any project' : p!.name}. The queue is the reward.`
        }
      />

      {top && (
        <section className="mb-4 rounded-xl border border-brand/40 bg-brand/5 p-4 sm:p-5">
          <p className="ui-face mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-brand">
            Do this next
          </p>
          <h3 className="text-lg font-semibold leading-snug sm:text-xl">{top.t.title}</h3>
          <p className="num mt-1 text-xs text-muted">
            {all && <ProjectMark project={byId.get(top.t.project_id)} />}
            {top.why} · {top.t.priority} priority · score {top.s.toFixed(2)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button" onClick={() => act(top.t)}
              className="rounded-lg border border-brand/50 bg-brand/10 px-3 py-1.5 text-xs font-semibold hover:bg-brand/20"
            >
              {top.t.status === 'doing' ? 'Mark done' : 'Start it'}
            </button>
            <button
              type="button" onClick={() => ctx.setEditing(top.t.id)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
            >
              Open it
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <PageCard title="The queue" aside={rest.length ? `${rest.length} behind it` : undefined}>
          {rest.length === 0 ? (
            <p className="text-sm text-muted">
              {top ? 'Nothing else is waiting.' : 'Nothing open — add something below.'}
            </p>
          ) : rest.map((r, i) => (
            <div
              key={r.t.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-soft py-2 last:border-0"
            >
              <span className="num w-5 shrink-0 text-[0.7rem] text-muted">{i + 2}</span>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
                style={{ background: PRIORITY_TONE[r.t.priority] ?? 'var(--color-muted)' }} />
              <button
                type="button" onClick={() => ctx.setEditing(r.t.id)}
                className="min-w-0 max-w-full flex-1 truncate text-left text-sm hover:text-brand"
              >
                {r.t.title}
              </button>
              <span className="num text-[0.65rem] text-muted">
                {all && <ProjectMark project={byId.get(r.t.project_id)} />}{r.why}
              </span>
              <button
                type="button" onClick={() => act(r.t)}
                className="ml-auto shrink-0 rounded border border-border px-2 py-0.5 text-[0.65rem] hover:bg-surface-2"
              >
                {r.t.status === 'doing' ? 'Done' : 'Start'}
              </button>
            </div>
          ))}
        </PageCard>

        <div className="grid gap-4 content-start">
          <PageCard title="Capture">
            <QuickAdd ctx={ctx} />
          </PageCard>
          <PageCard title="How the ranking works">
            <p className="text-sm leading-relaxed text-muted">
              Nothing here is hand-sorted. Each open task scores on five terms and the
              queue is that score, descending.
            </p>
            <div className="mt-2">
              <KV k="Deadline pressure" v="×3.2" />
              <KV k="Stated priority" v="×2.4" />
              <KV k="Already started" v="+1.6" />
              <KV k="Left untouched" v="×0.9" />
              <KV k="Small enough to finish" v="×0.7" />
            </div>
          </PageCard>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   STALE

   Deliberately NOT project-scoped, in either form: the whole point is the work
   you have stopped thinking about, and you do not forget things one project at
   a time. The panel truncates at eight; the page shows all of it, grouped by
   project so the pattern is visible rather than just the list.
   ========================================================================== */
function StaleView({ ctx }: { ctx: Ctx }) {
  const open = ctx.tasks.filter((t) => t.status !== 'done')
  const dead = open
    .filter((t) => I.staleness(t) > 0.18)
    .sort((a, b) => I.staleness(b) - I.staleness(a))

  const days = (t: Task) => Math.floor((Date.now() - I.touchedAt(t)) / I.DAY)
  const hours = Math.round(dead.reduce((a, t) => a + I.estimateOf(t), 0) * 10) / 10
  const share = open.length ? Math.round((dead.length / open.length) * 100) : 0

  /* Grouped rather than one flat list: "four of these are the same project" is
     the finding, and a flat list sorted by decay hides it. */
  const byProject = ctx.projects
    .map((p) => ({ p, items: dead.filter((t) => t.project_id === p.id) }))
    .filter((g) => g.items.length > 0)
  const orphans = dead.filter((t) => !ctx.projects.some((p) => p.id === t.project_id))

  if (dead.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <PageHead
          title="Stale"
          lede="Tasks left untouched long enough to be presumed lost, across every project."
        />
        <PageCard title="Nothing rotting">
          <p className="text-sm text-muted">
            Every one of your {open.length} open {open.length === 1 ? 'task' : 'tasks'} has been
            touched recently enough to still count as alive. Nothing to bury.
          </p>
        </PageCard>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHead
        title="Stale"
        lede={`${dead.length} of your ${open.length} open tasks have gone untouched long enough to be presumed lost — every project, not just the one in the bar. Revive them or let them go.`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Presumed lost" value={dead.length} warn />
        <Tile label="Share of open" value={`${share}%`} warn={share > 33} />
        <Tile label="Longest untouched" value={`${days(dead[0])}d`} />
        <Tile label="Hours parked" value={`${hours}h`} />
      </div>

      <div className="grid gap-4">
        {[...byProject, ...(orphans.length ? [{ p: null, items: orphans }] : [])].map((g) => (
          <PageCard
            key={g.p?.id ?? 'orphans'}
            title={g.p?.name ?? 'No project'}
            aside={`${g.items.length} stale`}
          >
            {g.items.map((t) => {
              const pct = Math.round(I.staleness(t) * 100)
              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-soft py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <p className="truncate text-sm italic leading-snug">{t.title}</p>
                    <p className="num text-[0.65rem] text-muted">
                      untouched {days(t)}d · {t.status === 'doing' ? 'started and dropped' : 'never started'}
                      {I.isOverdue(t) && <> · <b className="text-brand">overdue</b></>}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2"
                      role="img" aria-label={`${pct}% decayed`}
                    >
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="num w-9 text-right text-[0.65rem] text-muted">{pct}%</span>
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => ctx.patch(t.id, { status: 'doing' })}
                      className="rounded border border-border px-2 py-0.5 text-[0.65rem] hover:bg-surface-2">
                      Revive
                    </button>
                    <button type="button" onClick={() => ctx.remove(t.id)}
                      className="rounded border border-brand/50 px-2 py-0.5 text-[0.65rem] text-brand hover:bg-brand/10">
                      Let go
                    </button>
                  </span>
                </div>
              )
            })}
          </PageCard>
        ))}
      </div>
    </div>
  )
}

/* ==========================================================================
   NOTES

   ONE store, two windows onto it. The dashboard's Notes panel and this page
   read and write the same localStorage key with the same record shape, so a
   note written in either is the same note in the other — a second store here
   would not be a nicer page, it would be a way to lose work.

   Notes still have no table, so they are per-device and per-account. Saying so
   out loud is part of the design, not a disclaimer: nobody should learn that
   from a cleared cache.
   ========================================================================== */
interface Note { id: string; ts: number; project: string | null; text: string }

/** The one key. Both windows derive it from this, so they cannot drift. */
const notesKey = (userId: string) => `project-tracker-notes:${userId}`

function readNotes(userId: string): Note[] {
  try {
    const v = JSON.parse(localStorage.getItem(notesKey(userId)) ?? '[]')
    return Array.isArray(v) ? (v as Note[]) : []
  } catch {
    return []
  }
}

function NotesView({ ctx }: { ctx: Ctx }) {
  const key = notesKey(ctx.user.id)
  const [notes, setNotes] = useState<Note[]>(() => readNotes(ctx.user.id))
  const [draft, setDraft] = useState('')
  const [mine, setMine] = useState(false)

  /* Another tab — or an older tab still showing the board — writing the same
     key is the same store changing under us, not a conflict to resolve. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setNotes(readNotes(ctx.user.id))
    }
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [key, ctx.user.id])

  const commit = (next: Note[]) => {
    setNotes(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* no persistence available */ }
  }

  const addNote = () => {
    const text = draft.trim()
    if (!text) return
    // The All sentinel is not a project id, and a note stamped with it would
    // never match a project filter again. All means "filed under none".
    const project = isAllScope(ctx.activeProject) ? null : ctx.activeProject
    commit([{ id: `n${Date.now().toString(36)}`, ts: Date.now(), project, text }, ...notes])
    setDraft('')
  }

  const all = isAllScope(ctx.activeProject)
  const project = ctx.projects.find((x) => x.id === ctx.activeProject) ?? null
  const shown = mine && project ? notes.filter((n) => n.project === project.id) : notes

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHead
        title="Notes"
        project={project}
        all={all}
        lede={
          notes.length === 0
            ? 'Somewhere to put a thought that is not a task yet. Saved on this device only — not synced to your account.'
            : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}, newest first. Saved on this device only — not synced to your account.`
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
        <PageCard title={project ? `New note · ${project.name}` : 'New note'}>
          <textarea
            name="note" aria-label={project ? `New note in ${project.name}` : 'New note'}
            value={draft} rows={5}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() } }}
            placeholder="A thought about a task, a project, anything not worth filing yet…"
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={addNote} disabled={!draft.trim()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40"
            >
              Add note
            </button>
            <span className="num text-[0.62rem] text-muted">Enter to add · Shift+Enter for a new line</span>
          </div>
          <p className="num mt-3 border-t border-border-soft pt-2 text-[0.62rem] leading-relaxed text-muted">
            The same notes appear in the dashboard's Notes panel — one store, two
            windows. Clearing this browser's site data clears both.
          </p>
        </PageCard>

        <div>
          {project && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[
                { on: !mine, label: `All notes (${notes.length})`, set: false },
                { on: mine, label: `${project.name} only`, set: true },
              ].map((c) => (
                <button
                  key={c.label} type="button" aria-pressed={c.on} onClick={() => setMine(c.set)}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    c.on ? 'border-brand bg-brand/15' : 'border-border hover:bg-surface-2'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <PageCard title="Nothing here yet">
              <p className="text-sm text-muted">
                {notes.length === 0
                  ? 'Write the first one on the left. A note can become a task later — the tokens !high, @fri and /project still work when it does.'
                  : 'No notes filed under this project. Switch back to all notes.'}
              </p>
            </PageCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((n) => (
                <article key={n.id} className="flex flex-col rounded-xl border border-border bg-surface p-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{n.text}</p>
                  <p className="num mt-2 text-[0.62rem] text-muted">
                    {ctx.projects.find((x) => x.id === n.project)?.name ?? 'general'} · {I.relDay(n.ts)}
                  </p>
                  <div className="mt-2 flex gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        // Same route as the panel's button: the note text goes
                        // through the same parser as quick add, so tokens
                        // written into it carry straight onto the task.
                        if (await ctx.add(n.text, n.project ?? undefined)) {
                          commit(notes.filter((x) => x.id !== n.id))
                        }
                      }}
                      className="rounded border border-border px-2 py-0.5 text-[0.65rem] hover:bg-surface-2"
                    >
                      Make it a task
                    </button>
                    <button
                      type="button" onClick={() => commit(notes.filter((x) => x.id !== n.id))}
                      className="rounded border border-brand/50 px-2 py-0.5 text-[0.65rem] text-brand hover:bg-brand/10"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   CALENDAR
   ========================================================================== */
function CalendarView({ ctx }: { ctx: Ctx }) {
  const [monthTs, setMonthTs] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime()
  })
  const base = new Date(monthTs)
  const gridStart = new Date(base.getTime() - base.getDay() * I.DAY)

  const byDay = new Map<number, Task[]>()
  for (const t of ctx.tasks) {
    const d = I.dueAt(t)
    if (d == null) continue
    const k = new Date(new Date(d).setHours(0, 0, 0, 0)).getTime()
    byDay.set(k, [...(byDay.get(k) ?? []), t])
  }
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const byId = new Map(ctx.projects.map((p) => [p.id, p]))

  const step = (n: number) => {
    const d = new Date(monthTs); d.setMonth(d.getMonth() + n); setMonthTs(d.getTime())
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <span className="flex-1" />
        {[['◄ Prev', -1], ['Next ►', 1]].map(([label, n]) => (
          <button key={String(label)} type="button" onClick={() => step(n as number)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">{label}</button>
        ))}
        <button type="button" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthTs(d.getTime()) }}
          className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">Today</button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="ui-face bg-surface-2 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">{d}</div>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const day = new Date(gridStart.getTime() + i * I.DAY)
          day.setHours(0, 0, 0, 0)
          const out = day.getMonth() !== base.getMonth()
          const items = byDay.get(day.getTime()) ?? []
          return (
            <div key={i} className={`min-h-[5.5rem] p-1.5 ${out ? 'bg-background' : 'bg-surface'} ${day.getTime() === today ? 'ring-1 ring-inset ring-brand' : ''}`}>
              <span className="num text-[0.6rem] text-muted">{day.getDate()}</span>
              {items.slice(0, 3).map((t) => {
                /* The calendar never was project-scoped — it always merges every
                   project — so the marker is not gated on the All scope the
                   other views switch on. It is a dot and a tooltip rather than
                   a dot and a name because a day cell is one line wide and the
                   title is the thing that must stay readable. */
                const proj = byId.get(t.project_id)
                return (
                  <button key={t.id} type="button" onClick={() => ctx.setSelected(t.id)}
                    title={proj ? `${t.title} — ${proj.name}` : t.title}
                    aria-label={proj ? `${t.title}, ${proj.name}` : t.title}
                    className={`mt-0.5 flex w-full items-center gap-1 border-l-2 pl-1 text-left text-[0.65rem] leading-tight
                      ${I.isOverdue(t) ? 'border-brand text-brand' : t.status === 'done' ? 'border-border text-muted line-through' : 'border-border'}`}>
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: projectTone(proj?.color) }} />
                    <span className="truncate">{t.title}</span>
                  </button>
                )
              })}
              {items.length > 3 && <span className="num text-[0.6rem] text-muted">+{items.length - 3}</span>}
            </div>
          )
        })}
      </div>
      <p className="num mt-2 text-[0.65rem] text-muted">
        {[...byDay.values()].flat().length} tasks have a due date · highlighted = overdue
      </p>
    </div>
  )
}

/* ==========================================================================
   REPORTS
   ========================================================================== */
function ReportsView({ ctx }: { ctx: Ctx }) {
  const s = I.stats(ctx.tasks)
  const m = I.momentum(ctx.tasks)
  const f = I.forecast(ctx.tasks)
  const stale = ctx.tasks
    .filter((t) => t.status !== 'done' && I.staleness(t) > 0.18)
    .sort((a, b) => I.staleness(b) - I.staleness(a))
    .slice(0, 8)

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-2xl font-semibold tracking-tight">Reports</h2>
        <p className="mt-1 text-sm text-muted">Computed from your own history — nothing estimated by hand.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Open', s.todo + s.doing, false],
          ['Overdue', s.overdue, s.overdue > 0],
          ['Complete', `${s.pct}%`, false],
          ['Per week', m.perWeek, false],
          ['Hours left', `${s.hoursLeft}h`, false],
        ].map(([label, value, bad]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-surface p-3">
            <p className={`num text-2xl font-semibold ${bad ? 'text-brand' : ''}`}>{value}</p>
            <p className="ui-face mt-1 text-[0.6rem] uppercase tracking-wider text-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h3 className="ui-face mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Burndown — 30 days</h3>
          <Burndown tasks={ctx.tasks} height={120} />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h3 className="ui-face mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Landing dates</h3>
          <table className="w-full text-sm">
            <tbody>
              {ctx.projects.map((p) => {
                const pt = ctx.tasks.filter((t) => t.project_id === p.id)
                const pf = I.forecast(pt, ctx.tasks)
                return (
                  <tr key={p.id} className="border-b border-border-soft last:border-0">
                    <th scope="row" className="py-1 text-left font-normal text-muted">{p.name}</th>
                    <td className={`num py-1 text-right font-semibold ${!isFinite(pf.days) ? 'text-brand' : ''}`}>
                      {pf.done ? 'complete' : !isFinite(pf.days) ? 'no pace' : I.shortDate(pf.date!.getTime())}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <th scope="row" className="py-1 text-left font-semibold">Everything</th>
                <td className="num py-1 text-right font-semibold">
                  {f.done ? 'complete' : !isFinite(f.days) ? 'no pace' : I.shortDate(f.date!.getTime())}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h3 className="ui-face mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
          Presumed lost <span className="num">{stale.length}</span>
        </h3>
        {stale.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been left to rot.</p>
        ) : stale.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border-soft py-2 last:border-0">
            <span className="text-sm italic">{t.title}</span>
            <span className="num text-[0.65rem] text-muted">
              untouched {Math.floor((Date.now() - I.touchedAt(t)) / I.DAY)}d · {Math.round(I.staleness(t) * 100)}% gone
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => ctx.patch(t.id, { status: 'doing' })}
              className="rounded border border-border px-2 py-0.5 text-[0.65rem] hover:bg-surface-2">Revive</button>
            <button type="button" onClick={() => ctx.remove(t.id)}
              className="rounded border border-brand/50 px-2 py-0.5 text-[0.65rem] text-brand hover:bg-brand/10">Let go</button>
          </div>
        ))}
      </section>
    </div>
  )
}

/* ==========================================================================
   VERSIONS
   --------------------------------------------------------------------------
   Every archived release is a real build served at /v/<version>/, so this page
   can hand you the running thing instead of a screenshot and a description of
   it. Older versions talk to the same Supabase project as this one — they are
   old interfaces onto current data, not snapshots of old data.
   ========================================================================== */
function VersionsView() {
  const [preview, setPreview] = useState<string | null>(null)

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-2xl font-semibold tracking-tight">Versions</h2>
        <p className="mt-1 text-sm text-muted">
          Every release since the first. The archived ones are running builds — open one and
          it works, signed in as you, against the same data.
        </p>
      </div>

      <ol className="relative border-l border-border pl-5">
        {RELEASES.map((r) => {
          const href = `/v/${r.version}/`
          return (
            <li key={r.version} className="mb-5 last:mb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background
                  ${r.current ? 'bg-brand' : 'bg-border'}`}
              />
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h3 className="num text-base font-semibold">v{r.version}</h3>
                  {r.current && (
                    <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[0.6rem] font-medium">
                      You are here
                    </span>
                  )}
                  <span className="num text-[0.65rem] text-muted">{r.date}</span>
                </div>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-sm text-muted">{r.summary}</p>

                <ul className="mt-2.5 space-y-1">
                  {r.changes.map((c) => (
                    <li key={c} className="flex gap-2 text-[0.8rem] leading-snug">
                      <span aria-hidden="true" className="text-muted">·</span>{c}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.archived ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreview(preview === href ? null : href)}
                        aria-expanded={preview === href}
                        className="rounded-lg border border-brand/50 bg-brand/10 px-2.5 py-1 text-xs"
                      >
                        {preview === href ? 'Close preview' : 'Preview here'}
                      </button>
                      <a
                        href={href} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
                      >
                        Open v{r.version}<ExternalLink size={12} />
                      </a>
                    </>
                  ) : (
                    <span className="num rounded-lg border border-border px-2.5 py-1 text-xs text-muted">
                      Running now
                    </span>
                  )}
                  <a
                    href={`${REPO}/releases/tag/v${r.version}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
                  >
                    Source<ExternalLink size={12} />
                  </a>
                </div>

                {preview === href && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    {/* Same origin, so it inherits the session — the preview is
                        the actual app, not a marketing shot of it. */}
                    <iframe
                      src={href}
                      title={`Project Tracker v${r.version}`}
                      className="block h-[26rem] w-full bg-background"
                    />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <p className="num mt-4 text-[0.65rem] text-muted">
        Archived builds are produced by <code>scripts/archive-version.mjs</code> from the
        git tag, not hand-copied. Full history in{' '}
        <a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer" className="underline">
          CHANGELOG.md
        </a>.
      </p>
    </div>
  )
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */
function SettingsView({
  appearance, onAppearance, ctx,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void; ctx: Ctx }) {
  const mode = resolveMode(appearance.mode)
  const Row = ({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft py-3 last:border-0">
      <div><p className="text-sm">{label}</p><p className="num text-[0.65rem] text-muted">{hint}</p></div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs ${on ? 'border-brand bg-brand/15' : 'border-border hover:bg-surface-2'}`}>
      {children}
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted">Appearance is stored on this device. Your tasks live in your account.</p>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h3 className="ui-face mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Appearance</h3>
        <Row label="Mode" hint="Every theme has a light and a dark palette">
          {(Object.keys(MODES) as ModeId[]).map((id) => {
            const Icon = id === 'light' ? Sun : id === 'dark' ? Moon : Monitor
            return (
              <Chip key={id} on={appearance.mode === id} onClick={() => onAppearance({ ...appearance, mode: id })}>
                <Icon size={12} className="mr-1.5 inline-block translate-y-[1px]" />{MODES[id]}
              </Chip>
            )
          })}
        </Row>
        <Row label="Theme" hint="Colour only — layout and spacing do not change">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <Chip key={id} on={appearance.theme === id} onClick={() => onAppearance({ ...appearance, theme: id })}>
              <span className="mr-1.5 inline-block h-2.5 w-2.5 translate-y-[1px] rounded-[2px]"
                style={{ background: `linear-gradient(135deg, ${THEME_SWATCH[id][mode][0]} 0 52%, ${THEME_SWATCH[id][mode][2]} 52% 100%)` }} />
              {THEMES[id]}
            </Chip>
          ))}
        </Row>
        <Row label="Font" hint="System faces only — nothing is fetched over the network">
          {(Object.keys(FONTS) as FontId[]).map((id) => (
            <Chip key={id} on={appearance.font === id} onClick={() => onAppearance({ ...appearance, font: id })}>
              <span style={{ fontFamily: FONT_STACK[id] }}>{FONTS[id]}</span>
            </Chip>
          ))}
        </Row>
        <Row label="Density" hint="Panel padding and the gap between tiles">
          {(Object.keys(DENSITIES) as DensityId[]).map((id) => (
            <Chip key={id} on={appearance.density === id} onClick={() => onAppearance({ ...appearance, density: id })}>
              {DENSITIES[id]}
            </Chip>
          ))}
        </Row>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h3 className="ui-face mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Account</h3>
        <Row label={ctx.user.displayName} hint={ctx.user.username}>
          <span className="num text-[0.65rem] text-muted">
            {usingRealBackend ? 'Supabase · row-level security' : 'Demo mode · this browser only'}
          </span>
        </Row>
        <Row label="Panels" hint="Set them from the strip under the dashboard">
          <span className="num text-[0.65rem] text-muted">
            {(Object.keys(PANELS) as PanelId[]).map((p) => PANELS[p].title).join(', ')}
          </span>
        </Row>
      </section>
    </div>
  )
}
