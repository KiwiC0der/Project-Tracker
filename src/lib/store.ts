import { supabase, isSupabaseConfigured } from './supabase'
import { ORDER_STEP } from './order'

// ============================================================================
// Types — mirror supabase/schema.sql
// ============================================================================
export type TaskStatus = 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export interface User {
  id: string
  email: string
  displayName: string
}

export interface Project {
  id: string
  name: string
  description: string
  color: string
  status: 'active' | 'paused' | 'done' | 'archived'
  position: number
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  notes: string
  status: TaskStatus
  priority: Priority
  position: number
  due_date: string | null
  created_at: string
  /** Maintained by the `tasks_touch` trigger. Staleness and velocity read it. */
  updated_at?: string
}

export interface AuthResult {
  user: User | null
  error: string | null
  /** Supabase can require email confirmation before a session exists. */
  needsConfirmation?: boolean
}

// ============================================================================
// Demo backend — used only when Supabase env vars are absent.
// ----------------------------------------------------------------------------
// Without this, the published page would be a dead login screen for anyone
// who visits before credentials are configured. Data lives in localStorage,
// is per-device, and is NOT secure — it exists so the UI is explorable.
// ============================================================================
const DEMO_KEY = 'project-tracker-demo'

interface DemoDb {
  users: Record<string, { id: string; email: string; password: string; displayName: string }>
  session: string | null
  projects: Project[]
  tasks: Task[]
}

function loadDemo(): DemoDb {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* corrupt or unavailable storage — fall through to a fresh db */
  }
  return { users: {}, session: null, projects: [], tasks: [] }
}

function saveDemo(db: DemoDb) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  } catch {
    /* private mode / quota — the session simply won't persist */
  }
}

const uid = () =>
  (crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

function starterContent(): { project: Project; tasks: Task[] } {
  const pid = uid()
  const now = new Date().toISOString()
  return {
    project: {
      id: pid,
      name: 'Getting Started',
      description: 'A sample project — rename it or delete it.',
      color: 'violet',
      status: 'active',
      position: 0,
      created_at: now,
    },
    tasks: [
      ['Drag a task between columns', 'todo', 'medium', 0],
      ['Create your own project', 'todo', 'high', 1],
      ['Click a task to edit it', 'doing', 'medium', 0],
      ['Sign in and out to test auth', 'done', 'low', 0],
    ].map(([title, status, priority, position]) => ({
      id: uid(),
      project_id: pid,
      title: title as string,
      notes: '',
      status: status as TaskStatus,
      priority: priority as Priority,
      position: position as number,
      due_date: null,
      created_at: now,
    })),
  }
}

// ============================================================================
// Public API — identical surface whichever backend is active
// ============================================================================
export const usingRealBackend = isSupabaseConfigured

// ---------- auth ----------
export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    if (error) return { user: null, error: error.message }
    if (!data.session) {
      return { user: null, error: null, needsConfirmation: true }
    }
    return { user: toUser(data.user), error: null }
  }

  const db = loadDemo()
  const key = email.toLowerCase()
  if (db.users[key]) return { user: null, error: 'An account with that email already exists.' }
  const id = uid()
  db.users[key] = { id, email, password, displayName }
  db.session = key
  const seed = starterContent()
  db.projects.push(seed.project)
  db.tasks.push(...seed.tasks)
  saveDemo(db)
  return { user: { id, email, displayName }, error: null }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { user: null, error: error.message }
    return { user: toUser(data.user), error: null }
  }

  const db = loadDemo()
  const rec = db.users[email.toLowerCase()]
  if (!rec || rec.password !== password) {
    return { user: null, error: 'Incorrect email or password.' }
  }
  db.session = email.toLowerCase()
  saveDemo(db)
  return { user: { id: rec.id, email: rec.email, displayName: rec.displayName }, error: null }
}

export async function signOut(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut()
    return
  }
  const db = loadDemo()
  db.session = null
  saveDemo(db)
}

export async function getCurrentUser(): Promise<User | null> {
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    return data.session ? toUser(data.session.user) : null
  }
  const db = loadDemo()
  if (!db.session) return null
  const rec = db.users[db.session]
  return rec ? { id: rec.id, email: rec.email, displayName: rec.displayName } : null
}

function toUser(u: any): User {
  return {
    id: u.id,
    email: u.email ?? '',
    displayName:
      u.user_metadata?.display_name || (u.email ? String(u.email).split('@')[0] : 'there'),
  }
}

// ---------- projects ----------
export async function listProjects(): Promise<Project[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('position', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as Project[]
  }
  return loadDemo().projects.slice().sort((a, b) => a.position - b.position)
}

export async function createProject(name: string, description = '', color = 'violet') {
  if (supabase) {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Not signed in.')
    const existing = await listProjects()
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, description, color, owner_id: auth.user.id, position: existing.length })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as Project
  }

  const db = loadDemo()
  const p: Project = {
    id: uid(),
    name,
    description,
    color,
    status: 'active',
    position: db.projects.length,
    created_at: new Date().toISOString(),
  }
  db.projects.push(p)
  saveDemo(db)
  return p
}

