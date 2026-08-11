import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as I from '@/lib/insights'
import type { Task } from '@/lib/store'
import { BoardColumns, QuickAdd, Burndown, type Ctx } from './shared'

/* ============================================================================
   WORKBOARD — two layout modes over one set of panels.

     LOOSE   panels float, overlap, resize from any edge or corner
     LOCKED  panels tile a page; nothing overlaps and the page is always full

   Alt+Z toggles. Locking preserves the arrangement you actually made: a
   recursive guillotine turns the floating rectangles into a real split tree,
   so "one tall panel beside a stack of three" survives — a flat list of rows
   cannot represent that shape and collapses it into a single row.

   Geometry is stored as FRACTIONS of the board, never pixels: a resize is then
   a pure re-apply, and repeatedly opening the sidebar cannot accumulate drift.

   BOTH modes are manipulable. Locked is a tiling window manager, not a frozen
   picture: pull a gutter to re-proportion a split, drag one panel's head onto
   another to exchange them, or do either from the keyboard. Only the geometry
   model differs — loose moves rectangles, locked moves ratios inside a tree,
   which is what keeps the page full and overlap-free by construction.
   ========================================================================== */

export type PanelId = 'list' | 'progress' | 'priorities' | 'stale' | 'notes' | 'editor'

export const PANELS: Record<PanelId, { title: string }> = {
  list: { title: 'List' },
  progress: { title: 'Progress' },
  priorities: { title: 'Priorities' },
  stale: { title: 'Stale' },
  notes: { title: 'Notes' },
  editor: { title: 'Editor' },
}

interface Geo { fx: number; fy: number; fw: number; fh: number; z: number }
type Tree = { leaf: PanelId } | { dir: 'row' | 'col'; ratio: number; a: Tree; b: Tree }

const MIN_W = 210, MIN_H = 130
const LAYOUT_KEY = 'project-tracker-board'

const DEFAULT_OPEN: PanelId[] = ['progress', 'list', 'priorities', 'notes']
const DEFAULT_GEO: Record<string, [number, number, number, number]> = {
  progress: [0, 0, 0.26, 0.54],
  list: [0.265, 0, 0.735, 0.54],
  priorities: [0, 0.55, 0.49, 0.45],
  notes: [0.495, 0.55, 0.505, 0.45],
}

/* ---------------------------------------------------------------------- */

function buildTree(items: { id: PanelId; x: number; y: number; w: number; h: number }[]): Tree {
  if (items.length === 1) return { leaf: items[0].id }

  const cut = (axis: 'x' | 'y') => {
    const s = axis, e = axis === 'x' ? 'w' : 'h'
    const sorted = [...items].sort((p, q) => p[s] - q[s])
    let running = -Infinity
    let best: { gap: number; a: typeof items; b: typeof items } | null = null
    for (let i = 0; i < sorted.length - 1; i++) {
      running = Math.max(running, sorted[i][s] + sorted[i][e])
      const gap = sorted[i + 1][s] - running
      // A small negative tolerance treats touching edges as a clean cut.
      if (gap >= -8 && (!best || gap > best.gap)) {
        best = { gap, a: sorted.slice(0, i + 1), b: sorted.slice(i + 1) }
      }
    }
    return best
  }

  const cx = cut('x'), cy = cut('y')
  let use = cx && cy ? (cx.gap >= cy.gap ? cx : cy) : (cx ?? cy)
  let dir: 'row' | 'col' = use === cx ? 'row' : 'col'

  if (!use) {
    // Overlapping past separability — fall back to reading order so the result
    // is still a valid, full page.
    const sorted = [...items].sort((p, q) => p.y - q.y || p.x - q.x)
    const mid = Math.ceil(sorted.length / 2)
    use = { gap: 0, a: sorted.slice(0, mid), b: sorted.slice(mid) }
    dir = 'col'
  }

  const extent = (list: typeof items) => {
    const s = dir === 'row' ? 'x' : 'y', e = dir === 'row' ? 'w' : 'h'
    const lo = Math.min(...list.map((i) => i[s]))
    const hi = Math.max(...list.map((i) => i[s] + i[e]))
    return Math.max(1, hi - lo)
  }
  const aS = extent(use.a), bS = extent(use.b)
  return { dir, ratio: I.clamp(aS / (aS + bS), 0.15, 0.85), a: buildTree(use.a), b: buildTree(use.b) }
}

const leaves = (n: Tree, out: PanelId[] = []): PanelId[] => {
  if ('leaf' in n) { out.push(n.leaf); return out }
  leaves(n.a, out); leaves(n.b, out); return out
}

