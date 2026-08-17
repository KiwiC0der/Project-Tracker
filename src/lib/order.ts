import type { Task, TaskStatus } from './store'

/* ============================================================================
   TASK ORDER

   Positions are SPARSE, not 0..n-1. Dropping a task between two others takes
   the integer midpoint of its neighbours and writes exactly one row.

   The reason is `updated_at`. The `tasks_touch` trigger bumps it on every
   UPDATE, and the insights layer reads it as both `touchedAt` (staleness) and
   `doneAt` (completion date → momentum, burndown, landing forecast). If a drop
   renumbered the whole column, every shifted row would look touched today —
   reorder the Done column once and every task in it would read as completed
   today, and the forecast would report a pace that never happened.

   So the common path writes one row: the one the user actually touched, which
   genuinely was touched. Renumbering happens only when a gap closes to nothing,
   which at 1024 spacing takes ten consecutive drops into the same slot.
   ========================================================================== */
export const ORDER_STEP = 1024

/** Position first, then creation, then id. The last two are not decoration:
    rows created before positions were maintained are all tied at 0, and a tie
    with no tiebreak renders in whatever order the backend happened to return —
    which is how the board could reshuffle itself between loads. */
export const byOrder = (a: Task, b: Task) =>
  a.position - b.position ||
  Date.parse(a.created_at) - Date.parse(b.created_at) ||
  a.id.localeCompare(b.id)

/** One status column of one project, in display order. */
export const column = (tasks: Task[], projectId: string | null, status: TaskStatus) =>
  tasks.filter((t) => t.project_id === projectId && t.status === status).sort(byOrder)

export interface OrderPlan {
  /** Where the moved task lands. */
  position: number
  /** Other rows that must move to make room — empty on the common path. */
  renumber: { id: string; position: number }[]
}

/**
 * Where to put a task dropped at `index` of `rest`.
 *
 * `rest` is the destination column in display order, WITHOUT the task being
 * moved — removing it first is what makes "drop at index 3" mean the same
 * thing whether the task came from this column or another one.
 */
export function planMove(rest: Task[], index: number): OrderPlan {
  const i = Math.max(0, Math.min(index, rest.length))
  const lo = i > 0 ? rest[i - 1].position : null
  const hi = i < rest.length ? rest[i].position : null

  if (lo === null && hi === null) return { position: 0, renumber: [] }
  if (lo === null) return { position: hi! - ORDER_STEP, renumber: [] }
  if (hi === null) return { position: lo + ORDER_STEP, renumber: [] }

  const mid = Math.floor((lo + hi) / 2)
  if (mid > lo && mid < hi) return { position: mid, renumber: [] }

  // The gap is closed. Re-space the column and report only the rows that
  // actually move, so untouched tasks keep their `updated_at`.
  const renumber: { id: string; position: number }[] = []
  for (let k = 0; k < rest.length; k++) {
    const p = (k < i ? k : k + 1) * ORDER_STEP
    if (rest[k].position !== p) renumber.push({ id: rest[k].id, position: p })
  }
  return { position: i * ORDER_STEP, renumber }
}

/** A date input wants `YYYY-MM-DD` in the user's own calendar. `toISOString`
    would shift the day backwards for anyone west of Greenwich — a task due
    Friday, set in the evening in Portland, would be stored as Thursday. */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