export async function updateProject(id: string, patch: Partial<Project>) {
  if (supabase) {
    const { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const db = loadDemo()
  const i = db.projects.findIndex((p) => p.id === id)
  if (i >= 0) db.projects[i] = { ...db.projects[i], ...patch }
  saveDemo(db)
}

export async function deleteProject(id: string) {
  if (supabase) {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const db = loadDemo()
  db.projects = db.projects.filter((p) => p.id !== id)
  db.tasks = db.tasks.filter((t) => t.project_id !== id)
  saveDemo(db)
}

// ---------- tasks ----------
export async function listTasks(projectId?: string): Promise<Task[]> {
  if (supabase) {
    let q = supabase.from('tasks').select('*').order('position', { ascending: true })
    if (projectId) q = q.eq('project_id', projectId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as Task[]
  }
  const all = loadDemo().tasks
  const rows = projectId ? all.filter((t) => t.project_id === projectId) : all
  return rows.slice().sort((a, b) => a.position - b.position)
}

export async function createTask(
  projectId: string,
  title: string,
  status: TaskStatus = 'todo',
  priority: Priority = 'medium',
) {
  // Append after the last sibling on the SPARSE scale. Counting siblings would
  // hand a new task position 3 in a column that has already been reordered to
  // 1024, 2048, 3072 — and it would silently appear at the top.
  const after = (siblings: Task[]) =>
    siblings.length ? Math.max(...siblings.map((s) => s.position)) + ORDER_STEP : 0

  if (supabase) {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Not signed in.')
    const siblings = (await listTasks(projectId)).filter((t) => t.status === status)
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        owner_id: auth.user.id,
        title,
        status,
        priority,
        position: after(siblings),
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as Task
  }

  const db = loadDemo()
  const siblings = db.tasks.filter((t) => t.project_id === projectId && t.status === status)
  const now = new Date().toISOString()
  const t: Task = {
    id: uid(),
    project_id: projectId,
    title,
    notes: '',
    status,
    priority,
    position: after(siblings),
    due_date: null,
    created_at: now,
    updated_at: now,
  }
  db.tasks.push(t)
  saveDemo(db)
  return t
}

export async function updateTask(id: string, patch: Partial<Task>) {
  if (supabase) {
    const { error } = await supabase.from('tasks').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const db = loadDemo()
  const i = db.tasks.findIndex((t) => t.id === id)
  // Mirrors the `tasks_touch` trigger the real backend runs.
  if (i >= 0) db.tasks[i] = { ...db.tasks[i], ...patch, updated_at: new Date().toISOString() }
  saveDemo(db)
}

/**
 * Commit a reorder: the moved row, plus any rows that had to shift.
 *
 * Deliberately several small UPDATEs rather than one `upsert`. An upsert would
 * be a single round trip, but it has to send every NOT NULL column — title and
 * notes included — so a reorder would rewrite fields the user never touched and
 * could clobber an edit made in another tab. Positions are the only thing
 * moving here, so positions are the only thing sent.
 *
 * `renumber` is empty on the common path; see planMove in lib/order.
 */
export async function applyOrder(
  moved: { id: string; status: TaskStatus; position: number },
  renumber: { id: string; position: number }[] = [],
) {
  if (supabase) {
    const sb = supabase          // the narrowing does not survive into the map
    const writes = [
      sb.from('tasks').update({ status: moved.status, position: moved.position }).eq('id', moved.id),
      ...renumber.map((r) => sb.from('tasks').update({ position: r.position }).eq('id', r.id)),
    ]
    const results = await Promise.all(writes)
    const failed = results.find((r) => r.error)
    if (failed?.error) throw new Error(failed.error.message)
    return
  }

  const db = loadDemo()
  const put = (id: string, patch: Partial<Task>) => {
    const i = db.tasks.findIndex((t) => t.id === id)
    if (i >= 0) db.tasks[i] = { ...db.tasks[i], ...patch, updated_at: new Date().toISOString() }
  }
  put(moved.id, { status: moved.status, position: moved.position })
  // Shifted rows keep their updated_at: nobody touched them, and staleness and
  // completion dates both read that column.
  for (const r of renumber) {
    const i = db.tasks.findIndex((t) => t.id === r.id)
    if (i >= 0) db.tasks[i] = { ...db.tasks[i], position: r.position }
  }
  saveDemo(db)
}

export async function deleteTask(id: string) {
  if (supabase) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  const db = loadDemo()
  db.tasks = db.tasks.filter((t) => t.id !== id)
  saveDemo(db)
}

/** Give brand-new accounts something to look at instead of an empty board. */
export async function seedIfEmpty() {
  const projects = await listProjects()
  if (projects.length > 0) return

  if (supabase) {
    const { error } = await supabase.rpc('seed_starter_project')
    // Not fatal — a new account simply starts empty if the function is missing.
    if (error) console.warn('[store] seed skipped:', error.message)
    return
  }

  const db = loadDemo()
  const seed = starterContent()
  db.projects.push(seed.project)
  db.tasks.push(...seed.tasks)
  saveDemo(db)
}