function dropLeaf(n: Tree, id: PanelId): Tree | null {
  if ('leaf' in n) return n.leaf === id ? null : n
  const a = dropLeaf(n.a, id), b = dropLeaf(n.b, id)
  if (!a) return b
  if (!b) return a
  return { ...n, a, b }
}

/** The leaf NODE, not a copy — callers exchange `.leaf` in place so a swap
    keeps every ratio in the tree exactly where it was. */
function findLeaf(n: Tree, id: PanelId): { leaf: PanelId } | null {
  if ('leaf' in n) return n.leaf === id ? n : null
  return findLeaf(n.a, id) ?? findLeaf(n.b, id)
}

/** setPointerCapture throws if the pointer is already gone — a cancelled or
    lost pointer racing the pointerdown. Uncaught, that aborts the handler
    before its move listeners are attached and the gesture dies silently. The
    drag is still worth starting without capture: it just stops tracking if the
    cursor leaves the element. */
function capture(el: Element, id: number) {
  try { el.setPointerCapture(id) } catch { /* proceed uncaptured */ }
}

/* ============================================================================
   SPLIT — one node of the locked tree, with the gutter that re-proportions it.

   Defined at module level, never inside the parent's render: a component
   declared inside a render is a new type on every pass, so React would unmount
   and rebuild it — and a gutter that remounts mid-drag drops the pointer
   capture and the drag dies on the first move.

   The drag writes `flex` straight onto the two slot elements and mutates
   `node.ratio` in place, rather than going through state on every pointermove.
   Sixty setState calls a second would re-render every panel body — the task
   list, the burndown, the editor — to move a divider. State is reconciled once
   on pointerup, when the parent clones the root to publish the new ratios.
   ========================================================================== */
interface SplitNode { dir: 'row' | 'col'; ratio: number; a: Tree; b: Tree }

