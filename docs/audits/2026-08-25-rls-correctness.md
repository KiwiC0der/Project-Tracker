# Audit 01 — RLS correctness

**Date** 2026-08-25, verified against production 2026-08-26 · **Version** v2.7.0
**Status** RESOLVED — fix applied to production, verified, and deployed

---

## Measured against

Supabase's documented Row Level Security practice
(<https://supabase.com/docs/guides/database/postgres/row-level-security>) and
OWASP Top 10:2025 **A01 Broken Access Control**.

Method: adversarial, then empirical. The policy set was attacked as an
impersonated signed-in user against the **live production database** — first to
reproduce the defect, then to prove the fix. Reading the policies and agreeing
with them is how the defect survived from v1.0.0 to v2.7.0 through several
reviews.

## The numbers

| | |
|---|---|
| Defects found | **4** in 10 policies |
| Live tenant-isolation holes | **1**, reproduced against production |
| Assertions now in the suite | **17** — 8 negative, 6 positive, 3 anonymous |
| Result before fix | 10 PASS, **1 FAIL** |
| Result after fix | **17 PASS, 0 FAIL** |

---

## F1 · CRITICAL · `tasks_update_own` was weaker than `tasks_insert_own`

Confirmed against the live database, not merely in the schema file:

```
tasks.INSERT  with_check: (auth.uid() = owner_id) AND (EXISTS (SELECT 1 FROM projects p
                            WHERE p.id = tasks.project_id AND p.owner_id = auth.uid()))
tasks.UPDATE  with_check: (auth.uid() = owner_id)
```

`project_id` was therefore a **freely writable pointer**. A signed-in user could
`UPDATE` their own task and set `project_id` to any UUID, including a project
belonging to someone else. The row stays owned by the attacker throughout, so
every ownership predicate passes; nothing examined where the task was being put.

**Reproduced, not theorised.** Against production, before the fix:

```
FAIL - TENANT BOUNDARY OPEN  4. A cannot move its task into B project (changed 1 rows)
```

**Why it survived review.** The INSERT policy is correct and reads as though it
establishes the invariant. It does not — it establishes it *at creation only*.
An invariant enforced on one command and not the other is not an invariant, and
reading the two in sequence makes the gap easy to miss because the correct one
comes first.

**Blast radius, stated precisely.** Impact was corruption and denial, not
disclosure: `tasks_select_own` is also owner-scoped, so a task pushed into
another user's project became invisible to that user rather than visible. That
containment was **accidental** — produced by a different policy for a different
reason — and would have evaporated the moment a shared-project feature, a
project-scoped read, or any admin view landed.

**Fixed.** The UPDATE `with check` now mirrors INSERT exactly. Deliberately not
added to `using`, because `using` gates which rows you may touch, and a task
already pointing at a project you do not own is exactly the row you would need
to update to repair it.

## F2 · MEDIUM · No policy named its role

All ten policies showed `roles: {public}` in `pg_policies`, so each was evaluated
for **every** role including `anon`. They failed closed only because
`auth.uid()` returns null for an anonymous request and null never equals a UUID
— a property of the expression, not a statement of intent. It holds until
someone writes a predicate that is true for null.

Fixed: all ten now `{authenticated}`, confirmed live.

## F3 · MEDIUM · `auth.uid()` was unwrapped

Bare `auth.uid()` is volatile to the planner and re-evaluates **once per row**;
`(select auth.uid())` becomes an initPlan evaluated once per statement. Fixed in
all ten, confirmed live.

## F4 · LOW · `profiles.username` had no index — and no data

Indexed on `lower(username)`. Non-unique deliberately: a unique index fails to
apply if duplicates exist.

Checking for duplicates surfaced a **separate finding**, recorded below.

---

## F5 · LOW · `profiles.username` is NULL for every existing account

Discovered while checking F4. All 4 profile rows have `username = NULL`.

The column was added by `ALTER` in v2.5.0. `handle_new_user` populates it, but a
trigger only fires on new rows — the four pre-existing accounts were never
backfilled. The new index is therefore currently on an all-NULL column.

**Not user-visible.** The app reads the username from `user_metadata` via
`toUser()` in `src/lib/store.ts`, never from `profiles.username`. So this is
dead data rather than a broken feature — but it means the column cannot be
trusted by anything future, and the uniqueness invariant it was meant to
localise is still enforced only indirectly through `auth.users.email`.

**Not fixed in this audit.** A backfill is a production data write, and it is
not urgent. Deferred to Audit 02, so that it happens after a verified backup
exists rather than before one.

---

## What was fixed

- `supabase/schema.sql` §5 rewritten: ten policies, all with `to authenticated`
  and `(select auth.uid())`; `tasks_update_own` gained the `exists` clause.
  Three rules documented above the section so a future reader knows they are
  load-bearing rather than stylistic.
- `supabase/tests/rls-adversarial.sql` added — 17 assertions, transaction-wrapped
  and rolled back, safe to run against production.
- No redundant index added: `projects_owner_idx (owner_id, position)` and
  `tasks_owner_idx (owner_id)` already lead with the column every policy filters
  on. A second would cost write throughput and buy nothing.

### The test checks both directions, and that is not padding

The suite originally asserted only what a user *cannot* do. That test prints
all-PASS against a policy set that denies everything — including the app's own
traffic. Six positive assertions were added after the fix, covering the case the
`with check` change could plausibly have broken: **moving a task between two
projects you legitimately own**. The guard is on *whose* project it is, not on
whether `project_id` may change at all, and assertion 12 is what proves that.

Separately verified against the real production account: 4 projects and 34 tasks
still visible, updatable, and creatable after the change.

---

## Accepted, with reasons

- **`profiles.username` indexed but not unique.** Duplicate count is currently
  0, but of 0 non-null values — so the check proves nothing yet. Revisit once
  F5 is backfilled.
- **The `anon` role retains table grants.** PostgREST needs them to reach RLS at
  all; the policies are the correct control layer.
- **`seed_starter_project` remains `security definer`.** It pins `search_path`,
  which is the actual risk with definer functions.

---

## What this run could NOT check

1. **Whether the defect was ever exploited.** Free-plan log retention is 1 hour
   for auth and 1 day for API and database. For any window before yesterday the
   evidence no longer exists. This is unknowable, not merely unchecked.
2. **Supabase Database Advisors were not run** — dashboard-only. They would
   independently check for RLS-disabled tables, views bypassing RLS, and
   unauthenticated `security definer` functions. Worth running as a cross-check
   that does not depend on this audit's reading.
3. **No load or plan verification of F3.** The wrapped form is documented as
   faster; that it *is* faster on this data was not measured. The tables are
   small enough that it would not currently be visible.
4. **Only three tables were audited.** `auth.*` and `storage.*` are Supabase's
   own schemas and were not reviewed.

---

## Evidence

Raw before/after policy dumps and both test runs are in `.audit/`
(gitignored): `policies-before.json`, `test-before-fix.txt`,
`test-after-fix.txt`, `test-final.txt`.

A verified JSON snapshot of all four tables was taken before any write —
`.audit/backups/` — 4 profiles, 7 projects, 46 tasks, 4 auth users.
