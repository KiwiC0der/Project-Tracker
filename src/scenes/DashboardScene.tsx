import { useEffect, useMemo, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  LayoutDashboard,
  ListTodo,
  Plus,
  LogOut,
  Trash2,
  Loader2,
  CheckCircle2,
  Clock,
  ListChecks,
  FolderKanban,
  Calendar,
  BarChart3,
  Settings,
  Lock,
} from 'lucide-react'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { ListProvider, ListGroup, ListHeader, ListItems, ListItem } from '@/components/ui/list'
import {
  listProjects,
  listTasks,
  createProject,
  createTask,
  updateTask,
  deleteTask,
  deleteProject,
  seedIfEmpty,
  signOut,
  usingRealBackend,
  type Project,
  type Task,
  type TaskStatus,
  type User,
} from '@/lib/store'

type View = 'overview' | 'list'

const COLUMNS: { id: TaskStatus; name: string; color: string }[] = [
  { id: 'todo', name: 'To do', color: '#6b7280' },
  { id: 'doing', name: 'In progress', color: '#f59e0b' },
  { id: 'done', name: 'Done', color: '#10b981' },
]

/** Scenes 4 + 5 + 6 — the authenticated app shell. */
export function DashboardScene({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <SidebarProvider>
      <DashboardInner user={user} onSignOut={onSignOut} />
    </SidebarProvider>
  )
}