function Split({ node, onCommit, a, b }: {
  node: SplitNode
  onCommit: () => void
  a: JSX.Element
  b: JSX.Element
}) {
  const aRef = useRef<HTMLDivElement>(null)
  const bRef = useRef<HTMLDivElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const vertical = node.dir === 'row'

  const put = (r: number) => {
    node.ratio = I.clamp(r, 0.15, 0.85)
    if (aRef.current) aRef.current.style.flex = `${node.ratio} 1 0`
    if (bRef.current) bRef.current.style.flex = `${1 - node.ratio} 1 0`
    gutRef.current?.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)))
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = e.currentTarget
    const host = g.parentElement?.getBoundingClientRect()
    if (!host) return
    const start = vertical ? e.clientX : e.clientY
    const total = Math.max(1, vertical ? host.width : host.height)
    const from = node.ratio
    capture(g, e.pointerId)
    g.dataset.active = 'true'
    e.preventDefault()

    const onMove = (ev: PointerEvent) =>
      put(from + ((vertical ? ev.clientX : ev.clientY) - start) / total)
    const end = () => {
      g.removeEventListener('pointermove', onMove)
      g.removeEventListener('pointerup', end)
      g.removeEventListener('pointercancel', end)
      delete g.dataset.active
      onCommit()
    }
    g.addEventListener('pointermove', onMove)
    g.addEventListener('pointerup', end)
    g.addEventListener('pointercancel', end)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const dec = vertical ? 'ArrowLeft' : 'ArrowUp'
    const inc = vertical ? 'ArrowRight' : 'ArrowDown'
    const step = e.key === dec ? -0.04 : e.key === inc ? 0.04 : 0
    if (!step) return
    e.preventDefault()
    put(node.ratio + step)
    onCommit()
  }

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${vertical ? 'flex-row' : 'flex-col'}`}>
      <div ref={aRef} className="flex min-h-0 min-w-0" style={{ flex: `${node.ratio} 1 0` }}>{a}</div>
      <div
        ref={gutRef}
        role="separator"
        tabIndex={0}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label={vertical ? 'Column width' : 'Row height'}
        aria-valuenow={Math.round(node.ratio * 100)}
        aria-valuemin={15}
        aria-valuemax={85}
        onPointerDown={onDown}
        onKeyDown={onKey}
        className={`gut ${vertical ? 'gut-v' : 'gut-h'}`}
      />
      <div ref={bRef} className="flex min-h-0 min-w-0" style={{ flex: `${1 - node.ratio} 1 0` }}>{b}</div>
    </div>
  )
}

/* ---------------------------------------------------------------------- */

export function Workboard({ ctx }: { ctx: Ctx }) {
  const boardRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<Record<string, Geo>>({})
  const zRef = useRef(20)

  const [open, setOpen] = useState<PanelId[]>(DEFAULT_OPEN)
  const [mode, setMode] = useState<'loose' | 'locked'>('loose')
  const [tree, setTree] = useState<Tree | null>(null)
  /** The panel you are working in. Drives the heavier cast shadow, and in loose
      mode the stacking order — the selected window is the front window. */
  const [active, setActive] = useState<PanelId | null>(null)
  const [, force] = useState(0)
  const repaint = useCallback(() => force((n) => n + 1), [])

  const rect = () => boardRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 1, 1)

  /* ---- persistence ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        const ids: PanelId[] = (s.open ?? []).filter((p: PanelId) => p in PANELS)
        if (ids.length) {
          setOpen(ids)
          geoRef.current = s.geo ?? {}
          // The stacking counter has to resume above the restored values, or
          // the first grab after a reload assigns a z BELOW panels that were
          // raised in an earlier session and the panel you just grabbed sinks.
          zRef.current = Math.max(zRef.current, ...Object.values(geoRef.current).map((g) => g.z || 0))
          if (s.mode === 'locked' && s.tree) { setMode('locked'); setTree(s.tree) }
          return
        }
      }
    } catch { /* corrupt or unavailable — fall through to defaults */ }
    geoRef.current = Object.fromEntries(
      DEFAULT_OPEN.map((id, i) => {
        const g = DEFAULT_GEO[id]
        return [id, { fx: g[0], fy: g[1], fw: g[2], fh: g[3], z: 20 + i }]
      }),
    )
    zRef.current = 24
    repaint()
  }, [repaint])

  const save = useCallback((next?: { open?: PanelId[]; mode?: string; tree?: Tree | null }) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        open: next?.open ?? open,
        geo: geoRef.current,
        mode: next?.mode ?? mode,
        tree: next?.tree !== undefined ? next.tree : tree,
      }))
    } catch { /* private mode — the arrangement just won't survive a reload */ }
  }, [open, mode, tree])

  /* ---- geometry helpers ---- */
  const toPx = (g: Geo) => {
    const r = rect()
    return { x: g.fx * r.width, y: g.fy * r.height, w: g.fw * r.width, h: g.fh * r.height }
  }
  const clampPx = (p: { x: number; y: number; w: number; h: number }) => {
    const r = rect()
    p.w = I.clamp(p.w, MIN_W, Math.max(MIN_W, r.width))
    p.h = I.clamp(p.h, MIN_H, Math.max(MIN_H, r.height))
    p.x = I.clamp(p.x, -(p.w - 90), Math.max(0, r.width - 90))
    p.y = I.clamp(p.y, 0, Math.max(0, r.height - 26))
    return p
  }
  const commitPx = (id: PanelId, p: { x: number; y: number; w: number; h: number }) => {
    const r = rect()
    const c = clampPx(p)
    const g = geoRef.current[id]
    if (!g || !r.width || !r.height) return
    g.fx = c.x / r.width; g.fy = c.y / r.height
    g.fw = c.w / r.width; g.fh = c.h / r.height
    applyGeo(id)
  }
  const applyGeo = (id: PanelId) => {
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-panel="${id}"]`)
    const g = geoRef.current[id]
    if (!el || !g) return
    const p = clampPx(toPx(g))
    el.style.left = `${Math.round(p.x)}px`
    el.style.top = `${Math.round(p.y)}px`
    el.style.width = `${Math.round(p.w)}px`
    el.style.height = `${Math.round(p.h)}px`
    el.style.zIndex = String(g.z)
  }

  /* Re-apply on any board resize — fractions make this exact, so the sidebar
     opening and closing repeatedly never shifts the arrangement. */
  useEffect(() => {
    if (mode !== 'loose' || !boardRef.current) return
    const ro = new ResizeObserver(() => open.forEach(applyGeo))
    ro.observe(boardRef.current)
    open.forEach(applyGeo)
    return () => ro.disconnect()
  })

  /* ---- mode switching ---- */
  const toLocked = useCallback(() => {
    const r = rect()
    const items = open.map((id) => {
      const g = geoRef.current[id] ?? { fx: 0, fy: 0, fw: 0.5, fh: 0.5, z: 20 }
      return {
        id,
        x: g.fx * r.width, y: g.fy * r.height,
        w: Math.max(1, g.fw * r.width), h: Math.max(1, g.fh * r.height),
      }
    })
    const t = items.length ? buildTree(items) : { leaf: open[0] ?? 'list' }
    setTree(t); setMode('locked'); save({ mode: 'locked', tree: t })
  }, [open, save])

  const toLoose = useCallback(() => {
    // Freeze the tiled panes exactly where they sit, so unlocking is a no-op.
    const r = rect()
    boardRef.current?.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => {
      const b = el.getBoundingClientRect()
      geoRef.current[el.dataset.panel!] = {
        fx: (b.left - r.left) / r.width, fy: (b.top - r.top) / r.height,
        fw: b.width / r.width, fh: b.height / r.height,
        z: ++zRef.current,
      }
    })
    setMode('loose'); save({ mode: 'loose' })
  }, [save])

  const toggleMode = useCallback(() => {
    if (mode === 'loose') toLocked(); else toLoose()
  }, [mode, toLocked, toLoose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyZ') return
      const ae = document.activeElement
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return
      e.preventDefault()
      toggleMode()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [toggleMode])

  /* ---- open / close ---- */
  const openPanel = (id: PanelId) => {
    if (open.includes(id)) return
    const next = [...open, id]
    if (mode === 'locked' && tree) {
      setTree({ dir: 'col', ratio: 0.6, a: tree, b: { leaf: id } })
    } else if (!geoRef.current[id]) {
      const i = open.length
      geoRef.current[id] = { fx: 0.08 + i * 0.03, fy: 0.08 + i * 0.03, fw: 0.42, fh: 0.42, z: ++zRef.current }
    }
    setOpen(next); save({ open: next })
  }
  const closePanel = (id: PanelId) => {
    const next = open.filter((x) => x !== id)
    let t = tree
    if (t) t = dropLeaf(t, id)
    if (mode === 'locked' && !t) { t = { leaf: next[0] ?? 'list' } }
    setOpen(next.length ? next : ['list'])
    setTree(t)
    // Selection cannot outlive the panel it points at, or nothing is selected
    // and the board still says something is.
    if (active === id) setActive(null)
    save({ open: next, tree: t })
  }

  /* ---- selection --------------------------------------------------------
     Touching a panel anywhere selects it: the capture phase runs before the
     header's own drag handler, so one gesture both selects and grabs. Focus is
     wired separately because tabbing into a panel is also entering it, and a
     pointer event will never fire for that. --------------------------------- */
  const selectPanel = useCallback((id: PanelId) => {
    setActive(id)
    if (mode !== 'loose') return
    const g = geoRef.current[id]
    // Already in front — do not churn the counter or write to storage.
    if (!g || g.z === zRef.current) return
    g.z = ++zRef.current
    applyGeo(id)
    save()
  }, [mode, save])

  /* ---- drag + resize (loose only) ---- */
  const startDrag = (id: PanelId) => (e: React.PointerEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('button')) return
    const el = e.currentTarget as HTMLElement
    const g = geoRef.current[id]
    if (!g) return
    const start = toPx(g)
    const px = e.clientX, py = e.clientY
    capture(el, e.pointerId)
    const onMove = (ev: PointerEvent) =>
      commitPx(id, { x: start.x + (ev.clientX - px), y: start.y + (ev.clientY - py), w: start.w, h: start.h })
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      save()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    applyGeo(id)
  }

  const startResize = (id: PanelId, dir: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const g = geoRef.current[id]
    if (!g) return
    const s = toPx(g)
    const px = e.clientX, py = e.clientY
    capture(el, e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - px, dy = ev.clientY - py
      const box = { x: s.x, y: s.y, w: s.w, h: s.h }
      if (dir.includes('e')) box.w = s.w + dx
      if (dir.includes('s')) box.h = s.h + dy
      // West/north edges move the origin as well as the size, and must stop
      // moving it once the size bottoms out at the floor.
      if (dir.includes('w')) { const nw = Math.max(MIN_W, s.w - dx); box.x = s.x + (s.w - nw); box.w = nw }
      if (dir.includes('n')) { const nh = Math.max(MIN_H, s.h - dy); box.y = s.y + (s.h - nh); box.h = nh }
      commitPx(id, box)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      save()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  /* ---- locked-mode manipulation -------------------------------------------
     A tiled panel cannot be moved to arbitrary pixels without tearing a hole
     in the page, so it moves by exchanging places with another panel. The two
     ratios stay where they were; only the contents trade. ---------------- */

  /** Published once, after a gutter drag has already mutated the tree in place
      — a fresh root identity is all React needs to re-read it. Deliberately
      not an updater function: an updater must be pure, and this saves. */
  const publishTree = useCallback(() => {
    if (!tree) return
    const next = { ...tree }
    setTree(next)
    save({ tree: next })
  }, [tree, save])

  const refocus = useRef<PanelId | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    boardRef.current?.querySelector<HTMLElement>(`[data-panel="${id}"] [data-head]`)?.focus()
  })

  const swap = useCallback((a: PanelId, b: PanelId) => {
    if (a === b || !tree) return
    const A = findLeaf(tree, a), B = findLeaf(tree, b)
    if (!A || !B) return
    A.leaf = b; B.leaf = a          // exchange contents, keep every ratio
    const next = { ...tree }
    setTree(next)
    save({ tree: next })
  }, [tree, save])

  const paneUnder = (x: number, y: number) => {
    let hit: HTMLElement | null = null
    boardRef.current?.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => {
      const r = p.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = p
    })
    return hit as HTMLElement | null
  }

  /** Nearest panel in a direction, measured off the rendered rectangles.
      Spatial neighbours are what "move it left" means to someone looking at
      the page; walking the tree gives surprising answers across a deep split. */
  const neighbour = (id: PanelId, dir: 'l' | 'r' | 'u' | 'd'): PanelId | null => {
    const me = boardRef.current?.querySelector<HTMLElement>(`[data-panel="${id}"]`)
    if (!me) return null
    const a = me.getBoundingClientRect()
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2
    let best: PanelId | null = null, bestScore = Infinity
    boardRef.current?.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => {
      if (el === me || !el.dataset.panel) return
      const b = el.getBoundingClientRect()
      const dx = b.left + b.width / 2 - acx, dy = b.top + b.height / 2 - acy
      const ok = dir === 'l' ? dx < -1 : dir === 'r' ? dx > 1 : dir === 'u' ? dy < -1 : dy > 1
      if (!ok) return
      const horiz = dir === 'l' || dir === 'r'
      // Along-axis distance dominates; the cross-axis term only breaks ties.
      const s = (horiz ? Math.abs(dx) : Math.abs(dy)) + (horiz ? Math.abs(dy) : Math.abs(dx)) * 2
      if (s < bestScore) { bestScore = s; best = el.dataset.panel as PanelId }
    })
    return best
  }

  const startSwap = (id: PanelId) => (e: React.PointerEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('button')) return
    const head = e.currentTarget as HTMLElement
    const pane = head.closest<HTMLElement>('[data-panel]')
    if (!pane) return
    capture(head, e.pointerId)
    let moved = false
    const clear = () =>
      boardRef.current?.querySelectorAll('.pane-target').forEach((p) => p.classList.remove('pane-target'))

    const onMove = (ev: PointerEvent) => {
      // A plain click must not read as a drag, so the lift waits for movement.
      if (!moved) { moved = true; pane.classList.add('pane-lifted') }
      clear()
      const over = paneUnder(ev.clientX, ev.clientY)
      if (over && over !== pane) over.classList.add('pane-target')
    }
    const end = (ev: PointerEvent) => {
      head.removeEventListener('pointermove', onMove)
      head.removeEventListener('pointerup', end)
      head.removeEventListener('pointercancel', end)
      pane.classList.remove('pane-lifted')
      clear()
      if (!moved) return
      const over = paneUnder(ev.clientX, ev.clientY)
      if (over && over !== pane && over.dataset.panel) {
        refocus.current = id
        swap(id, over.dataset.panel as PanelId)
      }
    }
    head.addEventListener('pointermove', onMove)
    head.addEventListener('pointerup', end)
    head.addEventListener('pointercancel', end)
  }

  /* Alt+arrow means "move this panel that way" in both modes — it just means
     something different in each, because the geometry does. Locked exchanges
     it with its neighbour; loose snaps it to that half of the board, the way
     a desktop window manager does. Without this the focusable head would be a
     tab stop with nothing behind it for anyone not using a pointer. */
  const SNAP: Record<string, [number, number, number, number]> = {
    ArrowLeft: [0, 0, 0.5, 1], ArrowRight: [0.5, 0, 0.5, 1],
    ArrowUp: [0, 0, 1, 0.5], ArrowDown: [0, 0.5, 1, 0.5],
  }

  const headKey = (id: PanelId) => (e: React.KeyboardEvent) => {
    if (!e.altKey) return
    if (mode === 'loose') {
      const s = SNAP[e.key]
      const g = geoRef.current[id]
      if (!s || !g) return
      e.preventDefault()
      g.fx = s[0]; g.fy = s[1]; g.fw = s[2]; g.fh = s[3]; g.z = ++zRef.current
      applyGeo(id)
      save()
      return
    }
    const dirs: Record<string, 'l' | 'r' | 'u' | 'd'> = {
      ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd',
    }
    const d = dirs[e.key]
    if (!d) return
    const target = neighbour(id, d)
    if (!target) return
    e.preventDefault()
    refocus.current = id
    swap(id, target)
  }

  /* ---- render ---- */
  const frame = (id: PanelId, extra?: string) => (
    <section
      key={id}
      data-panel={id}
      data-active={active === id ? 'true' : undefined}
      aria-label={`${PANELS[id].title} panel`}
      onPointerDownCapture={() => selectPanel(id)}
      onFocusCapture={() => selectPanel(id)}
      className={`pane-cast flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface ${extra ?? ''}`}
      style={mode === 'loose' ? { position: 'absolute' } : undefined}
    >
      <header
        data-head
        tabIndex={0}
        onPointerDown={mode === 'loose' ? startDrag(id) : startSwap(id)}
        onKeyDown={headKey(id)}
        aria-label={mode === 'loose'
          ? `${PANELS[id].title} — drag to move`
          : `${PANELS[id].title} — drag onto another panel to swap, or Alt with an arrow key`}
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-surface-2 px-2.5 active:cursor-grabbing"
      >
        <h2 className="ui-face text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted">
          {PANELS[id].title}
        </h2>
        <span className="flex-1" />
        <button type="button" aria-label={`Close ${PANELS[id].title}`} onClick={() => closePanel(id)}
          className="rounded px-1 text-muted hover:bg-brand/20 hover:text-foreground">✕</button>
      </header>
      <div className="pt-pad min-h-0 flex-1 overflow-auto">
        <PanelBody id={id} ctx={ctx} />
      </div>
      {mode === 'loose' && ['n','s','e','w','nw','ne','sw','se'].map((d) => (
        <span key={d} onPointerDown={startResize(id, d)} className={handleClass(d)} />
      ))}
    </section>
  )

  /* Each split is a flex box and each slot is a flex child sized by `ratio`.
     The leaf section must itself be `flex-1`, or a panel sits at its content
     width inside a correctly sized slot and the page stops filling. */
  const renderTree = (n: Tree, key = 'r'): JSX.Element => {
    if ('leaf' in n) return frame(n.leaf, 'flex-1')
    return (
      <Split
        key={key}
        node={n}
        onCommit={publishTree}
        a={renderTree(n.a, key + 'a')}
        b={renderTree(n.b, key + 'b')}
      />
    )
  }

  const dock = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-background px-3 py-2">
      {(Object.keys(PANELS) as PanelId[]).map((id) => (
        <button key={id} type="button"
          onClick={() => (open.includes(id) ? closePanel(id) : openPanel(id))}
          className={`ui-face rounded-md border px-2 py-1 text-[0.62rem] uppercase tracking-wider transition-colors
            ${open.includes(id) ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border text-muted hover:text-foreground'}`}>
          {PANELS[id].title}
        </button>
      ))}
      <span className="flex-1" />
      <span className="num hidden text-[0.62rem] text-muted md:inline">
        {mode === 'loose'
          ? 'Drag a head to move · edges and corners resize'
          : 'Pull a gutter to resize · drag a head onto another to swap · Alt+arrows'}
        {' · Alt+Z toggles'}
      </span>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <fieldset className="flex items-center rounded-md border border-border" aria-label="Layout mode">
          {(['loose', 'locked'] as const).map((m) => (
            <label key={m} title="Alt+Z"
              className={`ui-face cursor-pointer px-2.5 py-1 text-[0.62rem] uppercase tracking-wider transition-colors
                ${mode === m ? 'bg-brand/20 text-foreground' : 'text-muted hover:text-foreground'}`}>
              <input type="radio" name="layout-mode" checked={mode === m} aria-keyshortcuts="Alt+Z"
                onChange={() => (m === 'locked' ? toLocked() : toLoose())} className="sr-only" />
              {m}
            </label>
          ))}
        </fieldset>
      </div>

      {/* Gutters carry the space between tiles, so the container adds no gap
          of its own — a gap plus a gutter reads as two rules, not one. */}
      <div ref={boardRef}
        className={`pt-pad relative min-h-0 flex-1 ${mode === 'locked' ? 'flex' : ''}`}>
        {mode === 'loose'
          ? open.map((id) => frame(id))
          : tree && renderTree(tree)}
      </div>

      {dock}
    </div>
  )
}

