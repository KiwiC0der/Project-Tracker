import { supabase, isSupabaseConfigured } from './supabase'
import { ORDER_STEP } from './order'

// ============================================================================
// Types — mirror supabase/schema.sql
// ============================================================================
export type TaskStatus = 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export interface User {
  id: string
  /** As the user typed it at sign-up — original casing preserved. Display this. */
  username: string
  /**
   * A REAL, deliverable address the user gave us. Empty until the planned
   * recovery-email feature lands, because username sign-up never asks for one.
   * The synthesized `@AUTH_EMAIL_DOMAIN` handle is deliberately NOT stored here:
   * it is an internal Supabase identity string, not mail the user can receive.
   */
  email: string
  displayName: string
}

// ============================================================================
// Username identity — the mapping onto Supabase Auth
// ----------------------------------------------------------------------------
// Supabase Auth has exactly two identity types: email and phone. There is no
// username type. So "sign in with a username" has to be a mapping we own:
// every username is deterministically turned into an address at a domain that
// has no MX record and can never receive mail, mirroring GitHub's
// `users.noreply.github.com` convention.
//
//   ada  ->  ada@users.noreply.pt.anteneh.tech
//
// A future reader must not mistake this for something the user typed. It is
// never shown in the UI (see User.email above and DashboardScene's footer).
//
// WHAT THIS BUYS US: uniqueness is enforced for real — by Postgres' unique
// constraint on auth.users.email — so two people cannot claim one username.
//
// WHAT IT DOES NOT BUY US: there is no address on file, so PASSWORD RESET IS
// IMPOSSIBLE. A forgotten password means a lost account until the recovery
// email feature ships. The sign-up form says so; do not remove that note
// before the feature exists.
// ============================================================================
export const AUTH_EMAIL_DOMAIN = 'users.noreply.pt.anteneh.tech'

/** The one rule, stated once, shown verbatim to the user on failure. */
export const USERNAME_RULE =
  'Usernames are 3–30 characters, letters, digits, underscores or hyphens, and must start with a letter or digit.'

// Anchored so it also guarantees a valid email localpart: no dots, no spaces,
// no leading punctuation, nothing that would need quoting.
//
// The trailing lookahead is not decoration: in JS, `$` also matches BEFORE a
// final newline, so the pattern without it accepts a username with a trailing
// newline. validateUsername trims first, so that is unreachable today — but a
// future caller that forgets to trim must not be able to smuggle a control
// character into an email localpart.
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$(?![\r\n])/i

/** Lowercased identity key. The mapping is case-insensitive; display is not. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

/** @returns an error string naming the rule, or null when the username is fine. */
export function validateUsername(username: string): string | null {
  const raw = username.trim()
  if (!raw) return 'Username is required.'
  if (!USERNAME_RE.test(raw)) return USERNAME_RULE
  return null
}

