# Sourced components

Third-party UI adopted into this app rather than hand-written, with where it
came from, what licence it carries, what was changed, and how to take it out
again.

Everything here is gated behind [`src/lib/enhancements.ts`](../src/lib/enhancements.ts).
That file is the rollback switch and carries the authoritative removal
instructions; this document is the provenance record.

---

## Adopted

### 1. sonner — toast notifications

| | |
|---|---|
| **Component** | `Toaster` + the `toast` imperative API |
| **Source** | <https://sonner.emilkowal.ski/> · <https://github.com/emilkowalski/sonner> |
| **Author** | Emil Kowalski |
| **Licence** | MIT |
| **Version** | 2.0.8 |
| **Runtime deps** | none (React 18/19 peer only) |
| **Measured cost** | 35.23 kB min / **9.93 kB gzip** as its own lazy chunk, plus 1.19 kB gzip added to the entry for the wrapper. Its stylesheet is inlined in the JS, so the app's CSS bundle is unchanged at 0 bytes added. |
| **Local wrapper** | [`src/components/ui/toast.tsx`](../src/components/ui/toast.tsx) |

**Why it was needed.** Every mutation in the app was silent on success. Only
failures surfaced, via a banner. Deleting a project made it vanish with no
confirmation and no way back.

**What was adapted.**

- **Repainted onto the design tokens.** This app has eleven palettes x
  light/dark. sonner ships hardcoded greys, so out of the box it looks correct
  in exactly one of the twenty-two. The wrapper rebinds sonner's own custom
  properties (`--normal-bg`, `--normal-text`, `--normal-border`, `--gray2`,
  `--gray5`) to `--color-surface` / `--color-foreground` / `--color-border` /
  `--color-surface-2`, and overrides the handful of colours sonner hardcodes
  rather than exposing as variables (the description grey, the action button,
  the type icons). Verified by sampling computed colours in five palettes.
- **Errors are `brand`, not red.** The app has no red token — its existing
  error banner in `DashboardScene` is `border-brand/40 bg-brand/10`. A
  hardcoded red would be the one element on the page ignoring the palette.
- **A hard cast shadow, not a blurred drop shadow**, matching `.pane-cast` in
  `index.css`. A soft black shadow is invisible on the near-black palettes;
  `index.css` already documents working that out the hard way.
- **Narrowed to four verbs** — `notify.success`, `notify.error`, `notify.info`,
  `notify.undo` — plus `notify.dismissAll`. Call sites never import sonner.
- **Dynamic import behind the flag**, because sonner injects its stylesheet
  into `<head>` as a module side effect at import time. A static import would
  leave a dead `<style>` block in the document with the feature switched off.

**Accessibility** (verified in the browser, not taken on trust): the container
is a `<section aria-live="polite" aria-relevant="additions text"
aria-atomic="false" tabindex="-1">`; toasts render inside it so they are
announced; `document.activeElement` is unchanged across a toast appearing, so
focus is never stolen; the close button is labelled "Close toast"; the list is
reachable on demand via sonner's `alt+T` hotkey.

**Contrast measured** across Original, Paper, Blueprint, Terminal and Ember —
title 15.6–18.5:1, description 4.9–6.4:1, Undo label on the brand fill
5.1–11.3:1. All pass WCAG AA.

**Reduced motion**: three independent blocks apply — the global `*` rule in
`index.css`, sonner's own `@media (prefers-reduced-motion)`, and the wrapper's.
The third is not redundant: sonner's block covers `[data-sonner-toast]` and its
children but not the toaster container's own `transition: transform .4s`.

---

### 2. canvas-confetti — milestone burst

| | |
|---|---|
| **Component** | MagicUI `Confetti` → reduced to its firing logic |
| **Source** | <https://magicui.design/r/confetti.json> (registry item, MIT) over <https://github.com/catdad/canvas-confetti> |
| **Author** | Kiril Vatev (library) · MagicUI (registry wrapper) |
| **Licence** | ISC (canvas-confetti) · MIT (MagicUI) |
| **Version** | 1.9.4 |
| **Runtime deps** | none |
| **Measured cost** | 10.70 kB min / **4.29 kB gzip** as its own lazy chunk, plus ~0.46 kB gzip for the wrapper in whichever chunk imports it. |
| **Local wrapper** | [`src/components/ui/celebrate.tsx`](../src/components/ui/celebrate.tsx) |

