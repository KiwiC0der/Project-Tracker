import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import * as I from '@/lib/insights'
import type { Task } from '@/lib/store'
import { BoardColumns, QuickAdd, Burndown, isAllScope, type Ctx } from './shared'
import { projectTone } from './ProjectDialog'

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

export type PanelId = 'list' | 'progress' | 'priorities' | 'stale' | 'notes'

export const PANELS: Record<PanelId, { title: string }> = {
  list: { title: 'List' },
  progress: { title: 'Progress' },
  priorities: { title: 'Priorities' },
  stale: { title: 'Stale' },
  notes: { title: 'Notes' },
}

/** `pre` is the rectangle a panel had before it was maximised, and its
    presence — not the live rectangle — is what says the panel is maximised.
    A maximised panel can be dragged and resized away from full board and the
    restore rectangle survives that, so `pre` means "a restore is pending",
    never "this panel is exactly full-board right now". Keeping it beside the
    live rectangle rather than overwriting it is what makes restore exact: it
    replays numbers, it never recomputes them. */
interface Geo {
  fx: number; fy: number; fw: number; fh: number; z: number
  pre?: { fx: number; fy: number; fw: number; fh: number }
}
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

/** Drop leaves this build no longer knows about. A saved locked tree from an
    older version can still name a retired panel, and rendering one would read
    PANELS[id].title off undefined and take the whole board down. The `open`
    list was already filtered; the tree was not. */