/** The single place a username becomes a Supabase identity. */
export function usernameToAuthEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`
}

/**
 * Supabase phrases its auth errors in terms of the email it thinks it has.
 * Someone who typed a username must never be told about an address they never
 * saw, so translate before the message reaches the screen.
 */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Incorrect username or password.'
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'That username is already taken.'
  }
  return message
    .replace(new RegExp(`\\S*@${AUTH_EMAIL_DOMAIN}`, 'gi'), 'that username')
    .replace(/email address/gi, 'username')
    .replace(/email/gi, 'username')
}

/** Mirrors the `projects.status` CHECK constraint in supabase/schema.sql. */
export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived'

export interface Project {
  id: string
  name: string
  description: string
  color: string
  status: ProjectStatus
  position: number
  created_at: string
  /** The date the owner says this should be done by. The insights layer already
      PREDICTS a landing date from measured velocity; a prediction is only
      actionable next to an intention, and without this there is nothing to be
      late against. Null means "no target", which is not the same as "today". */
  target_date?: string | null
  /** Hours a week the owner intends to give this project. forecast() has no
      answer at all for a project with nothing finished yet — zero velocity
      returns Infinity — while stats() already knows how many hours of work are
      outstanding. This is the missing divisor that yields a date on day one.
      Null means "not budgeted", which is not a claim of zero. */
  weekly_hours?: number | null
}

/* ----------------------------------------------------------------------------
   PLANNING COLUMNS — target_date and weekly_hours — were added after the app
   had already been deployed against a live Supabase project, and `schema.sql`
   is applied BY HAND from the dashboard. So there is a real window in which the
   code knows about a column the database does not.
   PostgREST does not ignore an unknown column; it rejects the whole statement
   with PGRST204, which would take project editing down entirely rather than
   degrading. Everything below exists to survive that window: the write is
   retried without these fields, and the user is told once, in a sentence that
   names the fix, instead of being handed a schema-cache error.
   -------------------------------------------------------------------------- */
const PLANNING_COLUMNS = ['target_date', 'weekly_hours'] as const

/** Raised by the retry path so the caller can surface it and carry on. */
export const MIGRATION_PENDING =
  'Saved, but the target date and weekly hours were not — your database is ' +
  'missing those columns. Run supabase/schema.sql in the Supabase SQL editor.'

/**
 * Turn a thrown error into something worth putting in front of a person.
 *
 * Every `throw` below rethrows PostgREST's own message verbatim, and those are
 * written for whoever wrote the schema, not for whoever is using the app. The
 * banner in DashboardScene was showing them unedited, so a denied write read
 * `new row violates row-level security policy for table "tasks"` — which tells
 * the user nothing they can act on, and tells anyone reading over their
 * shoulder the table and policy names.
 *
 * The default is therefore the CALLER'S fallback, not the raw text: unmatched
 * messages are dropped rather than shown. That direction is deliberate. A
 * pass-through default fails open every time a backend phrases something in a
 * way nobody here anticipated, and the raw string is still in the console and
 * still in the copied error detail — the two places a maintainer actually
 * looks. Only the two failures a user can genuinely do something about get
 * their own wording, and `SAFE_MESSAGES` holds the ones this file authored.
 */
export function humanError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : ''
  if (!raw) return fallback
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
    return 'No connection to the server, so that change was not saved.'
  }
  if (/row-level security|permission denied|not authori[sz]ed|JWT|token is expired/i.test(raw)) {
    return 'Your session has expired, or that is not yours to change. Sign out and back in.'
  }
  return SAFE_MESSAGES.has(raw) ? raw : fallback
}

/** Messages thrown by this module rather than relayed from the backend. */
const SAFE_MESSAGES = new Set(['Not signed in.'])

/** True for the specific failure "this column is not in the schema cache". */
function isMissingPlanningColumn(err: { code?: string; message?: string } | null) {
  if (!err) return false
  if (err.code === 'PGRST204') return true
  // Older PostgREST builds report the same condition as a plain 42703 with the
  // column named in the message, so the code alone is not a reliable test.
  return PLANNING_COLUMNS.some((c) => err.message?.includes(c)) &&
    /schema cache|does not exist|could not find/i.test(err.message ?? '')
}

const withoutPlanning = <T extends Record<string, unknown>>(patch: T) => {
  const rest = { ...patch }
  for (const c of PLANNING_COLUMNS) delete rest[c]
  return rest
}

/* A latch rather than a return value. Both createProject and updateProject can
   hit the retry path, and threading a second channel through both of their
   signatures would make every existing call site read as if it handled an error
   it does not. The scene takes the warning after a write and shows it once. */
let pendingWarning: string | null = null

/** Read and clear. Returns null when the last write needed no retry. */
export function takeMigrationWarning(): string | null {
  const w = pendingWarning
  pendingWarning = null
  return w
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

interface DemoUser {
  id: string
  /** Original casing. The record is KEYED by the lowercased form. */
  username: string
  password: string
  displayName: string
}

interface DemoDb {
  users: Record<string, DemoUser>
  session: string | null
  projects: Project[]
  tasks: Task[]
}

const emptyDemo = (): DemoDb => ({ users: {}, session: null, projects: [], tasks: [] })

/**
 * Blobs written before usernames existed were keyed by email and have no
 * `username` field. Rather than trusting whatever shape is in storage, coerce
 * it: a stale or hand-edited blob must degrade to "no session", never throw on
 * first paint.
 */
function sanitizeDemo(raw: unknown): DemoDb {
  if (!raw || typeof raw !== 'object') return emptyDemo()
  const src = raw as Partial<DemoDb>
  const db = emptyDemo()

  if (src.users && typeof src.users === 'object' && !Array.isArray(src.users)) {
    for (const [key, rec] of Object.entries(src.users as Record<string, unknown>)) {
      const u = rec as Partial<DemoUser> | null
      // Legacy email-keyed rows have no username and cannot be resolved; they
      // are dropped from the working copy so nothing downstream reads undefined.
      if (!u || typeof u.id !== 'string' || typeof u.username !== 'string') continue
      db.users[key] = {
        id: u.id,
        username: u.username,
        password: typeof u.password === 'string' ? u.password : '',
        displayName: typeof u.displayName === 'string' ? u.displayName : u.username,
      }
    }
  }

  db.session =
    typeof src.session === 'string' && src.session in db.users ? src.session : null
  db.projects = Array.isArray(src.projects) ? (src.projects as Project[]) : []
  db.tasks = Array.isArray(src.tasks) ? (src.tasks as Task[]) : []
  return db
}

function loadDemo(): DemoDb {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    if (raw) return sanitizeDemo(JSON.parse(raw))
  } catch {
    /* corrupt or unavailable storage — fall through to a fresh db */
  }
  return emptyDemo()
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
  username: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  const invalid = validateUsername(username)
  if (invalid) return { user: null, error: invalid }

  const typed = username.trim()
  const key = normalizeUsername(typed)

  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      // Synthesized — see AUTH_EMAIL_DOMAIN. The user never typed this.
      email: usernameToAuthEmail(typed),
      password,
      options: { data: { display_name: displayName, username: typed } },
    })
    if (error) return { user: null, error: friendlyAuthError(error.message) }
    if (!data.session) {
      return { user: null, error: null, needsConfirmation: true }
    }
    return { user: toUser(data.user), error: null }
  }

  const db = loadDemo()
  if (db.users[key]) return { user: null, error: 'That username is already taken.' }
  const id = uid()
  db.users[key] = { id, username: typed, password, displayName }
  db.session = key
  const seed = starterContent()
  db.projects.push(seed.project)
  db.tasks.push(...seed.tasks)
  saveDemo(db)
  return { user: { id, username: typed, email: '', displayName }, error: null }
}

export async function signIn(username: string, password: string): Promise<AuthResult> {
  const invalid = validateUsername(username)
  if (invalid) return { user: null, error: invalid }

  const key = normalizeUsername(username)

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToAuthEmail(key),
      password,
    })
    if (error) return { user: null, error: friendlyAuthError(error.message) }
    return { user: toUser(data.user), error: null }
  }

  const db = loadDemo()
  const rec = db.users[key]
  if (!rec || rec.password !== password) {
    return { user: null, error: 'Incorrect username or password.' }
  }
  db.session = key
  saveDemo(db)
  return {
    user: { id: rec.id, username: rec.username, email: '', displayName: rec.displayName },
    error: null,
  }
}

/**
 * Per-device state that belongs to whoever was signed in, not to the browser.
 *
 * Cleared on sign-out because this app can plausibly run on a shared machine:
 * the board arrangement and the sidebar shape are that person's working setup,
 * and NOTES ARE THEIR CONTENT — they have no table, so a note only ever exists
 * here (see NotesPanel). Leaving it behind means the next person at the same
 * browser can recover it from storage.
 *
 * Appearance is deliberately NOT cleared: a theme describes the screen, not the
 * account, and resetting someone's dark mode when a colleague signs out would
 * be a bug rather than a courtesy.
 */
function clearDeviceState() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === 'project-tracker-board' ||
          k === 'project-tracker-sidebar' ||
          k.startsWith('project-tracker-notes:')) {
        localStorage.removeItem(k)
      }
    }
  } catch {
    /* private mode or a locked store — nothing to clear, and failing to clear
       must never block the sign-out itself */
  }
}

export async function signOut(): Promise<void> {
  clearDeviceState()
  if (supabase) {
    /* Offline, this rejects. The device state above is already gone by then,
       so a rejection propagating out would leave the caller's `onSignOut()`
       unreached: the board stays on screen, signed in to a session that has
       been half torn down, with nothing said. The local sign-out is the part
       that matters and it has already happened. */
    try {
      await supabase.auth.signOut()
    } catch {
      /* nothing to do — the session is cleared locally either way */
    }
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
  // sanitizeDemo already dropped unresolvable rows; this is the last guard so a
  // stale blob shows the login screen instead of throwing.
  if (!rec) return null
  return { id: rec.id, username: rec.username, email: '', displayName: rec.displayName }
}

function toUser(u: any): User {
  const authEmail = typeof u?.email === 'string' ? u.email : ''
  const localpart = authEmail.includes('@') ? authEmail.slice(0, authEmail.lastIndexOf('@')) : ''
  // True for every username account. Only a real address — which today can only
  // come from a legacy email-era account — survives into User.email.
  const synthesized = authEmail.toLowerCase().endsWith(`@${AUTH_EMAIL_DOMAIN}`)

  const username =
    (typeof u?.user_metadata?.username === 'string' && u.user_metadata.username.trim()) ||
    localpart ||
    'there'

  return {
    id: u.id,
    username,
    email: synthesized ? '' : authEmail,
    displayName: u?.user_metadata?.display_name || username,
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

export interface ProjectPlanning {
  target_date?: string | null
  weekly_hours?: number | null
}

export async function createProject(
  name: string,
  description = '',
  color = 'violet',
  status: ProjectStatus = 'active',
  planning: ProjectPlanning = {},
) {
  if (supabase) {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Not signed in.')
    const existing = await listProjects()
    const row = {
      name, description, color, status,
      owner_id: auth.user.id,
      position: existing.length,
      target_date: planning.target_date ?? null,
      weekly_hours: planning.weekly_hours ?? null,
    }
    let { data, error } = await supabase.from('projects').insert(row).select().single()
    if (isMissingPlanningColumn(error)) {
      pendingWarning = MIGRATION_PENDING
      ;({ data, error } = await supabase
        .from('projects').insert(withoutPlanning(row)).select().single())
    }
    if (error) throw new Error(error.message)
    return data as Project
  }

  const db = loadDemo()
  const p: Project = {
    id: uid(),
    name,
    description,
    color,
    status,
    position: db.projects.length,
    created_at: new Date().toISOString(),
    target_date: planning.target_date ?? null,
    weekly_hours: planning.weekly_hours ?? null,
  }
  db.projects.push(p)
  saveDemo(db)
  return p
}

export async function updateProject(id: string, patch: Partial<Project>) {
  if (supabase) {
    let { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (isMissingPlanningColumn(error)) {
      pendingWarning = MIGRATION_PENDING
      const rest = withoutPlanning(patch as Record<string, unknown>)
      // A patch that was ONLY planning fields has nothing left to send, and an
      // empty PostgREST update is itself an error — so the retry is skipped
      // rather than swapped for a different failure.
      error = Object.keys(rest).length
        ? (await supabase.from('projects').update(rest).eq('id', id)).error
        : null
    }
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
