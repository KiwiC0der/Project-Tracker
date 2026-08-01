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

-- Create the profile row automatically whenever someone signs up, so the app
-- never has to handle a "logged in but no profile" state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks    enable row level security;

-- profiles: you can only see and edit your own
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- projects: full CRUD, scoped to the owner
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = owner_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = owner_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = owner_id);

-- tasks: same, plus the project must also belong to you
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() = owner_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
  for insert with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() = owner_id);

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