**What was adapted.** The MagicUI registry item ships a `<Confetti>` context
provider and a `<ConfettiButton>`, and declares `button` as a
`registryDependency`. None of that was taken: the trigger here is a state
transition, not a click, and the app has its own buttons. What survives is the
firing logic and its option shape, rewritten as one imperative `celebrate()`
function. The `button` registry dependency was deliberately **not** installed.

**Constraints applied.**

- **Hard no-op under `prefers-reduced-motion`**, subscribed via a
  `MediaQueryList` change listener rather than sampled once at load — verified
  by flipping the preference at runtime and confirming the burst starts and
  stops accordingly, with exactly one listener registered.
- **Capped** at 55 particles over 90 ticks (~1.5 s), with a 1.5 s throttle so
  two firings in a row cannot stack canvases.
- **Skipped when `document.hidden`**, so a background tab never animates.
- **Theme colours read at fire time** from `--color-brand`, `--color-brand-soft`
  and `--color-done`, so the burst matches whichever of the 22 palettes is
  active. Verified: firing under Terminal-dark used `#4ade80`.
- **No DOM residue.** canvas-confetti appends its `<canvas>` on fire and removes
  it in `done()`; confirmed by counting canvases before, during and after.

**When to call it.** Only on a real achievement — clearing the *last* open task
in a project. Not on every checkbox. Over-firing turns delight into noise.

---

## Rejected

### MagicUI `NumberTicker` — animated counters

**Source**: <https://magicui.design/docs/components/number-ticker> · MIT

**Rejected on cost.** It requires `motion` (the Framer Motion successor) at
roughly **116 kB gzip** — about half this app's entire current bundle — to
animate a number counting up. The Progress panel's stat tiles ("To do 2",
"Done 1 / 4", "Complete 25%") would have looked slightly nicer ticking into
place.

The reasoning is the useful part, and it generalises: **the dependency has to
be proportionate to the problem.** A 116 kB animation runtime bought a single
cosmetic transition on numbers that are already legible the instant they
render, and it would have been the largest dependency in the project after
three.js. By contrast sonner at 9.93 kB fixes a real gap — the app had no
success feedback at all — and canvas-confetti at 4.29 kB is small enough that
its cost is not the deciding question.

If animated counters are wanted later, the cheap route is a `requestAnimation
Frame` tween over `textContent` in ~30 lines, or CSS `@property` on a custom
property with `counter-reset`. Neither needs a dependency.

---

## Bundle impact

Measured with `vite build` (gzip column), comparing the same working tree with
both flags off and both flags on, so concurrent edits by other work in progress
cancel out.

| Asset | Flags off | Flags on | Delta (gzip) |
|---|---|---|---|
| entry `index-*.js` | 62.25 kB | 63.44 kB | **+1.19 kB** |
| sonner chunk (new, lazy) | — | 9.93 kB | **+9.93 kB** |
| react-dom interop shim (new) | — | 0.10 kB | **+0.10 kB** |
| confetti chunk (new, lazy)¹ | — | 4.29 kB | **+4.29 kB** |
| celebrate wrapper¹ | — | 0.46 kB | **+0.46 kB** |
| `index-*.css` | 11.54 kB | 11.54 kB | **0** |
| `DashboardScene-*.js` | 56.15 kB | 56.15 kB | **0** |

**Total: +15.97 kB gzip**, of which only **+1.65 kB** is in eagerly parsed
code; the remaining 14.3 kB sits in two lazily fetched chunks.

¹ The confetti chunk only appears once a call site imports `celebrate`. Until
then it costs nothing.

---

## Removal

See the header comment of [`src/lib/enhancements.ts`](../src/lib/enhancements.ts)
for the authoritative, step-by-step instructions. In short:

**Temporarily** — flip the flag to `false` and rebuild. Verified to leave zero
trace: no toaster region in the DOM, zero inline `<style>` tags, and neither
chunk requested over the network.

**Permanently** —

| Feature | Delete | Uninstall | Strip call sites |
|---|---|---|---|
| Toasts | `src/components/ui/toast.tsx`, the 2 lines in `src/main.tsx` | `sonner` | `grep -rn "notify\." src` |
| Celebrate | `src/components/ui/celebrate.tsx` | `canvas-confetti` `@types/canvas-confetti` | `grep -rn "celebrate" src` |

Removing both also makes `src/lib/enhancements.ts` and this file redundant.
