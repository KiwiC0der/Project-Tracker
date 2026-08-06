# Project Tracker — Teardown

An honest audit of what exists today, written before any redesign work, so the
five directions in [`public/explorations/`](../public/explorations/) are answering real
problems rather than inventing them.

Audited at commit `735d317`, 25 files, ~64KB TypeScript.

---

## 1. What is actually here

```
src/
  App.tsx                   93   scene state machine: loading → hero → auth → dashboard
  main.tsx                   9
  index.css                427   design tokens (23 lines) + hamster loader CSS (330 lines)
  lib/
    store.ts               363   dual backend: Supabase, or localStorage demo
    supabase.ts             25   build-time client, null when unconfigured
    utils.ts                 6   cn()
  scenes/
    HeroScene.tsx           50   prism shader + one CTA
    AuthScene.tsx          222   sign in / sign up
    DashboardScene.tsx     554   sidebar + stat cards + drag-and-drop board
  components/ui/
    sidebar.tsx            199   push panel at md+, overlay below
    list.tsx               138   dnd-kit board primitives
    web-gl-shader.tsx      133   chromatic prism, raw GLSL
    dot-matrix-shader.tsx  169   animated dot grid, GLSL3
    hamster-loader.tsx      27
supabase/schema.sql        200   profiles / projects / tasks + RLS + seed function
```

**The stack is well chosen and the engineering is genuinely careful.** That is
worth saying plainly before the criticism, because the criticism is all about
product surface, not craft:

- Row Level Security is correct — every policy is scoped to `auth.uid()`, and
  `tasks_insert_own` additionally verifies the parent project belongs to you.
  That is the check most people forget.
- `three` and `react` are split into their own Rollup chunks, and the shader
  scenes are `lazy()`, so the 460KB three.js payload never blocks first paint.
- Both shaders cap `devicePixelRatio` at 1.5, cancel their rAF on
  `visibilitychange`, and dispose geometry/material/renderer on unmount. The
  prism shader checks `prefers-reduced-motion` and freezes `time`.
- `sidebar.tsx` sets `.inert` as an IDL property rather than a JSX prop,
  because React 18 silently drops the JSX form. That is a real bug most
  codebases ship.
- Optimistic drag with rollback on failure in `handleDragEnd`.
- The demo-mode fallback means a fresh clone is explorable instead of a dead
  login screen.

This is not a codebase that needs rescuing. It is a codebase that has run out
of product.

---

## 2. The core problem

**Project Tracker is a beautiful front door attached to a very small house.**

The hero is a WebGL prism. The auth screen is a GLSL dot matrix. The loader is a
hand-animated hamster. And then you sign in and land on… four stat cards and a
three-column board where you add tasks through `window.prompt()`.

The visual ambition is entirely spent before the user reaches the product. Every
frame of shader work happens on screens the user sees **once**, and the screen
they will look at a thousand times has none of it.

That inversion is the single most important finding in this document.

### The evidence, concretely

| Screen | Time spent there | Design investment |
|---|---|---|
| Loader | ~1.4s, once | 330 lines of bespoke CSS animation |
| Hero | ~5s, once | Custom GLSL, chromatic aberration |
| Auth | ~20s, once | Second custom GLSL shader |
| **Dashboard** | **all remaining time, forever** | **4 bordered divs and a progress bar** |

`App.tsx:36` even holds the loader open artificially — `Math.max(0, 1400 - elapsed)`
— to make sure you see the hamster. The app is optimised for its own trailer.

---

## 3. Specific findings

### 3.1 `window.prompt()` is the entire task-creation UX

`DashboardScene.tsx:135` and `:158`:

```js
const title = window.prompt('Task title')?.trim()
const name = window.prompt('Project name')?.trim()
```

A task has `notes`, `priority`, `position`, `due_date` in the schema. The UI can
set exactly one of them: `title`. Priority is always `'medium'` on creation and
**can never be changed afterwards** — it renders as a coloured chip
(`DashboardScene.tsx:511`) with no control attached. `due_date` is in the
database, in the TypeScript type, and is never read or written anywhere in the
UI. `notes` likewise.

The data model is roughly three times richer than the interface exposes.

### 3.2 Nothing can be edited

There is no task detail view, no edit affordance, no inline rename. `updateTask`
is only ever called with `{ status }` from the drag handler. `updateProject` is
exported from `store.ts:240` and **never imported anywhere**. A typo in a task
title is permanent — your only recourse is delete and retype.

The seeded starter task literally says *"Click a task to edit it"*
(`schema.sql:195`). Clicking a task does nothing. The app ships with an
instruction to use a feature that does not exist.

### 3.3 Position is stored but never ordered

`position` exists on both tables, is indexed (`tasks_project_idx` is
`(project_id, status, position)`), is sorted by on read
(`DashboardScene.tsx:499`) — and can never be changed by the user. Dropping a
task on a column sets `status` only; `handleDragEnd` ignores where in the column
you dropped it. You can move a task between columns but not reorder within one.
`@dnd-kit/modifiers` is in `package.json` and is never imported.

### 3.4 Three of six nav items are locked