/* Corner handles sit above the edge strips, or an 8px edge swallows the
   diagonal grab. */
function handleClass(d: string) {
  const base = 'absolute z-[3]'
  switch (d) {
    case 'n': return `${base} left-3 right-3 -top-1 h-2 cursor-ns-resize`
    case 's': return `${base} left-3 right-3 -bottom-1 h-2 cursor-ns-resize`
    case 'e': return `${base} top-3 bottom-3 -right-1 w-2 cursor-ew-resize`
    case 'w': return `${base} top-3 bottom-3 -left-1 w-2 cursor-ew-resize`
    case 'nw': return `${base} -top-1 -left-1 h-4 w-4 cursor-nwse-resize z-[4]`
    case 'ne': return `${base} -top-1 -right-1 h-4 w-4 cursor-nesw-resize z-[4]`
    case 'sw': return `${base} -bottom-1 -left-1 h-4 w-4 cursor-nesw-resize z-[4]`
    default: return `${base} -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize z-[4]`
  }
}

/* ==========================================================================
   PANEL BODIES
   ========================================================================== */
function PanelBody({ id, ctx }: { id: PanelId; ctx: Ctx }) {
  switch (id) {
    case 'list': return <BoardColumns ctx={ctx} />
    case 'progress': return <ProgressPanel ctx={ctx} />
    case 'priorities': return <PrioritiesPanel ctx={ctx} />
    case 'stale': return <StalePanel ctx={ctx} />
    case 'notes': return <NotesPanel ctx={ctx} />
    case 'editor': return <EditorPanel ctx={ctx} />
  }
}

