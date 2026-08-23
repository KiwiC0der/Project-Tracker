/* ============================================================================
   INSIGHTS — the arithmetic the dashboard was never doing.

   Every function here is pure and reads only what `tasks` already stores:
   created_at, updated_at, due_date, status, priority. Nothing new is written
   to the database to make these work.

   Ported from the prototype kernel with two substitutions, because the real
   schema has no touch/completion columns of its own:

     touchedAt  ->  updated_at   (the `tasks_touch` trigger maintains it)
     doneAt     ->  updated_at, but only for rows currently `done`

   That makes `doneAt` an approximation: reopening a task and closing it again
   moves the date. It is the honest best reading of the columns that exist, and
   it is right for the overwhelmingly common case.
   ========================================================================== */
import type { Project, Task, TaskStatus } from './store'

export const DAY = 86_400_000

const PRIORITY_WEIGHT: Record<string, number> = { high: 1, medium: 0.55, low: 0.25 }

/** Hours. There is no estimate column yet, so every task counts as one slot. */
export const DEFAULT_ESTIMATE = 2

export function estimateOf(t: Task): number {
  const v = (t as Task & { estimate?: number }).estimate
  return typeof v === 'number' && v > 0 ? v : DEFAULT_ESTIMATE
}

const ms = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() : 0

export const touchedAt = (t: Task): number => ms(t.updated_at) || ms(t.created_at)
export const doneAt = (t: Task): number | null =>
  t.status === 'done' ? touchedAt(t) : null
export const dueAt = (t: Task): number | null =>
  t.due_date ? new Date(`${t.due_date}T17:00:00`).getTime() : null

export const isOverdue = (t: Task): boolean => {
  const d = dueAt(t)
  return d != null && d < Date.now() && t.status !== 'done'
}

/* ---------------------------------------------------------------------- */

export interface Stats {
  total: number
  done: number
  doing: number
  todo: number
  overdue: number
  hoursLeft: number
  pct: number
}

export function stats(tasks: Task[]): Stats {
  const now = Date.now()
  let done = 0, doing = 0, todo = 0, overdue = 0, hoursLeft = 0

  for (const t of tasks) {
    if (t.status === 'done') { done++; continue }
    if (t.status === 'doing') doing++
    else todo++
    hoursLeft += estimateOf(t)
    const d = dueAt(t)
    if (d != null && d < now) overdue++
  }

  return {
    total: tasks.length,
    done, doing, todo, overdue,
    hoursLeft: Math.round(hoursLeft * 10) / 10,
    pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  }
}

export interface Momentum {
  completed: number
  recent: number
  older: number
  perDay: number
  perWeek: number
  trend: number
  windowDays: number
}

/**
 * Velocity in tasks/day over a trailing window, with the recent half weighted
 * double — a burst three weeks ago should not read as "still fast".
 */
export function momentum(tasks: Task[], windowDays = 14): Momentum {
  const now = Date.now()
  const cutoff = now - windowDays * DAY
  let recent = 0, older = 0

  for (const t of tasks) {
    const d = doneAt(t)
    if (d == null || d < cutoff) continue
    if (d > now - (windowDays / 2) * DAY) recent++
    else older++
  }

  const perDay = (recent * 2 + older) / (windowDays * 1.5)
  const trend = older === 0 ? (recent > 0 ? 1 : 0) : recent / older - 1

  return {
    completed: recent + older,
    recent, older,
    perDay: Math.round(perDay * 100) / 100,
    perWeek: Math.round(perDay * 7 * 10) / 10,
    trend: Math.max(-1, Math.min(1, Math.round(trend * 100) / 100)),
    windowDays,
  }
}

export interface Forecast {
  done: boolean
  days: number
  date: Date | null
  remaining: number
  perDay: number
}

/**
 * "At this pace you finish on ___." Refuses to invent a date: with no
 * measurable velocity it returns Infinity and a null date, and callers are
 * expected to say so rather than guess.
 *
 * `scope` is the subset being forecast; `all` is everything, used as a floor so
 * one quiet fortnight on a project does not read as "never".
 */
export function forecast(scope: Task[], all: Task[] = scope): Forecast {
  const s = stats(scope)
  const remaining = s.total - s.done
  if (remaining === 0) return { done: true, days: 0, date: null, remaining: 0, perDay: 0 }

  const local = momentum(scope, 28).perDay
  const global = momentum(all, 28).perDay
  const effective = scope === all ? global : Math.max(local, global * 0.12)

  if (effective <= 0) {
    return { done: false, days: Infinity, date: null, remaining, perDay: 0 }
  }
  const days = Math.ceil(remaining / effective)
  return {
    done: false,
    days,
    date: new Date(Date.now() + days * DAY),
    remaining,
    perDay: Math.round(effective * 100) / 100,
  }
}

