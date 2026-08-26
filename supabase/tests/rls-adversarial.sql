-- ============================================================================
-- ADVERSARIAL RLS TEST — run in the Supabase SQL editor
-- ----------------------------------------------------------------------------
-- Proves the tenant boundary holds by ATTACKING it as a signed-in user, rather
-- than by reading the policies and agreeing with them. Reading a policy set and
-- agreeing with it is how asymmetries between INSERT and UPDATE survive.
--
-- Everything runs inside one transaction and ends in ROLLBACK, so it creates no
-- users, no projects and no tasks. It is safe to run against production, and
-- running it against production is the point — a policy test against a database
-- that is not the one serving your users proves nothing about your users.
--
-- HOW IT WORKS: Supabase resolves auth.uid() from the `request.jwt.claims` GUC.
-- Setting that GUC with `set local` is what PostgREST itself does on every
-- request, so this impersonates two signed-in users without their passwords.
--
-- It checks BOTH directions. A test that only asserts what a user cannot do
-- will print all-PASS on a policy set that denies everything, including the
-- app's own traffic — so the positive assertions are not padding, they are what
-- stops a tightening change from silently breaking sign-in.
--
-- EXPECTED: every notice starts with PASS. Any FAIL is a live isolation hole,
-- or a legitimate access path that has just been broken.
-- Read the output in the SQL editor's "Messages"/"Logs" tab, not the results
-- grid — RAISE NOTICE does not appear in the grid.
-- ============================================================================
begin;

-- Two throwaway identities, local to this transaction and rolled back after.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rlstest-a@example.invalid', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"rlstest_a"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rlstest-b@example.invalid', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"rlstest_b"}');

-- Seed one project and one task each, as the table owner. RLS is bypassed here
-- deliberately: this is setup, not the thing under test.
insert into public.projects (id, owner_id, name)
values ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'A project'),
       ('22222222-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'B project');

insert into public.tasks (id, project_id, owner_id, title)
values ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'A task'),
       ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002',
        'bbbbbbbb-0000-4000-8000-000000000002', 'B task');

-- ---------------------------------------------------------------------------
-- Become user A, exactly as PostgREST would for a request carrying A's JWT.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  n int;
begin
  -- 1. A cannot SEE B's project.
  select count(*) into n from public.projects
   where id = '22222222-0000-4000-8000-000000000002';
  raise notice '%  1. A cannot read B project (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- 2. A cannot SEE B's task.
  select count(*) into n from public.tasks
   where id = '44444444-0000-4000-8000-000000000002';
  raise notice '%  2. A cannot read B task (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- 3. A cannot UPDATE B's task.
  update public.tasks set title = 'owned'
   where id = '44444444-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '%  3. A cannot update B task (changed % rows)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- 4. THE ONE THAT MATTERS. A moves its OWN task into B's project.
  --    This is the case an owner_id-only UPDATE policy lets through, because
  --    the row stays owned by A the whole time — only its project_id points
  --    somewhere it should not. Must raise 42501 from the WITH CHECK clause.
  begin
    update public.tasks
       set project_id = '22222222-0000-4000-8000-000000000002'
     where id = '33333333-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    raise notice '%  4. A cannot move its task into B project (changed % rows)',
      case when n = 0 then 'PASS' else 'FAIL - TENANT BOUNDARY OPEN' end, n;
  exception when insufficient_privilege then
    raise notice 'PASS  4. A cannot move its task into B project (blocked by WITH CHECK)';
  end;

  -- 5. A cannot DELETE B's task.
  delete from public.tasks where id = '44444444-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '%  5. A cannot delete B task (deleted % rows)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- 6. A cannot create a project owned by B.
  begin
    insert into public.projects (owner_id, name)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'forged');
    raise notice 'FAIL  6. A forged a project owned by B';
  exception when insufficient_privilege then
    raise notice 'PASS  6. A cannot create a project owned by B';
  end;

  -- 7. A cannot hand its own project to B.
  begin
    update public.projects
       set owner_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     where id = '11111111-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    raise notice '%  7. A cannot reassign its project to B (changed % rows)',
      case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when insufficient_privilege then
    raise notice 'PASS  7. A cannot reassign its project to B (blocked by WITH CHECK)';
  end;

  -- 8. A cannot read B's profile.
  select count(*) into n from public.profiles
   where id = 'bbbbbbbb-0000-4000-8000-000000000002';
  raise notice '%  8. A cannot read B profile (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- ---- the other direction: A must still be able to do its own work -------
  -- Everything above passes trivially if the policies deny all access. These
  -- are the assertions that fail when a tightening change goes too far.

  -- 9. A sees exactly its own project, and only its own.
  select count(*) into n from public.projects;
  raise notice '%  9. A sees its own project and no others (saw %, expected 1)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- 10. A sees exactly its own task.
  select count(*) into n from public.tasks;
  raise notice '% 10. A sees its own task and no others (saw %, expected 1)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- 11. A can edit its own task.
  update public.tasks set title = 'renamed by A'
   where id = '33333333-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  raise notice '% 11. A can update its own task (% rows)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- 12. A can move a task between projects it owns. This is the case the
  --     WITH CHECK fix must NOT break — the guard is on whose project it is,
  --     not on whether project_id may change at all.
  insert into public.projects (id, owner_id, name)
  values ('11111111-0000-4000-8000-0000000000aa',
          'aaaaaaaa-0000-4000-8000-000000000001', 'A second project');
  update public.tasks set project_id = '11111111-0000-4000-8000-0000000000aa'
   where id = '33333333-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  raise notice '% 12. A can move its task between its OWN projects (% rows)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- 13. A can create a task in its own project.
  insert into public.tasks (project_id, owner_id, title)
  values ('11111111-0000-4000-8000-000000000001',
          'aaaaaaaa-0000-4000-8000-000000000001', 'made by A');
  raise notice 'PASS 13. A can create a task in its own project';

  -- 14. A can read its own profile.
  select count(*) into n from public.profiles
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  raise notice '% 14. A can read its own profile (saw %, expected 1)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;
end $$;

-- ---------------------------------------------------------------------------
-- Anonymous — the role the anon key in the shipped bundle authenticates as.
-- This is the one an attacker gets for free by opening DevTools.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare n int;
begin
  select count(*) into n from public.projects;
  raise notice '% 15. anon sees no projects (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL - PUBLIC DATA LEAK' end, n;
  select count(*) into n from public.tasks;
  raise notice '% 16. anon sees no tasks (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL - PUBLIC DATA LEAK' end, n;
  select count(*) into n from public.profiles;
  raise notice '% 17. anon sees no profiles (saw % rows)',
    case when n = 0 then 'PASS' else 'FAIL - PUBLIC DATA LEAK' end, n;
end $$;

reset role;
rollback;
