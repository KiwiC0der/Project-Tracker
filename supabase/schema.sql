-- ============================================================================
-- Project Tracker — Supabase schema
-- ----------------------------------------------------------------------------
-- Run this once in your Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES  (one row per auth user)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Accounts are created with a USERNAME, not an email. Supabase Auth has no
-- username identity type, so the app synthesizes a non-deliverable address
-- (`<username>@users.noreply.pt.anteneh.tech`) purely to satisfy auth.users,
-- and stores the username as it was typed in raw_user_meta_data.
--
-- `profiles.email` therefore holds that synthesized handle for username-era
-- accounts — it is NOT mail anyone can receive, and the app never shows it.
-- `profiles.username` is the human-facing identity; read that instead.
-- (Added after the initial release, hence a separate idempotent ALTER.)
alter table public.profiles add column if not exists username text;

-- Create the profile row automatically whenever someone signs up, so the app
-- never has to handle a "logged in but no profile" state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text := nullif(trim(new.raw_user_meta_data->>'username'), '');
begin
  -- Pre-username accounts have no metadata: fall back to the email localpart.
  if uname is null then
    uname := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;

  insert into public.profiles (id, email, username, display_name)
  values (
    new.id,
    new.email,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), uname)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for accounts that predate the username column.
--
-- `handle_new_user` is a trigger, and a trigger only fires on new rows — so
-- adding `profiles.username` by ALTER left every existing account NULL, and
-- the column was unusable by anything that came after. Measured 2026-08-30:
-- 4 of 5 rows null, the one populated row being the only account created since
-- the column existed.
--
-- Idempotent by the `where username is null` guard rather than by ON CONFLICT:
-- re-running must not overwrite a username someone has since changed.
--
-- The fallback order is copied from handle_new_user deliberately. If the two
-- ever disagree, a backfilled account and a fresh one would carry different
-- usernames for the same input, which is worse than either rule alone.
update public.profiles p
   set username = coalesce(
         nullif(trim(u.raw_user_meta_data->>'username'), ''),
         nullif(split_part(coalesce(u.email, ''), '@', 1), ''))
  from auth.users u
 where u.id = p.id
   and p.username is null;

-- ----------------------------------------------------------------------------
-- 2. PROJECTS
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text default '',
  color       text not null default 'violet',
  status      text not null default 'active'
              check (status in ('active', 'paused', 'done', 'archived')),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_owner_idx on public.projects (owner_id, position);

-- PLANNING COLUMNS (added after the initial release, hence separate idempotent
-- ALTERs rather than edits to the create-table above).
--
-- `target_date` is the date the OWNER says this should be finished by. The app
-- already predicts a landing date from measured task velocity (forecast() in
-- src/lib/insights.ts); a prediction is only actionable next to an intention,
-- and without this column there is nothing to be late against.
alter table public.projects add column if not exists target_date date;

-- Hours a week the owner intends to give this project. forecast() has no answer
-- at all for a project with no completed tasks yet — zero velocity returns
-- Infinity and the UI has to say "no pace to forecast from" — while stats()
-- already knows how many hours of work are outstanding. This is the missing
-- divisor that turns that number into a date on day one.
--
-- Nullable on purpose: null means "not budgeted", which is not the same claim
-- as zero hours a week.
alter table public.projects
  add column if not exists weekly_hours int
  check (weekly_hours is null or weekly_hours between 1 and 168);

-- ----------------------------------------------------------------------------
-- 3. TASKS
-- ----------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 240),
  notes       text default '',
  status      text not null default 'todo'
              check (status in ('todo', 'doing', 'done')),
  priority    text not null default 'medium'
              check (priority in ('low', 'medium', 'high')),
  position    int  not null default 0,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_project_idx on public.tasks (project_id, status, position);
create index if not exists tasks_owner_idx   on public.tasks (owner_id);

-- ----------------------------------------------------------------------------
-- 4. updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- This is what makes it safe to ship the anon key in the browser bundle.
-- Without these policies, the anon key would expose every row to everyone.
--
-- THREE RULES, and every policy below obeys all three. They are not style.
--
--   1. Name the role with `to authenticated`. A policy with no role clause is
--      evaluated for EVERY role including `anon`, so an unauthenticated request
--      still runs the predicate. It fails closed today only because
--      `auth.uid()` is null for anon and null never equals a uuid — the safety
--      is a coincidence of the expression, not something the policy states.
--
--   2. Wrap it as `(select auth.uid())`. Bare `auth.uid()` is volatile to the
--      planner and re-evaluates once PER ROW; wrapped in a scalar subquery it
--      becomes an initPlan, evaluated once per statement. On a full-table scan
--      that is the difference between one call and one call per row.
--
--   3. An UPDATE's `with check` must be at least as strict as the matching
--      INSERT's `with check`. If INSERT validates a column and UPDATE does not,
--      the column is writable to any value after creation and the INSERT
--      validation is decorative. `tasks` is the case that matters here: a task
--      is only insertable into a project you own, so it must only be updatable
--      into one too. Verify with supabase/tests/rls-adversarial.sql, which
--      attacks the boundary rather than reading it — reading it is what let the
--      two drift apart in the first place.
-- NOT DEFINED HERE, but present on Supabase-hosted projects: an event trigger
-- `rls_auto_enable` that turns RLS on for any new table created in `public`.
-- It is owned by `supabase_admin` and provided by the platform, so this file
-- cannot create it — and must not pretend to. It is recorded here because a
-- database rebuilt from this file ALONE would not have that safety net, and
-- the difference only shows up the day someone adds a table and forgets the
-- `alter table ... enable row level security` line below.

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks    enable row level security;