function pruneTree(n: Tree): Tree | null {
  if ('leaf' in n) return n.leaf in PANELS ? n : null
  const a = pruneTree(n.a), b = pruneTree(n.b)
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

/**
 * A request from outside the board — the sidebar — to bring one panel up.
 *
 * The nonce is what makes "show me Notes" repeatable: asking for the panel you
 * are already looking at is still an answerable request (raise it, focus it),
 * and an id alone could not distinguish a second ask from a re-render.
 */
export interface PanelFocus { id: PanelId; nonce: number }

export function Workboard({ ctx, focus }: { ctx: Ctx; focus?: PanelFocus | null }) {
  const boardRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<Record<string, Geo>>({})
  const zRef = useRef(20)

  const [open, setOpen] = useState<PanelId[]>(DEFAULT_OPEN)
  const [mode, setMode] = useState<'loose' | 'locked'>('loose')
  const [tree, setTree] = useState<Tree | null>(null)
  /** The panel you are working in. Drives the heavier cast shadow, and in loose
      mode the stacking order — the selected window is the front window. */
  const [active, setActive] = useState<PanelId | null>(null)
  /** Flipped once the restore pass below has run. An external focus request
      that landed before it would read `open` as the hardcoded default, reopen
      the default set and save that over the arrangement being restored. */
  const [restored, setRestored] = useState(false)
  const [, force] = useState(0)
  const repaint = useCallback(() => force((n) => n + 1), [])

  const rect = () => boardRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 1, 1)

  /* ---- persistence ---- */
  useEffect(() => {
    setRestored(true)
    try {
      const raw = localStorage.getItem(LAYOUT_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        const ids: PanelId[] = (s.open ?? []).filter((p: PanelId) => p in PANELS)
        if (ids.length) {
          setOpen(ids)
          geoRef.current = s.geo ?? {}
          // Normalise the saved stacking values back down to 20, 21, 22… in the
          // order they were already in. The counter only ever climbs and it is
          // persisted, so across a long-lived install it creeps upward one click
          // at a time with nothing to stop it. Rewriting on load keeps the ORDER
          // — the only part of it anyone can see — and throws away the
          // magnitude, so the numbers cannot run away over months of use.
          Object.values(geoRef.current)
            .sort((a, b) => (a.z || 0) - (b.z || 0))
            .forEach((g, i) => { g.z = 20 + i })
          // The stacking counter has to resume above the restored values, or
          // the first grab after a reload assigns a z BELOW panels that were
          // raised in an earlier session and the panel you just grabbed sinks.
          zRef.current = Math.max(zRef.current, ...Object.values(geoRef.current).map((g) => g.z || 0))
          if (s.mode === 'locked' && s.tree) {
            const t = pruneTree(s.tree)
            setMode('locked')
            setTree(t ?? { leaf: ids[0] })
          }
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
  /* A panel is a window on a desk, and a desk does not let you shove a window
     off its edge and lose it. BOTH axes clamp the WHOLE rectangle inside the
     board, not just a grabbable sliver of the drag head: the old
     `-(w - 90)` / `height - 26` slack kept the head reachable but let the far
     edge sit outside a host that paints `overflow: visible`, and that overhang
     grew the DOCUMENT — dragging a panel hard right or hard down put a
     scrollbar on the page and parked the panel past the dock, in blank space.
     Containment also means a panel can never come to rest under the dock strip,
     because the dock lives outside the board box entirely. */
  const clampPx = (p: { x: number; y: number; w: number; h: number }) => {
    const r = rect()
    p.w = I.clamp(p.w, MIN_W, Math.max(MIN_W, r.width))
    p.h = I.clamp(p.h, MIN_H, Math.max(MIN_H, r.height))
    p.x = I.clamp(p.x, 0, Math.max(0, r.width - p.w))
    p.y = I.clamp(p.y, 0, Math.max(0, r.height - p.h))
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
      const live = geoRef.current[id] ?? { fx: 0, fy: 0, fw: 0.5, fh: 0.5, z: 20 }
      // A guillotine cut through several identical full-board rectangles cannot
      // recover the arrangement the user actually made, so a panel still SITTING
      // at full board locks from the rectangle underneath it. The test is the
      // live rectangle, not `pre` alone: a maximised panel that has since been
      // dragged or resized has a perfectly good rectangle of its own on screen,
      // and locking from a stale `pre` would tile the board from a shape the
      // user can no longer see.
      const full = live.fw > 0.99 && live.fh > 0.99
      const g = full && live.pre ? live.pre : live
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

  /* ---- external focus requests -------------------------------------------
     The sidebar's Workspace entries navigate here. Nothing is faked: the
     request goes through the same `openPanel` the dock button uses, so the
     panel is really opened, really selected, and really written to
     LAYOUT_KEY — reload and it is still there.

     No dependency array on purpose (the ResizeObserver effect above does the
     same): this must read the CURRENT `open`, and a nonce compared against a
     ref is a tighter guard than any dep list would be. -------------------- */
  const servedNonce = useRef(0)
  useEffect(() => {
    if (!restored || !focus || focus.nonce === servedNonce.current) return
    servedNonce.current = focus.nonce
    const { id } = focus
    if (!open.includes(id)) openPanel(id)
    setActive(id)
    // The frame after: a panel that was just opened has no element yet.
    // Focusing the head is enough to finish the job — it is the panel's own tab
    // stop, so this lands a keyboard user exactly where tabbing to it would,
    // and `onFocusCapture` on the frame runs selectPanel, which raises the
    // panel in loose mode and persists the new stacking order.
    requestAnimationFrame(() => {
      boardRef.current
        ?.querySelector<HTMLElement>(`[data-panel="${id}"] [data-head]`)
        ?.focus()
    })
  })

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

  /* ---- maximise (loose only) ---------------------------------------------
     Windows-11 behaviour: double-clicking the header toggles it, and a control
     beside the close button does the same for anyone who would rather click or
     tab to it. Restore replays the EXACT fractions the panel had — `pre` is
     stored, never recomputed — so a maximise round-trip is lossless.

     Maximised is a LATCHED state, not a shape. `pre` says a restore rectangle
     is waiting; it does not claim the panel is still full-board. Everything
     that reshapes a panel — an edge handle, a header drag, an Alt+arrow snap —
     leaves `pre` alone, because the alternative throws the restore rectangle
     away the moment a maximised panel is nudged, and the user is then left
     rebuilding by hand a size the app was already holding. A restore is the
     only thing that clears `pre`, which is what it is for.

     `pre` is PERSISTED alongside the geometry rather than cleared on unload,
     and that is deliberate. Because the maximised rectangle is written to
     fx/fy/fw/fh while the real one is parked in `pre`, a reload restores both:
     the panel comes back maximised, and the control that puts it back is still
     sitting in its header. Clearing on unload would also avoid stranding a
     layout, but `beforeunload` and `pagehide` do not fire reliably — a killed
     tab, bfcache, mobile Safari — and the one reload where it fails to fire is
     the reload that hands the user a full-board panel whose original rectangle
     has already been overwritten. Persisting cannot fail that way. */
  const isMaxed = (id: PanelId) => Boolean(geoRef.current[id]?.pre)

  const toggleMax = useCallback((id: PanelId) => {
    if (mode !== 'loose') return
    const g = geoRef.current[id]
    if (!g) return
    if (g.pre) {
      g.fx = g.pre.fx; g.fy = g.pre.fy; g.fw = g.pre.fw; g.fh = g.pre.fh
      delete g.pre
    } else {
      g.pre = { fx: g.fx, fy: g.fy, fw: g.fw, fh: g.fh }
      g.fx = 0; g.fy = 0; g.fw = 1; g.fh = 1
    }
    // Filling the board with a panel is also choosing it, so it selects and
    // raises — a maximised panel sitting under another one would be absurd.
    setActive(id)
    g.z = ++zRef.current
    applyGeo(id)
    // geoRef is a ref, so nothing above would re-render on its own, and both
    // the header icon and its aria-pressed read from it.
    repaint()
    save()
  }, [mode, save, repaint])

  /* ---- drag + resize (loose only) ---- */
  const startDrag = (id: PanelId) => (e: React.PointerEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('button')) return
    const el = e.currentTarget as HTMLElement
    const g = geoRef.current[id]
    if (!g) return
    // From where the panel actually IS, not where the fractions say it is: a
    // board that has shrunk since the geometry was written renders the panel
    // clamped inside it while the stored fractions still point outside, and
    // reading them raw here would make the first grab jump.
    const start = clampPx(toPx(g))
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
    const s = clampPx(toPx(g))
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
      // `pre` deliberately SURVIVES a snap. Alt+arrow is the keyboard's only
      // way to reshape a panel, so it has to leave exactly the state a pointer
      // resize leaves — restore rectangle latched, control still able to put
      // the panel back where it started. Clearing it here would make the
      // keyboard path lose a rectangle the mouse path keeps.
      g.fx = s[0]; g.fy = s[1]; g.fw = s[2]; g.fh = s[3]; g.z = ++zRef.current
      applyGeo(id)
      repaint()
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
  const frame = (id: PanelId, extra?: string) => {
    const loose = mode === 'loose'
    const maxed = loose && isMaxed(id)
    return (
    <section
      key={id}
      data-panel={id}
      data-active={active === id ? 'true' : undefined}
      data-maxed={maxed ? 'true' : undefined}
      aria-label={`${PANELS[id].title} panel`}
      onPointerDownCapture={() => selectPanel(id)}
      onFocusCapture={() => selectPanel(id)}
      /* Escape restores a maximised panel — but handled HERE, on the panel,
         rather than pushed onto the LIFO escape stack in pickers.tsx. That
         stack is for transient layers; maximised is a state a panel can hold
         for hours, and a handler parked on top of the stack for that long
         would swallow the Escape that closes the sidebar the whole time.
         Local means it only fires when focus is already inside this panel, and
         stopping propagation keeps this one keypress from ALSO reaching the
         sidebar's window listener behind it. */
      onKeyDown={maxed ? (e) => {
        if (e.key !== 'Escape') return
        // Escape inside a field belongs to the field, not the window frame.
        if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
        e.preventDefault()
        e.stopPropagation()
        toggleMax(id)
        boardRef.current?.querySelector<HTMLElement>(`[data-panel="${id}"] [data-head]`)?.focus()
      } : undefined}
      className={`pane-cast flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface ${extra ?? ''}`}
      style={loose ? { position: 'absolute' } : undefined}
    >
      <header
        data-head
        tabIndex={0}
        // A maximised panel drags like any other. Refusing the grab only made
        // sense while maximised meant "pinned at full board"; now that the edges
        // resize it too, a head that cannot be moved would leave the panel
        // reshapeable but stranded against the top-left corner.
        onPointerDown={loose ? startDrag(id) : startSwap(id)}
        onDoubleClick={loose ? (e) => {
          if (e.target instanceof HTMLElement && e.target.closest('button')) return
          toggleMax(id)
        } : undefined}
        onKeyDown={headKey(id)}
        aria-label={loose
          ? (maxed
            ? `${PANELS[id].title} — maximised; drag to move, double-click or press Escape to restore`
            : `${PANELS[id].title} — drag to move, double-click to maximise`)
          : `${PANELS[id].title} — drag onto another panel to swap, or Alt with an arrow key`}
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-surface-2 px-2.5 active:cursor-grabbing"
      >
        <h2 className="ui-face text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted">
          {PANELS[id].title}
        </h2>
        <span className="flex-1" />
        {/* Loose only. A locked panel already fills its tile exactly, so the
            control there would be a button that visibly does nothing — the
            honest thing is for it not to be there. */}
        {loose && (
          <button
            type="button"
            aria-pressed={maxed}
            aria-label={`${maxed ? 'Restore' : 'Maximise'} ${PANELS[id].title}`}
            onClick={() => toggleMax(id)}
            className="rounded p-0.5 text-muted transition-colors motion-reduce:transition-none hover:bg-brand/20 hover:text-foreground"
          >
            {maxed
              ? <Minimize2 size={12} aria-hidden="true" />
              : <Maximize2 size={12} aria-hidden="true" />}
          </button>
        )}
        <button type="button" aria-label={`Close ${PANELS[id].title}`} onClick={() => closePanel(id)}
          className="rounded px-1 text-muted hover:bg-brand/20 hover:text-foreground">✕</button>
      </header>
      <div className="pt-pad min-h-0 flex-1 overflow-auto">
        <PanelBody id={id} ctx={ctx} />
      </div>
      {/* Handles stay while maximised. Full board is a starting size, not a
          cage: pulling an edge in from it is how you get a big-but-not-total
          panel without first restoring, losing that size, and dragging it back
          out. clampPx still owns containment, so a panel reshaped from full
          board is as unable to overhang the board as any other. */}
      {loose && ['n','s','e','w','nw','ne','sw','se'].map((d) => (
        <span key={d} onPointerDown={startResize(id, d)} className={handleClass(d)} />
      ))}
    </section>
    )
  }

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

  /* Taskbar semantics, and they are load-bearing rather than a flourish.
     A panel that sits UNDER another cannot have its header controls clicked at
     all — maximise and close live at the far right of the head, which is
     exactly the strip a cascading overlap covers, so the click lands on the
     panel in front instead. That is why the maximise icon appeared to work
     "only when nothing else is open": it was never being pressed. Nothing in
     the header can fix that, because the header is the thing being covered.
     The dock can, because the dock is never covered. So, like a Windows
     taskbar: clicking a panel that is open but behind raises it to the front;
     clicking the one already in front closes it. Every panel's controls are
     therefore one click away no matter what is stacked on top of it. */
  const dockAction = (id: PanelId): 'open' | 'raise' | 'close' => {
    if (!open.includes(id)) return 'open'
    // Only loose mode has a stacking order to be behind. A locked tile is
    // always fully visible, so there is nothing to raise it out of.
    if (mode === 'loose' && active !== id) return 'raise'
    return 'close'
  }

  const dock = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-background px-3 py-2">
      {(Object.keys(PANELS) as PanelId[]).map((id) => {
        const act = dockAction(id)
        return (
        <button key={id} type="button"
          aria-label={`${act === 'open' ? 'Open' : act === 'raise' ? 'Bring to front' : 'Close'} ${PANELS[id].title}`}
          onClick={() => {
            if (act === 'open') return openPanel(id)
            if (act === 'close') return closePanel(id)
            selectPanel(id)
            // Focus the head, not the panel body: it is the panel's own tab
            // stop, so a keyboard user lands where tabbing would have put them,
            // one Tab away from the maximise and close buttons they came for.
            boardRef.current
              ?.querySelector<HTMLElement>(`[data-panel="${id}"] [data-head]`)
              ?.focus()
          }}
          className={`ui-face rounded-md border px-2 py-1 text-[0.62rem] uppercase tracking-wider transition-colors
            ${open.includes(id) ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border text-muted hover:text-foreground'}`}>
          {PANELS[id].title}
        </button>
        )
      })}
      <span className="flex-1" />
      <span className="num hidden text-[0.62rem] text-muted md:inline">
        {mode === 'loose'
          ? 'Drag a head to move · edges and corners resize · a dock button brings a panel to the front'
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
      {/* `z-0` here is LOAD-BEARING, not decoration — the prototype carried
          exactly this rule on #views and it was lost in the port. Selecting a
          loose panel raises its inline z-index off a counter that only ever
          climbs and is written to storage, so with `position: relative` and
          `z-index: auto` this host establishes no stacking context and those
          values escape into the ROOT one. They then beat the chrome: measured
          at 88 after sixty panel clicks in a single session, which is past the
          z-[80] the sidebar "+" and Theme popovers portal to <body> with — the
          popover opens and a board panel is what the pointer actually hits.
          A stacking context here contains the counter permanently, whatever it
          climbs to. Do not delete this.

          `overflow-clip` is the second half of the same containment, for the
          geometry rather than the paint order: clampPx already keeps every
          panel inside the board, and this makes that structural instead of
          arithmetic, so no rounding or future slack can grow the document a
          scrollbar. `clip` and not `hidden` — this must not quietly become a
          scroll container of its own. */}
      <div ref={boardRef}
        className={`pt-pad relative z-0 min-h-0 flex-1 overflow-clip ${mode === 'locked' ? 'flex' : ''}`}>
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
  // Merged, "Do this next" could be pointing at any project — without the
  // label the panel names a task the user cannot place.
  const from = isAllScope(ctx.activeProject) && n
    ? ctx.projects.find((p) => p.id === n.task.project_id)
    : null
  return (
    <>
      {n ? (
        <div className="mb-3">
          <p className="ui-face mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted">Do this next</p>
          <p className="text-sm font-semibold leading-snug">{n.task.title}</p>
          <p className="num mt-0.5 text-[0.65rem] text-muted">
            {from && (
              <>
                <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                  style={{ background: projectTone(from.color) }} />
                {from.name} ·{' '}
              </>
            )}
            {n.why}
          </p>
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
    // The All sentinel is not a project id; a note stamped with it would never
    // match a project filter again. All means "filed under none".
    const project = isAllScope(ctx.activeProject) ? null : ctx.activeProject
    commit([{ id: `n${Date.now().toString(36)}`, ts: Date.now(), project, text }, ...notes])
    setV('')
  }

  return (
    <>
      <textarea
        value={v} rows={2} name="note" aria-label="New note"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() } }}
        placeholder="A thought about a task, a project, anything not worth filing yet…"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      {/* Notes have no table, so they cannot follow the account. Saying so is
          not optional: without it, clearing site data or opening the app on a
          second device silently loses work the user believed was saved. */}
      <p className="num mt-1 text-[0.6rem] text-muted">
        Saved on this device only — not synced to your account.
      </p>
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
