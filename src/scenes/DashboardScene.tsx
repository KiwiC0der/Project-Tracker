import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard, ListTodo, Plus, LogOut, Trash2, Loader2,
  FolderKanban, Calendar as CalIcon, BarChart3, Settings as GearIcon,
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  listProjects, listTasks, createProject, createTask, updateTask, deleteTask,
  deleteProject, seedIfEmpty, signOut, usingRealBackend,
  type Project, type Task, type TaskStatus, type User,
} from '@/lib/store'
import * as I from '@/lib/insights'
import {
  THEMES, FONTS, DENSITIES, THEME_SWATCH, loadAppearance, applyAppearance,
  type Appearance, type ThemeId, type FontId, type DensityId,
} from '@/lib/prefs'
import { Workboard, PANELS, type PanelId } from '@/components/board/Workboard'
import { BoardColumns, QuickAdd, Burndown, type Ctx } from '@/components/board/shared'

type View = 'dashboard' | 'list' | 'calendar' | 'reports' | 'settings'

const VIEWS: Record<View, { title: string; icon: JSX.Element }> = {
  dashboard: { title: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  list: { title: 'List', icon: <ListTodo size={16} /> },
  calendar: { title: 'Calendar', icon: <CalIcon size={16} /> },
  reports: { title: 'Reports', icon: <BarChart3 size={16} /> },
  settings: { title: 'Settings', icon: <GearIcon size={16} /> },
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance())

  useEffect(() => { applyAppearance(appearance) }, [appearance])

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

  const move = useCallback((id: string, status: TaskStatus) => patch(id, { status }), [patch])

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
        const due = new Date(p.due).toISOString().slice(0, 10)
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

  const addProject = useCallback(async () => {
    const name = window.prompt('Project name')?.trim()
    if (!name) return
    try {
      const p = await createProject(name)
      setProjects((cur) => [...cur, p])
      setActiveProject(p.id)
      setView('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that project.')
    }
  }, [])

  const removeProject = useCallback(async (id: string) => {
    if (!window.confirm('Delete this project and all of its tasks?')) return
    try {
      await deleteProject(id)
      const rest = projects.filter((p) => p.id !== id)
      setProjects(rest)
      setTasks((cur) => cur.filter((t) => t.project_id !== id))
      if (activeProject === id) setActiveProject(rest[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that project.')
    }
  }, [projects, activeProject])

  const ctx = {
    projects, tasks, projectTasks, activeProject, selected,
    setSelected, patch, move, remove, add, user,
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
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {(['dashboard', 'list'] as View[]).map((v) => (
                <SidebarMenuItem key={v}>
                  <SidebarMenuButton active={view === v} onClick={() => setView(v)}>
                    {VIEWS[v].icon}{VIEWS[v].title}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarMenu>
              {projects.map((p) => {
                const s = I.stats(tasks.filter((t) => t.project_id === p.id))
                return (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      active={activeProject === p.id && view === 'list'}
                      onClick={() => { setActiveProject(p.id); setView('list') }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                      <span className="truncate">{p.name}</span>
                      <span className="num ml-auto text-[0.7rem] text-muted">
                        {s.total - s.done}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={addProject}>
                  <Plus size={16} />New project
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>More</SidebarGroupLabel>
            <SidebarMenu>
              {(['calendar', 'reports', 'settings'] as View[]).map((v) => (
                <SidebarMenuItem key={v}>
                  <SidebarMenuButton active={view === v} onClick={() => setView(v)}>
                    {VIEWS[v].icon}{VIEWS[v].title}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold uppercase">
              {user.displayName.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user.displayName}</p>
              <p className="num truncate text-[0.7rem] text-muted">{user.email}</p>
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
              {view === 'list' && <ListView ctx={ctx} onRemoveProject={removeProject} />}
              {view === 'calendar' && <CalendarView ctx={ctx} />}
              {view === 'reports' && <ReportsView ctx={ctx} />}
              {view === 'settings' && (
                <SettingsView appearance={appearance} onAppearance={setAppearance} ctx={ctx} />
              )}
            </div>
          )}
        </main>
      </div>
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

      <ThemePicker appearance={appearance} onAppearance={onAppearance} />

      {!usingRealBackend && (
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[0.6rem] font-medium">
          Demo
        </span>
      )}
    </header>
  )
}

function ThemePicker({
  appearance, onAppearance,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  return (
    <div className="flex items-center gap-2">
      <fieldset className="flex items-center rounded-md border border-border p-0.5" aria-label="Theme">
        {(Object.keys(THEMES) as ThemeId[]).map((id) => {
          const [bg, accent] = THEME_SWATCH[id]
          const on = appearance.theme === id
          return (
            <label
              key={id}
              title={THEMES[id]}
              className={`relative cursor-pointer rounded p-1 transition-colors ${on ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
            >
              <input
                type="radio" name="theme" value={id} checked={on}
                aria-label={`${THEMES[id]} theme`}
                onChange={() => onAppearance({ ...appearance, theme: id })}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="block h-3.5 w-3.5 rounded-[3px] ring-1 ring-black/30"
                style={{ background: `linear-gradient(135deg, ${bg} 0 52%, ${accent} 52% 100%)` }}
              />
            </label>
          )
        })}
      </fieldset>

      <label className="sr-only" htmlFor="font">Font</label>
      <select
        id="font"
        value={appearance.font}
        onChange={(e) => onAppearance({ ...appearance, font: e.target.value as FontId })}
        className="num rounded-md border border-border bg-surface px-2 py-1 text-xs"
      >
        {(Object.keys(FONTS) as FontId[]).map((f) => (
          <option key={f} value={f}>{FONTS[f]}</option>
        ))}
      </select>
    </div>
  )
}


/* ==========================================================================
   LIST
   ========================================================================== */
function ListView({ ctx, onRemoveProject }: { ctx: Ctx; onRemoveProject: (id: string) => void }) {
  const p = ctx.projects.find((x) => x.id === ctx.activeProject)
  const s = I.stats(ctx.projectTasks)
  if (!p) {
    return <p className="text-sm text-muted">No projects yet — create one from the sidebar.</p>
  }
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-border pb-3">
        <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
        <p className="num text-xs text-muted">
          {s.done} of {s.total} done · {s.todo} to do · {s.doing} in progress
          {s.overdue > 0 && <> · <b className="text-brand">{s.overdue} overdue</b></>}
        </p>
        <button
          type="button"
          onClick={() => onRemoveProject(p.id)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
        >
          <Trash2 size={13} />Delete project
        </button>
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
   SETTINGS
   ========================================================================== */
function SettingsView({
  appearance, onAppearance, ctx,
}: { appearance: Appearance; onAppearance: (a: Appearance) => void; ctx: Ctx }) {
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
        <Row label="Theme" hint="Colour only — layout and spacing do not change">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <Chip key={id} on={appearance.theme === id} onClick={() => onAppearance({ ...appearance, theme: id })}>
              <span className="mr-1.5 inline-block h-2.5 w-2.5 translate-y-[1px] rounded-[2px]"
                style={{ background: `linear-gradient(135deg, ${THEME_SWATCH[id][0]} 0 52%, ${THEME_SWATCH[id][1]} 52% 100%)` }} />
              {THEMES[id]}
            </Chip>
          ))}
        </Row>
        <Row label="Font" hint="System faces only — nothing is fetched over the network">
          {(Object.keys(FONTS) as FontId[]).map((id) => (
            <Chip key={id} on={appearance.font === id} onClick={() => onAppearance({ ...appearance, font: id })}>
              {FONTS[id]}
            </Chip>
          ))}
        </Row>
        <Row label="Density" hint="Tighter rows on the board">
          {(Object.keys(DENSITIES) as DensityId[]).map((id) => (
            <Chip key={id} on={appearance.density === id} onClick={() => onAppearance({ ...appearance, density: id })}>
              {DENSITIES[id]}
            </Chip>
          ))}
        </Row>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h3 className="ui-face mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Account</h3>
        <Row label={ctx.user.displayName} hint={ctx.user.email}>
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