-- profiles: you can only see and edit your own
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No INSERT policy, deliberately: rows are created solely by the
-- `handle_new_user` trigger, which is `security definer` and therefore bypasses
-- RLS. A client has no legitimate reason to insert one.
-- No DELETE policy either — a profile dies with its auth.users row via
-- `on delete cascade`. Self-service account deletion is tracked separately as
-- a GDPR Art. 17 gap; when it lands it needs a policy here, not a client delete.

-- projects: full CRUD, scoped to the owner
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  -- `with check` on owner_id is what stops a client giving its project away,
  -- or claiming someone else's by rewriting the column.
  with check ((select auth.uid()) = owner_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- tasks: same, plus the project must also belong to you
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  -- USING selects which existing rows may be updated: ownership of the row.
  using ((select auth.uid()) = owner_id)
  -- WITH CHECK validates the row AFTER the update, and mirrors the INSERT
  -- policy exactly — see rule 3 above. The `exists` clause is what keeps
  -- `project_id` from being a freely writable pointer.
  --
  -- Deliberately NOT added to USING as well. USING gates which rows you may
  -- touch, and a task already pointing at a project you do not own is exactly
  -- the row you would need to update in order to repair it.
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Rule 2 is only worth anything if the columns the policies filter on are
-- indexed. owner_id is the predicate in every policy here, and it is already
-- covered: `projects_owner_idx (owner_id, position)` and `tasks_owner_idx
-- (owner_id)` both lead with it, and `profiles` filters on its primary key.
-- No index is added here on purpose — a second index on a column that already
-- leads an existing one buys nothing and costs write throughput.
--
-- One index that is NOT about RLS: `profiles.username` is the human-facing
-- identity, is looked up by it, and has neither an index nor a constraint.
-- Uniqueness is currently enforced only indirectly, via the unique constraint
-- on auth.users.email through the synthesized address — an invariant kept in
-- two places at once. This index makes the lookup cheap; making it UNIQUE is a
-- separate decision, because a unique index would FAIL to apply if any
-- duplicate already exists, and that must be checked before it is imposed.
-- UNIQUE, as of 2026-08-30. It was created non-unique because a unique index
-- fails to apply if a duplicate already exists, and whether one did had not
-- been checked. It has since been checked — 0 duplicates across 5 rows, after
-- the backfill above filled the 4 legacy nulls — so the constraint can now be
-- imposed rather than hoped for.
--
-- Partial, because NULL is not the same claim as a taken name: `unique` treats
-- multiple NULLs as distinct anyway, but the predicate says so out loud and
-- keeps the index off rows it can never help.
--
-- This LOCALISES an invariant that was previously enforced by accident. Before
-- it, two people could not share a username only because auth.users.email is
-- unique and every username is mapped onto a synthesized address — an
-- invariant maintained in a different table, by a different mechanism, for a
-- different reason. Anything that ever writes profiles.username directly, or
-- any future auth path that does not go through the synthesized address, would
-- have silently broken it.
drop index if exists public.profiles_username_lower_idx;
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

-- ----------------------------------------------------------------------------
-- 6. Starter content for brand-new accounts
-- ----------------------------------------------------------------------------
-- Called by the app once, right after a user's first sign-in, so a new account
-- lands on a populated dashboard instead of an empty state.
create or replace function public.seed_starter_project()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- only seed if the account has no projects at all
  if exists (select 1 from public.projects where owner_id = uid) then
    return;
  end if;

  insert into public.projects (owner_id, name, description, color, position)
  values (uid, 'Getting Started', 'A sample project — rename it or delete it.', 'violet', 0)
  returning id into pid;

  insert into public.tasks (project_id, owner_id, title, status, priority, position) values
    (pid, uid, 'Drag a task between columns',   'todo',  'medium', 0),
    (pid, uid, 'Create your own project',       'todo',  'high',   1),
    (pid, uid, 'Click a task to edit it',       'doing', 'medium', 0),
    (pid, uid, 'Sign in and out to test auth',  'done',  'low',    0);
end;
$$;

grant execute on function public.seed_starter_project() to authenticated;
