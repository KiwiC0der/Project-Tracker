import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ShaderMount,
  getShaderColorFromString,
  liquidMetalFragmentShader,
} from '@paper-design/shaders'

/* ============================================================================
   LIQUID METAL BUTTON

   Ported from the 21st.dev component of the same name (@paper-design/shaders).
   The signature effect — a chrome rim rendered by the liquid-metal fragment
   shader — is kept intact. Four things from the original were not shippable
   here and were rebuilt:

   1. CONTRAST. The original painted the label `#666666` on a `#202020→#000000`
      slab: 2.84:1 at the top of that gradient, 3.66:1 at the bottom. AA wants
      4.5:1. The label is now `--color-foreground` on a slab made of
      `--color-surface-2 → --color-background`, a pairing this app's palettes
      already guarantee — the worst of the twenty-two is 12.75:1 (clay/dark),
      measured with the WCAG relative-luminance formula, not judged by eye.

   2. THEMING. The original hardcoded black. This app has eleven families in
      light and dark, all driven by CSS custom properties, so a fixed black
      slab reads as broken on Paper or Bone. Every surface, the label, the
      border and the focus ring now come from tokens; the shader is handed
      `--color-surface` and `--color-brand` as its background and tint, and
      re-reads them when `data-theme`/`data-mode` change on <html>.

   3. REDUCED MOTION. The original ran a permanent rAF loop at speed 0.6–2.4
      and ignored the global `prefers-reduced-motion` rule in index.css. The
      shader is no longer mounted at all when reduced motion is preferred, and
      matchMedia is *subscribed to*, not sampled once, so flipping the OS
      setting swaps the button live.

   4. ACCESSIBILITY / ROBUSTNESS. The original stacked decorative divs above a
      transparent button in a 3D transform sandwich with `outline: none`. Here
      the <button> is the root, the decoration is aria-hidden and
      pointer-events-none inside it, and :focus-visible draws a brand outline.
      WebGL is optional: a throw, a missing context or a lost context all fall
      back to the static token-coloured button instead of taking the tree down.
      (The original's cleanup called `.destroy()`, which ShaderMount does not
      have — every unmount leaked a WebGL context. The real method is
      `.dispose()`.)
   ========================================================================== */

const STYLE_ID = 'liquid-metal-button-styles'

/** Injected once. The canvas rule has to reach a node ShaderMount creates
    itself, and the focus ring has to survive the `outline: none` that the
    surrounding reset applies to buttons. */
const CSS = `
.lmb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
.lmb[disabled] { cursor: not-allowed; opacity: .55; }
.lmb:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
.lmb__shader,
.lmb__slab,
.lmb__ink {
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
}
.lmb__shader { inset: 0; overflow: hidden; z-index: 0; }
.lmb__shader canvas {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  border-radius: 999px !important;
}
.lmb__slab { inset: 2px; z-index: 1; }
.lmb__ink  { inset: 0; overflow: hidden; z-index: 2; }
.lmb__label {
  position: relative;
  z-index: 3;
  color: var(--color-foreground);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}
.lmb__ripple {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--color-brand) 55%, transparent) 0%, transparent 70%);
  animation: lmb-ripple .6s ease-out forwards;
}
@keyframes lmb-ripple {
  from { transform: translate(-50%, -50%) scale(0);  opacity: .6; }
  to   { transform: translate(-50%, -50%) scale(4);  opacity: 0;  }
}
@media (prefers-reduced-motion: reduce) {
  .lmb__ripple { display: none; }
}
`

function useInjectedStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

/** Subscribed, not sampled: a user who turns the OS setting on mid-session
    should see the shader go away without a reload. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** Bumps a counter whenever the theme family or light/dark mode changes, so
    the shader's colour uniforms can be re-read from the cascade. */
function useThemeRevision(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const obs = new MutationObserver(() => setRev((n) => n + 1))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode'],
    })
    return () => obs.disconnect()
  }, [])
  return rev
}

type Rgba = [number, number, number, number]

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function shaderColors(): { u_colorBack: Rgba; u_colorTint: Rgba } {
  const back = getShaderColorFromString(token('--color-surface', '#0e0e14'))
  const tint = getShaderColorFromString(token('--color-brand', '#7c5cff'))
  return {
    u_colorBack: [back[0], back[1], back[2], 1] as Rgba,
    // Colour burn at full strength crushes the chrome; a third of it is enough
    // to read as "this theme's metal" while keeping the specular highlights.
    u_colorTint: [tint[0], tint[1], tint[2], 0.34] as Rgba,
  }
}

const SIZES = {
  text: { width: 142, height: 46 },
  icon: { width: 46, height: 46 },
} as const

export interface LiquidMetalButtonProps {
  /** Visible text, and the accessible name in compact mode. Required — a
      button with no discernible name is a WCAG 4.1.2 failure. */
  label: string
  onClick?: () => void
  /** Rendered before the label, or alone when `compact`. */
  icon?: React.ReactNode
  /** Icon-only 46x46 pill. `label` becomes the aria-label. */
  compact?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  /** Forwarded to the <button>, e.g. to point at the dialog it opens. */
  'aria-haspopup'?: React.AriaAttributes['aria-haspopup']
  'aria-expanded'?: boolean
}

