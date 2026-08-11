# Project Tracker

A project and task tracker with a tiling dashboard, ten themes, and an analytics
layer computed from your own history.

**Live:** [pt.anteneh.tech](https://pt.anteneh.tech) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

---

## The dashboard

Six panels — List, Progress, Priorities, Stale, Notes, Editor — in two layout
modes. `Alt+Z` toggles.

**Loose.** Panels float and overlap. Drag a head to move; drag any edge or corner
to resize. `Alt`+arrow snaps a panel to that half of the board.

**Locked.** Panels tile the page: nothing overlaps and the page is always full.
Pull a gutter to re-proportion a split. Drag one panel's head onto another to
exchange them — the ratios stay, only the contents trade. `Alt`+arrow swaps with
the spatial neighbour.

Locking preserves the arrangement you actually made. A recursive **guillotine**
turns the floating rectangles into a real split tree, so "one tall panel beside a
stack of three" survives. A flat list of rows cannot represent that shape and
collapses it, which reads as the lock throwing your layout away.

Geometry is stored as **fractions** of the board, never pixels, so a resize is a
pure re-apply — opening and closing the sidebar cannot accumulate drift.

Every panel sits on a **hard offset shadow** — no blur, like a misregistered
print. Selection rides the same object: touch a panel anywhere and it throws a
longer, heavier cast than the rest (and, in loose mode, comes to the front). On
light palettes the cast is black; on dark ones it lights the plate edge instead,
because there is nothing darker than a `#050c08` page to cast onto.

## Insights

[`src/lib/insights.ts`](./src/lib/insights.ts) derives everything from the task
rows you already have:

- **Momentum** — recency-weighted completion velocity, and whether it is rising
- **Landing date** — when the open work runs out at the current pace
- **Staleness** — how long something has gone untouched, on a `(days/21)^1.4` curve
- **Urgency / health** — continuous fields, not buckets
- **Do this next** — a ranked pick that returns its own reasoning, so you can
  disagree with it
- **Quick add** parses `!high @fri /project` out of plain text

The forecast refuses to lie: with no completions on record it returns `Infinity`
and the UI says *no pace*, rather than inventing a date.

## Appearance

Five theme families — Original, Paper, Newsprint, Blueprint, Terminal — each in
light and dark, for ten palettes. Four font presets, all system faces, so nothing
is fetched over the network. Two densities.

Mode and theme are independent axes (`data-mode`, `data-theme` on `<html>`), so
"Blueprint, but light today" is one click. Mode can follow the system and keeps up
when the system changes. Every palette clears WCAG AA on all three surfaces.

Tailwind v4 compiles `bg-surface` to `var(--color-surface)`, which is why
overriding the custom properties re-themes every component without touching one.

## Versions

The sidebar's **Versions** page lists every release and will open a *running build*
of the archived ones, not a screenshot. See [`docs/VERSIONING.md`](./docs/VERSIONING.md).

## Also

- 🔐 Real email + password accounts backed by Supabase
- 🗃️ Projects and tasks isolated per account by Row Level Security
- 🌈 WebGL prism hero and shader auth screen; hamster-wheel loader
- 📅 Calendar, Reports and Settings, all built
- ♿ Keyboard-operable throughout — gutters are `role="separator"` with live values,
  panels move by keyboard, `inert` on the collapsed sidebar
- 🐢 Honours `prefers-reduced-motion`; the shaders idle when the tab is hidden

## Design exploration

Nine complete redesign directions live in [`public/explorations/`](./public/explorations/) —
runnable prototypes, not mockups. All nine share one engine
([`_kernel.js`](./public/explorations/_kernel.js)), so they differ only in design.

```bash
npx serve .          # then open /explorations/
```

| | Direction | Bets on |
|---|---|---|
| 01 | **TERMINAL** | Keyboard is the whole interface; the board renders as text |
| 02 | **ORBIT** | Physics carries the information — urgency is orbital distance |
| 03 | **BROADSHEET** | Editorial hierarchy beats widget scanning |
| 04 | **WORKBENCH** | Adjacency — board, Gantt and graph live at once |
| 05 | **PULSE** | Ambient state you feel before you read |
| 06 | **PRESS ROOM** | Broadsheet × Workbench — floating paper sheets, free geometry |
| 07 | **COMPOSITOR** | Broadsheet × Workbench — panes tiled into a page, nothing overlaps |
| 08 | **COMPOSING ROOM** | Both, on a radio — loose sheets or a locked page, switched losslessly |
| 09 | **DASHBOARD** | The production candidate — that board inside the real app's sidebar and views |

Background reading: [`docs/TEARDOWN.md`](./docs/TEARDOWN.md) audits what is here
today; [`docs/FEATURE-VAULT.md`](./docs/FEATURE-VAULT.md) catalogues the
capabilities the kernel adds — momentum, landing-date forecasts, staleness
decay, time travel, and an auditable "do this next".

## Tech Stack

- React 18 + TypeScript
- Vite 6
- Tailwind CSS v4
- Three.js — two hand-written GLSL shader backdrops
- dnd-kit — drag and drop
- Supabase — Postgres + Auth
- Cloudflare Workers — static asset hosting

---

## Running locally

```bash
npm install
npm run dev
```

Without Supabase credentials the app runs in **demo mode**: accounts and tasks are
stored in `localStorage` on your own device, so you can explore the whole UI
without a backend. A banner makes it obvious when demo mode is active.

## Connecting Supabase

`.env` is not committed, so a fresh clone starts in demo mode. To run against a
real backend:

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. **SQL Editor → New query** → paste [`supabase/schema.sql`](./supabase/schema.sql) → **Run**.
   That creates the tables, triggers, Row Level Security policies and the
   starter-content function.
3. **Authentication → Providers → Email** → enable the email provider. Turn
   *Confirm email* off if you want signups to complete without an inbox round-trip.
4. Copy `.env.example` to `.env` and fill in the two values from
   **Project Settings → API**:

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

5. `npm run build` — the demo-mode banner disappears once the keys are present.

### A note on the anon key

The anon key is a **publishable client key**. It is compiled into the browser
bundle by design, and Row Level Security is what actually protects the data —
every policy is scoped to `auth.uid() = owner_id`, so a signed-in user can only
ever read or write their own rows.

The `service_role` key bypasses RLS entirely and must never appear in `.env`,
the bundle, or this repo.

### Data model

| Table | Purpose |
|---|---|
| `profiles` | One row per user, created automatically on signup |
| `projects` | Name, description, colour, status, ordering |
| `tasks` | Title, notes, status, priority, position, due date |

---

## Deploying

Hosted on Cloudflare Workers static assets. `wrangler.jsonc` binds the custom
domain, and Cloudflare manages the DNS record itself.

```bash
npm run build
npx wrangler deploy
```

Build with `.env` present — the Supabase values are baked in at build time, so
deploying without them ships a demo-mode site.

Cutting a release (tag, archive, changelog) is described in
[`docs/VERSIONING.md`](./docs/VERSIONING.md).

---

## Scenes

Assembled from a curated component set; each scene maps to one component.

| # | Scene | Source |
|---|-------|--------|
| 1 | Hamster Loader | Uiverse.io by `anteneh_7368` |
| 2 | Prism Hero | 21st.dev — WebGL Shader |
| 3 | Login & Signup | 21st.dev — Modern Login & Signup |
| 4 | Dashboard | 21st.dev — Features Card |
| 5 | Sidebar | 21st.dev — Sidebar |
| 6 | List | 21st.dev — Interactive Logs Table |
| 7 | Day/night switch | Uiverse.io toggle, rebuilt on the design tokens |

Component sources are credited above. Application code — the Workboard and its
guillotine, the insights engine, the theme system, the version archive, the data
layer, schema and auth flow — is original.