/**
 * The same question as forecast(), asked of a project that has not finished
 * anything yet.
 *
 * forecast() measures velocity from completed work, so a project on its first
 * week returns Infinity and the UI can only shrug. But stats() already knows
 * how many hours of work are outstanding, and `weekly_hours` is the owner's
 * declared budget — the missing divisor. This is an INTENTION-based estimate,
 * not a measured one, and callers must label it as such: presenting a plan as
 * a measurement is how a forecast stops being trusted.
 *
 * Returns null when there is nothing to divide by, rather than a fake date.
 */
export function budgetForecast(tasks: Task[], weeklyHours: number | null | undefined) {
  if (!weeklyHours || weeklyHours <= 0) return null
  const s = stats(tasks)
  if (s.total === s.done) return null
  if (s.hoursLeft <= 0) return null
  const days = Math.ceil((s.hoursLeft / weeklyHours) * 7)
  return { days, date: new Date(Date.now() + days * DAY), hoursLeft: s.hoursLeft }
}

export interface TargetVerdict {
  /** Days between the target and the expected landing. Negative = early. */
  slip: number
  tone: 'ahead' | 'tight' | 'late'
  label: string
}

/**
 * A declared target only earns its column by being compared to something. This
 * puts the owner's date next to the expected one and names the gap.
 *
 * `landing` is null whenever there is no basis for a date at all — no velocity
 * and no budget — and this returns null too rather than declaring a project
 * "on track" on the strength of knowing nothing about it.
 */
export function targetVerdict(
  target: string | null | undefined,
  landing: Date | null,
): TargetVerdict | null {
  if (!target || !landing) return null
  // Parsed the same way dueAt() parses a task's date — bare `new Date('...')`
  // on a yyyy-mm-dd string is UTC midnight, which lands on the previous day for
  // anyone west of Greenwich and would report a slip that does not exist.
  const want = new Date(`${target}T17:00:00`).getTime()
  if (Number.isNaN(want)) return null
  const slip = Math.round((landing.getTime() - want) / DAY)
  // A day either side of the target is noise, not a slip: both dates are
  // whole-day estimates and rounding alone can produce a one-day gap.
  if (slip <= -2) return { slip, tone: 'ahead', label: `${Math.abs(slip)}d ahead of target` }
  if (slip <= 1) return { slip, tone: 'tight', label: 'on target' }
  return { slip, tone: 'late', label: `${slip}d past target` }
}

/** 0 = touched today, 1 = abandoned. The first week is deliberately cheap. */
export function staleness(t: Task): number {
  if (t.status === 'done') return 0
  const days = (Date.now() - touchedAt(t)) / DAY
  return Math.max(0, Math.min(1, Math.pow(days / 21, 1.4)))
}

/** Deadline pressure as a continuous field, not an overdue boolean. */
export function urgency(t: Task): number {
  if (t.status === 'done') return 0
  const d = dueAt(t)
  if (d == null) return 0.15          // undated work is mild, not free
  const days = (d - Date.now()) / DAY
  if (days <= 0) return Math.min(1, 0.8 + Math.abs(days) / 14)
  if (days >= 14) return 0.1
  return Math.max(0.1, 0.8 - (days / 14) * 0.7)
}

/** Composite 0..1. Deliberately not "percent complete". */
export function health(tasks: Task[]): number {
  const s = stats(tasks)
  if (s.total === 0) return 1
  const open = tasks.filter((t) => t.status !== 'done')
  const avgStale = open.length
    ? open.reduce((a, t) => a + staleness(t), 0) / open.length
    : 0
  const overdueRatio = open.length ? s.overdue / open.length : 0
  const score = 0.4 * (s.pct / 100) + 0.3 * (1 - overdueRatio) + 0.3 * (1 - avgStale)
  return Math.max(0, Math.min(1, score))
}

/**
 * How much this task is worth starting right now. Transparent on purpose —
 * `explain()` reads the same terms back to the user.
 */
export function score(t: Task): number {
  if (t.status === 'done') return -1
  const v =
    urgency(t) * 3.2 +
    (PRIORITY_WEIGHT[t.priority] ?? 0.5) * 2.4 +
    (t.status === 'doing' ? 1.6 : 0) +      // finishing beats starting
    staleness(t) * 0.9 +
    Math.max(0, 1 - estimateOf(t) / 10) * 0.7   // a 10h epic never blocks the queue
  return Math.round(v * 1000) / 1000
}

export function explain(t: Task): string {
  const bits: string[] = []
  const now = Date.now()
  const d = dueAt(t)
  if (d != null && d < now) bits.push(`${Math.ceil((now - d) / DAY)}d overdue`)
  else if (d != null && d - now < 3 * DAY) bits.push(`due ${relDay(d)}`)
  if (t.priority === 'high') bits.push('high priority')
  if (t.status === 'doing') bits.push('already started')
  if (staleness(t) > 0.4) bits.push(`untouched ${Math.floor((now - touchedAt(t)) / DAY)}d`)
  return bits.length ? bits.join(' · ') : 'top of the queue'
}

