import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard, ListTodo, Plus, LogOut, Trash2, Loader2,
  FolderKanban, Calendar as CalIcon, BarChart3, Settings as GearIcon,
  Sun, Moon, Monitor, Palette, History, ExternalLink, Check,
  Pencil, Gauge, Flag, Hourglass, StickyNote,
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarCollapsibleGroup, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarTrigger, sidebarIconButton, useSidebar,
} from '@/components/ui/sidebar'
import { usePopover, PANEL as POPOVER } from '@/components/ui/pickers'
import {
  listProjects, listTasks, createProject, createTask, updateTask, deleteTask,
  deleteProject, updateProject, seedIfEmpty, signOut, usingRealBackend, applyOrder,
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
import { RELEASES, REPO } from '@/lib/releases'
import { Workboard, PANELS, type PanelId, type PanelFocus } from '@/components/board/Workboard'
import { TaskDialog } from '@/components/board/TaskDialog'
import {
  ProjectDialog, projectTone, PROJECT_STATUSES, type ProjectDraft,
} from '@/components/board/ProjectDialog'
import { BoardColumns, QuickAdd, Burndown, type Ctx } from '@/components/board/shared'

type View = 'dashboard' | 'list' | 'calendar' | 'reports' | 'versions' | 'settings'

const VIEWS: Record<View, { title: string; icon: JSX.Element }> = {
  dashboard: { title: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  list: { title: 'List', icon: <ListTodo size={16} /> },
  calendar: { title: 'Calendar', icon: <CalIcon size={16} /> },
  reports: { title: 'Reports', icon: <BarChart3 size={16} /> },
  versions: { title: 'Versions', icon: <History size={16} /> },
  settings: { title: 'Settings', icon: <GearIcon size={16} /> },
}

/* ============================================================================
   SIDEBAR ENTRIES

   What each editable group can contain. `WORKSPACE_ENTRIES` deliberately mixes
   two kinds of destination — the two full views, and the dashboard's panels —
   because from the reader's side they are the same thing: places to go. The
   `kind` discriminates what clicking one actually does.

   The panel titles come from Workboard's PANELS registry rather than being
   retyped, so renaming a panel there renames it here too.
   ========================================================================== */
type Entry =
  | { id: string; kind: 'view'; view: View; label: string; icon: JSX.Element }
  | { id: string; kind: 'panel'; panel: PanelId; label: string; icon: JSX.Element }

const PANEL_ICON: Record<PanelId, JSX.Element> = {
  list: <ListTodo size={16} />,
  progress: <Gauge size={16} />,
  priorities: <Flag size={16} />,
  stale: <Hourglass size={16} />,
  notes: <StickyNote size={16} />,
}

/** `list` is omitted as a panel: the List VIEW is already in this group, and
    two entries labelled "List" doing different things is a puzzle, not a
    feature. */
const WORKSPACE_ENTRIES: Entry[] = [
  { id: 'dashboard', kind: 'view', view: 'dashboard', label: 'Dashboard', icon: VIEWS.dashboard.icon },
  { id: 'list', kind: 'view', view: 'list', label: 'List', icon: VIEWS.list.icon },
  ...(['progress', 'priorities', 'stale', 'notes'] as PanelId[]).map((p): Entry => ({
    id: `panel:${p}`, kind: 'panel', panel: p, label: PANELS[p].title, icon: PANEL_ICON[p],
  })),
]

const MORE_ENTRIES: Entry[] = (['calendar', 'reports', 'versions', 'settings'] as View[])
  .map((v): Entry => ({ id: v, kind: 'view', view: v, label: VIEWS[v].title, icon: VIEWS[v].icon }))

/** Which entries a group shows. `null` prefs mean "this build's default set",
    so a later version adding an entry shows it to everyone who never opened
    the picker — rather than it being invisible because an old list was frozen
    into storage. Unknown saved ids are dropped on the way out. */
function visibleEntries(all: Entry[], chosen: string[] | null, fallback: string[]): Entry[] {
  const want = chosen ?? fallback
  return want.map((id) => all.find((e) => e.id === id)).filter((e): e is Entry => Boolean(e))
}

const WORKSPACE_DEFAULT = ['dashboard', 'list']
const MORE_DEFAULT = MORE_ENTRIES.map((e) => e.id)

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
      )}
    </>
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

  /** A panel entry navigates to the dashboard AND asks the board to open that
      panel. The nonce is what makes a repeat click work: without it the prop
      would be unchanged and the effect would not re-run, so clicking "Notes"
      twice would do nothing the second time. */
  const [panelFocus, setPanelFocus] = useState<PanelFocus | null>(null)
  const showPanel = useCallback((id: PanelId) => {
    setView('dashboard')
    setPanelFocus({ id, nonce: Date.now() })
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

  const projectTasks = useMemo(
    () => (activeProject ? tasks.filter((t) => t.project_id === activeProject) : []),
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

    try {
      await applyOrder({ id, status, position: plan.position }, plan.renumber)
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Could not move that task.')
    }
  }, [tasks])

  /** Status change with no opinion about where — lands at the end of the column. */
  const move = useCallback((id: string, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return Promise.resolve()
    const rest = O.column(tasks, t.project_id, status).filter((x) => x.id !== id)
    return reorder(id, status, rest.length)
  }, [tasks, reorder])

  const remove = useCallback(async (id: string) => {
    const prev = tasks
    setTasks((cur) => cur.filter((t) => t.id !== id))
    if (selected === id) setSelected(null)
    try {
      await deleteTask(id)
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Could not delete that task.')
    }
  }, [tasks, selected])

  const add = useCallback(async (text: string, projectId?: string) => {
    const p = I.parse(text, projects)
    const pid = p.projectId || projectId || activeProject
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
      setEditingProject(null)
      return null
    } catch (err) {
      setProjects(prev)
      const msg = err instanceof Error ? err.message : 'Could not save that project.'
      setError(msg)
      return msg
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
      const p = await createProject(d.name, d.description, d.color, d.status)
      setProjects((cur) => [...cur, p])
      setActiveProject(p.id)
      setView('list')
      setCreatingProject(false)
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
    try {
      await deleteProject(id)
      const rest = projects.filter((p) => p.id !== id)
      setProjects(rest)
      setTasks((cur) => cur.filter((t) => t.project_id !== id))
      if (activeProject === id) setActiveProject(rest[0]?.id ?? null)
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
                    active={e.kind === 'view' ? view === e.view : false}
                    onClick={() => (e.kind === 'view' ? setView(e.view) : showPanel(e.panel))}
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
            <SidebarMenu>
              {projects.map((p) => {
                const s = I.stats(tasks.filter((t) => t.project_id === p.id))
                return (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      active={activeProject === p.id && view === 'list'}
                      onClick={() => { setActiveProject(p.id); setView('list') }}
                    >
                      {/* The dot is the only place a project's colour is
                          visible, so it reads `p.color` rather than a fixed
                          accent. 'violet' — every legacy row — resolves back to
                          the theme brand, so nothing changes appearance. */}
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
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setCreatingProject(true)}>
                  <Plus size={16} />New project
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
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
                    active={e.kind === 'view' && view === e.view}
                    onClick={() => e.kind === 'view' && setView(e.view)}
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
            <Workboard ctx={ctx} focus={panelFocus} />
          ) : (
            <div className="scene-enter flex-1 overflow-auto p-4 sm:p-6">
              {view === 'list' && <ListView ctx={ctx} onDeleteProject={askDeleteProject} />}
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

      {(view === 'dashboard' || view === 'list') && projects.length > 0 && (
        <>
          <label className="sr-only" htmlFor="proj">Active project</label>
          <select
            id="proj"
            value={activeProject ?? ''}
            onChange={(e) => onProject(e.target.value)}
            className="num max-w-[10rem] rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
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

function AppearanceMenu({
  appearance, onAppearance,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  /* The panel hangs off the right edge of its trigger, which is fine until the
     top bar wraps on a narrow screen and the trigger lands near the left — then
     right-aligning puts the whole panel off the left of the window. Measure and
     nudge it back in. A fixed-position fallback is not available here: the
     header's backdrop-blur makes it the containing block for fixed children. */
  useLayoutEffect(() => {
    const el = panel.current
    if (!open || !el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    const pad = 8
    let dx = 0
    if (r.right > innerWidth - pad) dx = innerWidth - pad - r.right
    if (r.left + dx < pad) dx = pad - r.left
    el.style.transform = dx ? `translateX(${Math.round(dx)}px)` : ''
  }, [open])

  /* A popover that outlives a click elsewhere, or Escape, is a trap. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => { removeEventListener('pointerdown', onDown); removeEventListener('keydown', onKey) }
  }, [open])

  const mode = resolveMode(appearance.mode)

  return (
    <div className="relative" ref={wrap}>
      <button
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
        <div
          ref={panel}
          role="dialog"
          aria-label="Appearance"
          className="absolute right-0 top-full z-50 mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-surface p-3 shadow-2xl"
        >
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
            <div className="grid gap-1" role="radiogroup" aria-label="Theme">
              {(Object.keys(THEMES) as ThemeId[]).map((id) => {
                const on = appearance.theme === id
                // Every card previews itself in the mode you are actually in,
                // so what you see on the card is what the page becomes.
                const [bg, surface, brand] = THEME_SWATCH[id][mode]
                return (
                  <button
                    key={id} type="button" role="radio" aria-checked={on}
                    onClick={() => onAppearance({ ...appearance, theme: id })}
                    className={`flex items-center gap-2.5 rounded-lg border p-1.5 text-left transition-colors
                      ${on ? 'border-brand bg-brand/10' : 'border-border hover:bg-surface-2'}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-11 shrink-0 flex-col justify-between overflow-hidden rounded-md p-1 ring-1 ring-black/20"
                      style={{ background: bg }}
                    >
                      <span className="block h-1.5 w-full rounded-[2px]" style={{ background: surface }} />
                      <span className="block h-1.5 w-2/3 rounded-[2px]" style={{ background: brand }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">{THEMES[id]}</span>
                      <span className="block truncate text-[0.62rem] text-muted">{THEME_NOTE[id]}</span>
                    </span>
                    {on && <Check size={14} className="shrink-0 text-brand" />}
                  </button>
                )
              })}
            </div>
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
      )}
    </div>
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


/* ==========================================================================
   LIST
   ========================================================================== */
function ListView({ ctx, onDeleteProject }: { ctx: Ctx; onDeleteProject: (id: string) => void }) {
  const p = ctx.projects.find((x) => x.id === ctx.activeProject)
  const s = I.stats(ctx.projectTasks)
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
        <button
          type="button"
          onClick={() => onDeleteProject(p.id)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
        >
          <Trash2 size={13} />Delete project
        </button>
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
              {items.slice(0, 3).map((t) => (
                <button key={t.id} type="button" onClick={() => ctx.setSelected(t.id)}
                  className={`mt-0.5 block w-full truncate border-l-2 pl-1 text-left text-[0.65rem] leading-tight
                    ${I.isOverdue(t) ? 'border-brand text-brand' : t.status === 'done' ? 'border-border text-muted line-through' : 'border-border'}`}>
                  {t.title}
                </button>
              ))}
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