function Fig({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-soft py-1 last:border-0">
      <span className="text-xs text-muted">{k}</span>
      <span className={`num text-sm font-semibold ${warn ? 'text-brand' : ''}`}>{v}</span>
    </div>
  )
}

function ProgressPanel({ ctx }: { ctx: Ctx }) {
  const s = I.stats(ctx.projectTasks)
  const m = I.momentum(ctx.tasks)
  const f = I.forecast(ctx.projectTasks, ctx.tasks)
  const trend = m.trend > 0.15 ? 'rising' : m.trend < -0.15 ? 'falling' : 'steady'
  return (
    <>
      <Fig k="To do" v={s.todo} />
      <Fig k="In progress" v={s.doing} />
      <Fig k="Done" v={`${s.done} / ${s.total}`} />
      <Fig k="Overdue" v={s.overdue} warn={s.overdue > 0} />
      <Fig k="Hours left" v={`${s.hoursLeft}h`} />
      <Fig k="Complete" v={`${s.pct}%`} />
      <Fig k="Pace" v={`${m.perWeek}/wk`} />
      <Fig k="Trend" v={trend} warn={m.trend < -0.15} />
      <Fig k="Lands" v={f.done ? 'complete' : !isFinite(f.days) ? 'no pace' : I.shortDate(f.date!.getTime())}
        warn={!isFinite(f.days)} />
      <div className="mt-2"><Burndown tasks={ctx.projectTasks} /></div>
    </>
  )
}