export function LiquidMetalButton({
  label,
  onClick,
  icon,
  compact = false,
  disabled = false,
  type = 'button',
  className = '',
  'aria-haspopup': ariaHasPopup,
  'aria-expanded': ariaExpanded,
}: LiquidMetalButtonProps) {
  useInjectedStyles()
  const reduced = usePrefersReducedMotion()
  const themeRev = useThemeRevision()
  const uid = useId()

  const host = useRef<HTMLSpanElement>(null)
  const mount = useRef<ShaderMount | null>(null)
  const rippleSeq = useRef(0)

  // Starts optimistic; any WebGL problem flips it and never flips back for
  // this mount, which is what "degrade, do not retry into a stall" means.
  const [glOk, setGlOk] = useState(true)
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])

  const animated = !reduced && glOk
  const dims = compact ? SIZES.icon : SIZES.text

  /* ---- shader lifecycle -------------------------------------------------- */
  useEffect(() => {
    if (reduced || !glOk) return
    const el = host.current
    if (!el) return

    let canvas: HTMLCanvasElement | null = null
    const onLost = (e: Event) => { e.preventDefault(); setGlOk(false) }

    try {
      const m = new ShaderMount(
        el,
        liquidMetalFragmentShader,
        {
          ...shaderColors(),
          u_repetition: 4,
          u_softness: 0.5,
          u_shiftRed: 0.3,
          u_shiftBlue: 0.3,
          u_distortion: 0,
          u_contour: 0,
          u_angle: 45,
          u_scale: 8,
          u_shape: 1,
          u_offsetX: 0.1,
          u_offsetY: -0.1,
          u_isImage: false,
        },
        undefined,
        0.6,
        undefined,
        // The chrome is a 2px rim. Rendering it at 2x device pixels over a
        // 142x46 box is pure waste, so the ratio and pixel budget are capped.
        1,
        142 * 46 * 4,
      )
      canvas = el.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      canvas.addEventListener('webglcontextlost', onLost)
      mount.current = m
    } catch {
      // Blocked WebGL, a software-rendering blocklist, or an old device.
      // The static button below is a complete substitute, so this is not
      // worth a console entry on every page load.
      // ShaderMount appends its canvas before it asks for a context, so a
      // failure leaves a contextless one behind on top of the static gradient.
      el.querySelectorAll('canvas').forEach((c) => c.remove())
      setGlOk(false)
      return
    }

    return () => {
      canvas?.removeEventListener('webglcontextlost', onLost)
      try { mount.current?.dispose() } catch { /* already gone */ }
      mount.current = null
    }
  }, [reduced, glOk])

  /* ---- re-tint on theme change ------------------------------------------- */
  useEffect(() => {
    if (!mount.current) return
    try { mount.current.setUniforms(shaderColors()) } catch { setGlOk(false) }
  }, [themeRev, animated])

  /* ---- speed follows interaction ----------------------------------------- */
  const speed = useCallback((v: number) => {
    if (!animated) return
    try { mount.current?.setSpeed?.(v) } catch { /* non-fatal */ }
  }, [animated])

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (animated) {
      speed(2.4)
      window.setTimeout(() => speed(hovered ? 1 : 0.6), 300)
      // detail === 0 means the click came from Enter/Space, which has no
      // meaningful pointer position to ripple from.
      if (e.detail > 0) {
        const r = e.currentTarget.getBoundingClientRect()
        const id = rippleSeq.current++
        setRipples((p) => [...p, { id, x: e.clientX - r.left, y: e.clientY - r.top }])
        window.setTimeout(() => setRipples((p) => p.filter((x) => x.id !== id)), 600)
      }
    }
    onClick?.()
  }

  /* ---- presentation ------------------------------------------------------ */
  const slab = 'linear-gradient(180deg, var(--color-surface-2) 0%, var(--color-background) 100%)'

  const shadow = pressed
    ? '0 0 0 1px var(--color-border), inset 0 2px 4px rgba(0,0,0,.28)'
    : hovered
      ? '0 0 0 1px var(--color-border), 0 8px 16px -8px rgba(0,0,0,.35), 0 2px 4px rgba(0,0,0,.14)'
      : '0 0 0 1px var(--color-border), 0 12px 22px -14px rgba(0,0,0,.30), 0 1px 2px rgba(0,0,0,.10)'

  return (
    <button
      type={type}
      className={`lmb ${className}`.trim()}
      style={{
        width: dims.width,
        height: dims.height,
        boxShadow: shadow,
        transform: pressed ? 'translateY(1px)' : 'none',
        transition: 'box-shadow .15s cubic-bezier(.4,0,.2,1), transform .15s cubic-bezier(.4,0,.2,1)',
      }}
      onClick={handleClick}
      onPointerEnter={() => { setHovered(true); speed(1) }}
      onPointerLeave={() => { setHovered(false); setPressed(false); speed(0.6) }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      disabled={disabled}
      aria-label={compact ? label : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      data-shader={animated ? 'on' : 'off'}
    >
      {/* The metal. When the shader cannot run this same box holds a static
          token gradient, so the rim never disappears — it just stops moving. */}
      <span
        ref={host}
        aria-hidden="true"
        className="lmb__shader"
        id={`${uid}-metal`}
        style={
          animated
            ? undefined
            : {
                background:
                  'linear-gradient(135deg, var(--color-brand-soft) 0%, var(--color-border) 38%, var(--color-brand) 62%, var(--color-border-soft) 100%)',
              }
        }
      />

      {/* The slab the label sits on. Verified >= 12.75:1 against
          --color-foreground across all twenty-two palettes. */}
      <span aria-hidden="true" className="lmb__slab" style={{ background: slab }} />

      <span aria-hidden="true" className="lmb__ink">
        {ripples.map((r) => (
          <span key={r.id} className="lmb__ripple" style={{ left: r.x, top: r.y }} />
        ))}
      </span>

      {icon && (
        <span aria-hidden="true" className="lmb__label" style={{ display: 'inline-flex' }}>
          {icon}
        </span>
      )}
      {!compact && <span className="lmb__label">{label}</span>}
    </button>
  )
}

export default LiquidMetalButton