Calendar, Reports and Settings render disabled with a padlock and
`title="Not built yet"` (`DashboardScene.tsx:249-270`). Half the primary
navigation is a promise. This is honest, which is better than a broken link, but
it means the sidebar is mostly advertising.

### 3.5 The dashboard has no information in it

The Overview computes six numbers — projects, todo, doing, done, total, pct —
and displays five of them as large digits. There is no trend, no history, no
per-project breakdown, no due-date awareness, no sense of whether things are
getting better or worse. `stats` is derived from `tasks.length` and nothing else.

A user cannot answer any of these from this dashboard:

- Am I speeding up or slowing down?
- What is overdue?
- What should I do next?
- Will I finish this project this month?
- What did I get done last week?

Every one of those is computable from data the app already stores. None are
computed.

### 3.6 No search, no filter, no keyboard entry point

No search field anywhere. No filter by priority, tag or date. No command
palette. No keyboard shortcut to add a task. For an app whose entire audience is
people who work at a keyboard all day, the fastest way to add a task is: click
sidebar, click New project or scroll to a column, click Add task, type into a
native browser modal, press Enter.

### 3.7 One project at a time, and no cross-project view

`activeProject` is a single string. The board shows one project. The stat cards
show *all* projects aggregated. There is no view that shows tasks from several
projects together — no "everything due this week", no "all my high-priority
work". With four projects on the go, that is the view you actually want.

### 3.8 Alerts are a one-line div

Errors set a string and render a dismissible red bar. Success is silent. Nothing
confirms a task was created, moved or deleted. Deletion of a project uses
`window.confirm`; deletion of a task has no confirmation and no undo, and it is
a destructive action one click away from a drag handle.

### 3.9 Design-token surface is thin

`index.css` defines 13 colours and one font stack. There is no type scale, no
spacing scale, no radius scale, no easing tokens, no elevation. Every size in the
app is a raw Tailwind utility, so `rounded-xl` / `rounded-lg` / `rounded-full`
are chosen ad hoc and `text-2xl` / `text-3xl` / `text-sm` / `text-xs` /
`text-[0.65rem]` / `text-[0.7rem]` all appear. Six one-off font sizes is a sign
there is no scale.

Also: `--color-todo`, `--color-doing` and `--color-done` are declared as tokens
and then **not used** — `COLUMNS` in `DashboardScene.tsx:52` hardcodes
`#6b7280`, `#f59e0b`, `#10b981` instead. The tokens and the values agree today
by luck, and will drift.

### 3.10 Smaller things

- `AuthScene` requires ≥6 characters, Supabase's own default. Fine, but there is
  no strength feedback, no show/password toggle, and no forgotten-password flow
  at all — a real dead end for a real account.
- `hero` is the signed-out landing, but there is no route for it — signing out
  returns to hero with the same URL. No routing at all: the whole app is one
  `useState<Scene>`. Deep links, back button, and "share this project" are all
  impossible by construction.
- The dot-matrix shader uses `precision mediump float` with GLSL3 and integer
  array indexing (`u_colors[int(show_offset * 6.0)]`); `show_offset` is
  `random()` output which can reach 1.0, indexing element 6 of a 6-element
  array. In practice GLSL clamps, but it is an out-of-range index.
- No tests, no linting config, no CI. `npm run build` uses `tsc -b --noCheck`,
  which explicitly turns off type checking at build time.
- `tsconfig.tsbuildinfo` is committed to the working tree.

---

## 4. What the redesign has to fix

Ranked by how much they change the product, not by effort:

1. **Move the ambition into the app.** The dashboard is where the design budget
   belongs. Shaders behind the *working* surface, not just the front door.
2. **Make the data model reachable.** Priority, due date, notes and estimate
   already exist. Expose them.
3. **Give the dashboard something to say.** Velocity, forecast, overdue
   pressure, staleness, "do this next" — all derivable from existing rows.
4. **Make history visible.** The app throws away every state change. A tracker
   that cannot tell you what happened last week is a to-do list.
5. **Keyboard as a first-class input.** Command entry, not `window.prompt`.
6. **Cross-project views.** Four projects, one board, no way to see across them.
7. **Editing and undo.** Nothing is currently correctable.

---

## 5. How the five directions map to those problems

Each exploration in [`public/explorations/`](../public/explorations/) attacks the same list
from a different angle. All five run on the identical shared engine
(`public/explorations/_kernel.js`), which implements every capability in §4 — so the
comparison is purely one of design.

| Direction | Bets on | Best if you value |
|---|---|---|
| **TERMINAL** | Keyboard is the whole interface; the board is text | Speed, history as a log, zero mouse |
| **ORBIT** | Physics carries the information; urgency is spatial | Seeing priority without reading |
| **BROADSHEET** | Editorial hierarchy beats widget scanning | Calm, print, narrative, one clear lead |
| **WORKBENCH** | Adjacency — many live panels at once | Power use, Gantt + graph + board together |
| **PULSE** | Ambient state you feel before you read | A second monitor, mood, momentum |

See [`FEATURE-VAULT.md`](./FEATURE-VAULT.md) for the full catalogue of the
capabilities these directions introduce, with the kernel function behind each.