function PrioritiesPanel({ ctx }: { ctx: Ctx }) {
  const n = I.nextAction(ctx.projectTasks)
  return (
    <>
      {n ? (
        <div className="mb-3">
          <p className="ui-face mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">Do this next</p>
          <p className="text-sm font-semibold leading-snug">{n.task.title}</p>
          <p className="num mt-0.5 text-[0.65rem] text-muted">{n.why}</p>
          <button type="button"
            onClick={() => ctx.move(n.task.id, n.task.status === 'doing' ? 'done' : 'doing')}
            className="mt-2 rounded-lg border border-brand/50 bg-brand/10 px-2.5 py-1 text-xs">
            {n.task.status === 'doing' ? 'Mark done' : 'Start it'}
          </button>
        </div>
      ) : <p className="mb-3 text-sm text-muted">Nothing open.</p>}
      <p className="ui-face mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">Quick add</p>
      <QuickAdd ctx={ctx} />
    </>
  )
}

function StalePanel({ ctx }: { ctx: Ctx }) {
  const dead = ctx.tasks
    .filter((t) => t.status !== 'done' && I.staleness(t) > 0.18)
    .sort((a, b) => I.staleness(b) - I.staleness(a))
    .slice(0, 8)
  if (!dead.length) return <p className="text-sm text-muted">Nothing has been left to rot.</p>
  return (
    <>
      <p className="mb-2 text-xs text-muted">Tasks untouched long enough to be presumed lost.</p>
      {dead.map((t) => (
        <div key={t.id} className="border-b border-border-soft py-2 last:border-0">
          <p className="text-sm italic leading-snug">{t.title}</p>
          <p className="num text-[0.62rem] text-muted">
            {ctx.projects.find((p) => p.id === t.project_id)?.name} · untouched{' '}
            {Math.floor((Date.now() - I.touchedAt(t)) / I.DAY)}d · {Math.round(I.staleness(t) * 100)}% gone
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={() => ctx.patch(t.id, { status: 'doing' })}
              className="rounded border border-border px-2 py-0.5 text-[0.62rem] hover:bg-surface-2">Revive</button>
            <button type="button" onClick={() => ctx.remove(t.id)}
              className="rounded border border-brand/50 px-2 py-0.5 text-[0.62rem] text-brand hover:bg-brand/10">Let go</button>
          </div>
        </div>
      ))}
    </>
  )
}