function DashboardInner({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [view, setView] = useState<View>('overview')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedIfEmpty()
        const ps = await listProjects()
        const ts = await listTasks()
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
    return () => {
      cancelled = true
    }
  }, [])

  const projectTasks = useMemo(
    () => (activeProject ? tasks.filter((t) => t.project_id === activeProject) : []),
    [tasks, activeProject],
  )

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done').length
    const doing = tasks.filter((t) => t.status === 'doing').length
    const todo = tasks.filter((t) => t.status === 'todo').length
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
    return { done, doing, todo, total: tasks.length, pct, projects: projects.length }
  }, [tasks, projects])

  // ---- mutations ----------------------------------------------------------
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const target = over.id as TaskStatus
    if (!COLUMNS.some((c) => c.id === target)) return

    const task = tasks.find((t) => t.id === active.id)
    if (!task || task.status === target) return

    // Optimistic: the board snaps immediately, then reconciles with the server.
    const previous = tasks
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, status: target } : t)))
    try {
      await updateTask(task.id, { status: target })
    } catch (err) {
      setTasks(previous)
      setError(err instanceof Error ? err.message : 'Could not move that task.')
    }
  }

  async function addTask(status: TaskStatus) {
    if (!activeProject) return
    const title = window.prompt('Task title')?.trim()
    if (!title) return
    try {
      const t = await createTask(activeProject, title, status)
      setTasks((cur) => [...cur, t])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that task.')
    }
  }

  async function removeTask(id: string) {
    const previous = tasks
    setTasks((cur) => cur.filter((t) => t.id !== id))
    try {
      await deleteTask(id)
    } catch (err) {
      setTasks(previous)
      setError(err instanceof Error ? err.message : 'Could not delete that task.')
    }
  }

  async function addProject() {
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
  }

  async function removeProject(id: string) {
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
  }

  async function handleSignOut() {
    await signOut()
    onSignOut()
  }

  function go(v: View) {
    setView(v)
    // The sidebar is a persistent panel now, not a modal drawer — it stays
    // open across navigation until the trigger toggles it closed.
  }

  return (
    <div className="flex min-h-dvh w-full">
      {/* ---------------- Scene 5 — sidebar ---------------- */}
      <Sidebar>
        <SidebarHeader>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
            <FolderKanban size={15} />
          </div>
          <span className="text-sm font-semibold">Project Tracker</span>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton active={view === 'overview'} onClick={() => go('overview')}>
                  <LayoutDashboard size={16} />
                  Dashboard
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton active={view === 'list'} onClick={() => go('list')}>
                  <ListTodo size={16} />
                  List
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarMenu>
              {projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    active={activeProject === p.id && view === 'list'}
                    onClick={() => {
                      setActiveProject(p.id)
                      go('list')
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <span className="truncate">{p.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={addProject}>
                  <Plus size={16} />
                  New project
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Coming soon</SidebarGroupLabel>
            <SidebarMenu>
              {[
                { icon: <Calendar size={16} />, label: 'Calendar' },
                { icon: <BarChart3 size={16} />, label: 'Reports' },
                { icon: <Settings size={16} />, label: 'Settings' },
              ].map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    disabled
                    className="cursor-not-allowed opacity-45"
                    title="Not built yet"
                  >
                    {item.icon}
                    {item.label}
                    <Lock size={12} className="ml-auto" />
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
              <p className="truncate text-[0.7rem] text-muted">{user.email}</p>
            </div>
          </div>
          <SidebarMenuButton onClick={handleSignOut}>
            <LogOut size={16} />
            Sign out
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>

      {/* ---------------- main ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <SidebarTrigger />
          <h1 className="text-sm font-semibold">
            {view === 'overview' ? 'Dashboard' : 'List'}
          </h1>
          {!usingRealBackend && (
            <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[0.65rem] font-medium text-amber-200">
              Demo mode
            </span>
          )}
        </header>

        <main className="scene-enter flex-1 p-4 sm:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-auto text-xs underline"
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[50dvh] items-center justify-center text-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : view === 'overview' ? (
            <Overview stats={stats} user={user} onOpenList={() => setView('list')} />
          ) : (
            <Board
              projects={projects}
              activeProject={activeProject}
              onSelectProject={setActiveProject}
              tasks={projectTasks}
              onDragEnd={handleDragEnd}
              onAddTask={addTask}
              onRemoveTask={removeTask}
              onRemoveProject={removeProject}
              onAddProject={addProject}
            />
          )}
        </main>
      </div>
    </div>
  )
}

/* ==========================================================================
   Scene 4 — dashboard stat cards
   ========================================================================== */
function Overview({
  stats,
  user,
  onOpenList,
}: {
  stats: { done: number; doing: number; todo: number; total: number; pct: number; projects: number }
  user: User
  onOpenList: () => void
}) {
  const cards = [
    { label: 'Projects', value: stats.projects, icon: <FolderKanban size={16} />, tone: 'text-brand-soft' },
    { label: 'To do', value: stats.todo, icon: <ListChecks size={16} />, tone: 'text-muted' },
    { label: 'In progress', value: stats.doing, icon: <Clock size={16} />, tone: 'text-amber-400' },
    { label: 'Done', value: stats.done, icon: <CheckCircle2 size={16} />, tone: 'text-emerald-400' },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome back, {user.displayName}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {stats.total === 0
            ? 'No tasks yet — open the list to add your first one.'
            : `${stats.done} of ${stats.total} tasks complete.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border/80 hover:bg-surface-2"
          >
            <div className={`mb-3 flex items-center gap-2 ${c.tone}`}>
              {c.icon}
              <span className="text-xs font-medium text-muted">{c.label}</span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      {/* progress */}
      <div className="mt-4 rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Overall progress</h3>
          <span className="text-2xl font-semibold tabular-nums text-brand-soft">{stats.pct}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-background"
          role="progressbar"
          aria-valuenow={stats.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall task completion"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onOpenList}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-soft"
        >
          <ListTodo size={15} />
          Open the list
        </button>
      </div>
    </div>
  )
}

/* ==========================================================================
   Scene 6 — draggable task board
   ========================================================================== */
function Board({
  projects,
  activeProject,
  onSelectProject,
  tasks,
  onDragEnd,
  onAddTask,
  onRemoveTask,
  onRemoveProject,
  onAddProject,
}: {
  projects: Project[]
  activeProject: string | null
  onSelectProject: (id: string) => void
  tasks: Task[]
  onDragEnd: (e: DragEndEvent) => void
  onAddTask: (status: TaskStatus) => void
  onRemoveTask: (id: string) => void
  onRemoveProject: (id: string) => void
  onAddProject: () => void
}) {
  if (!activeProject) {
    return (
      <div className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center text-center">
        <FolderKanban size={28} className="mb-3 text-muted" />
        <h2 className="text-lg font-semibold">No projects yet</h2>
        <p className="mt-1 text-sm text-muted">Create one to start tracking tasks.</p>
        <button
          type="button"
          onClick={onAddProject}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          <Plus size={15} />
          New project
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* project switcher */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectProject(p.id)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              activeProject === p.id
                ? 'border-brand bg-brand/15 text-foreground'
                : 'border-border text-muted hover:text-foreground'
            }`}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onRemoveProject(activeProject)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-red-500/40 hover:text-red-300"
        >
          <Trash2 size={13} />
          Delete project
        </button>
      </div>

      <ListProvider onDragEnd={onDragEnd}>
        {COLUMNS.map((col) => {
          const items = tasks
            .filter((t) => t.status === col.id)
            .sort((a, b) => a.position - b.position)

          return (
            <ListGroup key={col.id} id={col.id} className="lg:max-h-[calc(100dvh-14rem)]">
              <ListHeader name={col.name} color={col.color} count={items.length} />
              <ListItems>
                {items.map((task, i) => (
                  <ListItem key={task.id} id={task.id} parent={col.id} index={i}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
                              task.priority === 'high'
                                ? 'bg-red-500/15 text-red-300'
                                : task.priority === 'medium'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-surface-2 text-muted'
                            }`}
                          >
                            {task.priority}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        // Stop dnd-kit's pointer sensor from swallowing the click.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onRemoveTask(task.id)}
                        aria-label={`Delete task: ${task.title}`}
                        className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </ListItem>
                ))}

                <button
                  type="button"
                  onClick={() => onAddTask(col.id)}
                  className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted transition-colors hover:border-brand/50 hover:text-foreground"
                >
                  <Plus size={13} />
                  Add task
                </button>
              </ListItems>
            </ListGroup>
          )
        })}
      </ListProvider>
    </div>
  )
}