export interface NextAction {
  task: Task
  score: number
  why: string
  queue: Task[]
  runnerUp: Task | null
}

export function nextAction(tasks: Task[]): NextAction | null {
  const open = tasks.filter((t) => t.status !== 'done')
  if (!open.length) return null
  const ranked = open
    .map((t) => ({ task: t, s: score(t) }))
    .sort((a, b) => b.s - a.s)
  return {
    task: ranked[0].task,
    score: ranked[0].s,
    why: explain(ranked[0].task),
    runnerUp: ranked[1]?.task ?? null,
    queue: ranked.slice(0, 5).map((r) => r.task),
  }
}

/* ============================================================================
   NATURAL-LANGUAGE CAPTURE
     ship the hero !high @fri #webgl ~6h /redesign
   Tokens the current schema cannot store (#tags, ~estimate) are still parsed
   and returned, so the composer can preview them and nothing is silently
   swallowed once the columns exist.
   ========================================================================== */
export interface Parsed {
  title: string
  priority: 'low' | 'medium' | 'high'
  due: number | null
  tags: string[]
  estimate: number
  projectQuery: string | null
  projectId: string | null
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function parseDue(token: string): number | null {
  const now = new Date()
  now.setHours(17, 0, 0, 0)
  let t = token.toLowerCase()

  if (t === 'today') return now.getTime()
  if (t === 'tomorrow' || t === 'tmr') return now.getTime() + DAY
  if (t === 'eow' || t === 'friday') t = 'fri'

  const rel = /^(\d+)([dwh])$/.exec(t)
  if (rel) {
    const n = parseInt(rel[1], 10)
    const mult = rel[2] === 'd' ? DAY : rel[2] === 'w' ? 7 * DAY : 3_600_000
    return Date.now() + n * mult
  }

  const wd = WEEKDAYS.indexOf(t.slice(0, 3))
  if (wd >= 0) {
    const delta = (wd - now.getDay() + 7) % 7
    return now.getTime() + (delta === 0 ? 7 : delta) * DAY
  }

  const iso = Date.parse(token)
  return isNaN(iso) ? null : iso
}

export function parse(text: string, projects: Project[] = []): Parsed {
  const out: Parsed = {
    title: '', priority: 'medium', due: null, tags: [],
    estimate: DEFAULT_ESTIMATE, projectQuery: null, projectId: null,
  }
  const title: string[] = []

  for (const w of String(text ?? '').trim().split(/\s+/)) {
    if (!w) continue
    const head = w[0]
    const body = w.slice(1)

    if (head === '!' && /^(low|medium|med|high)$/i.test(body)) {
      out.priority = /^(med|medium)$/i.test(body) ? 'medium' : (body.toLowerCase() as Parsed['priority'])
    } else if (head === '@' && body) {
      const d = parseDue(body)
      if (d) out.due = d
      else title.push(w)
    } else if (head === '#' && body) {
      out.tags.push(body.toLowerCase())
    } else if (head === '~' && /^\d+(\.\d+)?[hm]?$/i.test(body)) {
      const num = parseFloat(body)
      out.estimate = /m$/i.test(body) ? Math.round((num / 60) * 10) / 10 : num
    } else if (head === '/' && body) {
      out.projectQuery = body.toLowerCase()
    } else {
      title.push(w)
    }
  }

  out.title = title.join(' ').trim()

  if (out.projectQuery) {
    const q = out.projectQuery.replace(/\s+/g, '')
    const hit = projects.find((p) => p.name.toLowerCase().replace(/\s+/g, '').includes(q))
    if (hit) out.projectId = hit.id
  }
  return out
}

/* ---------------------------------------------------------------------- */

export function relDay(ts: number | null): string {
  if (ts == null) return '—'
  const days = Math.round((ts - Date.now()) / DAY)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${Math.abs(days)}d ago`
  if (days < 7) return `in ${days}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function shortDate(ts: number | null): string {
  return ts == null
    ? '—'
    : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Status order used everywhere a board is drawn. */
export const COLUMNS: { id: TaskStatus; name: string }[] = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'In progress' },
  { id: 'done', name: 'Done' },
]

/**
 * Day-by-day open/done counts.
 *
 * The prototype replayed an event log; the real tables keep no history, so
 * this reconstructs from created_at and completion date. A task counts as open
 * from creation until it was done. Tasks deleted in the past are simply gone —
 * so this is honest about the present, not a rewrite of the past.
 */
export function timeline(tasks: Task[], days = 30) {
  const out: { ts: number; done: number; open: number; total: number }[] = []
  const end = Date.now()
  for (let i = days; i >= 0; i--) {
    const ts = end - i * DAY
    let done = 0, open = 0
    for (const t of tasks) {
      const created = ms(t.created_at)
      if (created > ts) continue
      const d = doneAt(t)
      if (d != null && d <= ts) done++
      else open++
    }
    out.push({ ts, done, open, total: done + open })
  }
  return out
}