/* Notes have no table yet, so they live on the device, keyed by account. */
interface Note { id: string; ts: number; project: string | null; text: string }

function NotesPanel({ ctx }: { ctx: Ctx }) {
  const key = `project-tracker-notes:${ctx.user.id}`
  const [notes, setNotes] = useState<Note[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] }
  })
  const [v, setV] = useState('')
  const commit = (next: Note[]) => {
    setNotes(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* no persistence available */ }
  }
  const addNote = () => {
    const text = v.trim()
    if (!text) return
    commit([{ id: `n${Date.now().toString(36)}`, ts: Date.now(), project: ctx.activeProject, text }, ...notes])
    setV('')
  }

  return (
    <>
      <textarea
        value={v} rows={2}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() } }}
        placeholder="A thought about a task, a project, anything not worth filing yet…"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={addNote}
          className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2">Add note</button>
        <span className="num text-[0.62rem] text-muted">Enter to add · Shift+Enter for a new line</span>
      </div>

      {notes.map((n) => (
        <div key={n.id} className="border-b border-border-soft py-2 last:border-0">
          <p className="text-sm leading-snug">{n.text}</p>
          <p className="num text-[0.62rem] text-muted">
            {ctx.projects.find((p) => p.id === n.project)?.name ?? 'general'} · {I.relDay(n.ts)}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button"
              onClick={async () => {
                // A note runs through the same parser as quick add, so tokens
                // written into it carry straight onto the task.
                if (await ctx.add(n.text, n.project ?? undefined)) {
                  commit(notes.filter((x) => x.id !== n.id))
                }
              }}
              className="rounded border border-border px-2 py-0.5 text-[0.62rem] hover:bg-surface-2">Make it a task</button>
            <button type="button" onClick={() => commit(notes.filter((x) => x.id !== n.id))}
              className="rounded border border-brand/50 px-2 py-0.5 text-[0.62rem] text-brand hover:bg-brand/10">Delete</button>
          </div>
        </div>
      ))}
    </>
  )
}

