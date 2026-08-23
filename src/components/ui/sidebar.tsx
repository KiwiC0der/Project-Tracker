import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Scene 5 — collapsible sidebar.
 *
 * A persistent push-layout panel, not a modal drawer: closed by default,
 * toggled only by <SidebarTrigger> (or Escape) — never by clicking outside
 * or by navigating — and the main content stays fully usable and reflows
 * around it as it opens and closes.
 */

type SidebarContextValue = {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>')
  return ctx
}

export function SidebarProvider({
  children,
  defaultOpen = false,
}: {
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle: () => setOpen(!open) }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function Sidebar({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useSidebar()
  const asideRef = useRef<HTMLElement>(null)

  // Escape is a keyboard convenience, not "click outside" — it doesn't
  // conflict with "only the trigger toggles this."
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // `inert` as a JSX prop is silently dropped pre-React 19 (this app is on
  // React 18) — React warns and never calls setAttribute. Setting the IDL
  // property directly on the node is version-safe and is what actually
  // removes the collapsed sidebar from tab order and the accessibility
  // tree — still needed even though it's zero-width rather than off-screen.
  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = !open
  }, [open])

  return (
    <>
      {/* Backdrop — only below md. Below that width a 16rem panel can't
          push content aside without crushing it, so the sidebar overlays
          instead and the backdrop is what makes "tap away to dismiss"
          make sense there. At md+ this never renders. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        ref={asideRef}
        // A valid target for programmatic focus without adding a stop of its
        // own to the normal Tab sequence.
        tabIndex={-1}
        className={cn(
          // Below md: fixed overlay, slides in via transform, sits above the
          // backdrop and the page.
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[16rem] flex-col overflow-hidden bg-surface shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
          // md+: a persistent push panel instead — sticky + width transition
          // rather than fixed + transform, so it stays in flex flow and
          // main content (flex-1 beside it) resizes to fill exactly the
          // space this loses or gains. No overlay, no backdrop; both stay
          // usable at once, which is the whole point above phone widths.
          'md:sticky md:top-0 md:translate-x-0 md:shadow-none md:transition-[width] md:duration-300 md:ease-out',
          open ? 'md:w-[16rem] md:border-r md:border-border' : 'md:w-0',
          className,
        )}
      >
        {/* Fixed-width inner wrapper: the outer element is what animates
            (transform below md, width at md+), so content never
            reflows/wraps mid-transition — it's simply revealed or clipped
            by the parent's overflow-hidden. */}
        <div className="flex h-full w-[16rem] flex-col">{children}</div>
      </aside>
    </>
  )
}

export const SidebarHeader = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-border px-4', className)}>
    {children}
  </div>
)

export const SidebarContent = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('scroll-thin flex-1 overflow-y-auto p-3', className)}>{children}</div>
)

export const SidebarFooter = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('shrink-0 border-t border-border p-3', className)}>{children}</div>
)

export const SidebarGroup = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mb-4', className)}>{children}</div>
)

export const SidebarGroupLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-2 pb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
    {children}
  </p>
)

/**
 * Shared look for the small square controls that sit on a group header row —
 * the "+" that edits what a group contains. Exported as a class rather than a
 * component because every caller needs its own ref on the button (each one is
 * a popover trigger) and wrapping that would only add a forwardRef.
 */
export const sidebarIconButton =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-1 focus-visible:ring-brand'

/**
 * A group whose header collapses it.
 *
 * The header is a real <button> carrying aria-expanded and aria-controls; the
 * chevron is aria-hidden because it says nothing the button does not already
 * announce. `action` sits BESIDE that button, never inside it — a button
 * nested in a button is invalid HTML and screen readers flatten the pair into
 * one confusing control.
 *
 * Collapsing animates `grid-template-rows` from 1fr to 0fr, which is the only
 * way to transition to a content height nobody measured. index.css already
 * neutralises transition-duration under prefers-reduced-motion globally; the
 * `motion-reduce:` variants here say so locally too, so the intent survives
 * anyone editing that block.
 *
 * The collapsed body stays in the DOM (it is mid-transition, and its id is the
 * aria-controls target) so it is made `inert` instead — the same IDL-property
 * assignment <Sidebar> uses, because React 18 silently drops `inert` as a JSX
 * prop. Without it a collapsed group would still hand out tab stops.
 */
export function SidebarCollapsibleGroup({
  label, contentId, open, onToggle, action, className, children,
}: {
  label: string
  contentId: string
  open: boolean
  onToggle: () => void
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (body.current) body.current.inert = !open }, [open])

  return (
    <div className={cn('mb-4', className)}>
      <div className="flex items-center gap-0.5 pb-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={contentId}
          // Visible text is the group name; the accessible name adds the verb.
          // "Collapse Workspace" still contains "Workspace", so the visible
          // label remains a valid speech target.
          aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-1 focus-visible:ring-brand"
        >
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={cn(
              'shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              open ? 'rotate-0' : '-rotate-90',
            )}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="truncate">{label}</span>
        </button>
        {action}
      </div>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        {/* min-h-0 lets the 0fr row actually reach zero — a grid item's
            automatic minimum size would otherwise floor it at min-content. */}
        <div ref={body} id={contentId} className="min-h-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

export const SidebarMenu = ({ children }: { children: ReactNode }) => (
  <ul className="flex flex-col gap-1">{children}</ul>
)

/** Takes li attributes so a caller can hang layout and a `data-` hook off the
    row itself. The sidebar's reorderable project list needs both: the drag
    hit-tests against the <li> rects, and a wrapper div inside the <li> would
    have made the flex row a second element to keep in sync. */
export const SidebarMenuItem = ({
  children,
  className,
  ...props
}: { children: ReactNode } & React.LiHTMLAttributes<HTMLLIElement>) => (
  <li className={className} {...props}>{children}</li>
)

const menuButton = cva(
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none',
  {
    variants: {
      active: {
        true: 'bg-brand/15 text-foreground',
        false: 'text-muted hover:bg-surface-2 hover:text-foreground',
      },
    },
    defaultVariants: { active: false },
  },
)

export type SidebarMenuButtonProps = {
  children: ReactNode
  asChild?: boolean
  className?: string
} & VariantProps<typeof menuButton> &
  React.ButtonHTMLAttributes<HTMLButtonElement>

export function SidebarMenuButton({
  children,
  asChild,
  active,
  className,
  ...props
}: SidebarMenuButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(menuButton({ active }), className)}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function SidebarTrigger({ className }: { className?: string }) {
  const { toggle, open } = useSidebar()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? 'Close sidebar' : 'Open sidebar'}
      aria-expanded={open}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-foreground',
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  )
}
