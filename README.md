# Project Tracker

A project and task tracker — WebGL prism hero, real accounts, and a drag-and-drop task board.

**Live:** [pt.anteneh.tech](https://pt.anteneh.tech)

---

## Features

- 🐹 Hamster-wheel loader while the session is restored
- 🌈 WebGL prism hero with a chromatic light-ray shader
- 🔐 Real email + password accounts backed by Supabase
- 📊 Dashboard with live project and task counts, plus a completion bar
- 🗂️ Retractable sidebar — a persistent push panel on desktop, an overlay on mobile
- ✋ Drag-and-drop task board across To do / In progress / Done
- 🗃️ Projects and tasks persist per account, isolated by Row Level Security
- ♿ Keyboard-operable, `inert` on the collapsed sidebar, labelled form fields
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

Calendar, Reports and Settings appear in the sidebar as **Coming soon**.

Component sources are credited above. Application code — scene composition, data
layer, schema, auth flow — is original.