function EditorPanel({ ctx }: { ctx: Ctx }) {
  const t = useMemo(() => ctx.tasks.find((x) => x.id === ctx.selected) ?? null, [ctx.tasks, ctx.selected])
  if (!t) return <p className="text-sm text-muted">Select a task in List.</p>

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="mb-2.5 block">
      <span className="ui-face mb-1 block text-[0.6rem] uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  )
  const input = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand'

  return (
    <>
      <Field label="Title">
        <input className={input} defaultValue={t.title} key={`${t.id}-title`}
          onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && ctx.patch(t.id, { title: e.target.value.trim() })} />
      </Field>
      <Field label="Notes">
        <textarea className={`${input} min-h-[3.5rem] resize-y`} defaultValue={t.notes} key={`${t.id}-notes`}
          onBlur={(e) => e.target.value !== t.notes && ctx.patch(t.id, { notes: e.target.value })} />
      </Field>
      <Field label="Status">
        <select className={input} value={t.status} onChange={(e) => ctx.move(t.id, e.target.value as Task['status'])}>
          {I.COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Priority">
        <select className={input} value={t.priority} onChange={(e) => ctx.patch(t.id, { priority: e.target.value as Task['priority'] })}>
          {['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Due">
        <input className={input} type="date" value={t.due_date ?? ''}
          onChange={(e) => ctx.patch(t.id, { due_date: e.target.value || null })} />
      </Field>
      <Fig k="Staleness" v={`${Math.round(I.staleness(t) * 100)}%`} warn={I.staleness(t) > 0.4} />
      <Fig k="Rank" v={I.score(t)} />
      <Fig k="Created" v={I.shortDate(new Date(t.created_at).getTime())} />
      <button type="button" onClick={() => ctx.remove(t.id)}
        className="mt-3 rounded-lg border border-brand/50 px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
        Delete task
      </button>
    </>
  )
}
