# Audit 02 — Backup and disaster recovery

**Date** 2026-08-26 (drill run 2026-08-27 UTC) · **Version** v2.7.0
**Status** PARTIALLY RESOLVED — a verified dump and a rehearsed restore now
exist; no schedule is installed, and one repair is outstanding (F4).

---

## Measured against

Supabase's own statement of what the free plan provides:
**no backups, no point-in-time recovery**
(<https://supabase.com/docs/guides/platform/backups>), and free projects
**paused after one week idle**. Recovery capability was measured the only way it
can be — by performing a restore, not by reading a script.

Method: dump the live database, restore it into a throwaway `restore_drill`
schema, and compare the restored tables to the live ones column by column.

## The numbers

| | |
|---|---|
| Copies of the production dataset before this audit | **1** (Supabase only) |
| Restore procedure that had ever been executed | **0** |
| Rows dumped and restored | **65** — 4 auth users, 4 identities, 4 profiles, 7 projects, 46 tasks |
| Tables byte-identical after restore | **5 of 5** (see F4 for the one caveat) |
| Defects the drill found that the dump's own checks missed | **1** (F1) |
| Live-data incident caused by the drill | **1** (F4) |
| Dump size / write+verify time | 34,777 bytes / under 3 s |

---

## What now exists

**`scripts/backup.mjs`** — dumps `auth.users`, `auth.identities`,
`public.profiles`, `public.projects`, `public.tasks`, plus a DDL fingerprint
(columns, constraints, indexes, RLS state, policies, triggers, function bodies).
Output is one plain `.sql` file per run in `.audit/backups/` (gitignored, mode
0600), newest 10 retained, pruned only after the new dump verifies.

Three decisions worth stating:

- **`auth.users` is in the dump, hashes included.** `owner_id` is a foreign key
  into it, so a public-tables-only dump restores rows that no account can see
  and that the FK will not even accept. And because accounts are username-based
  with a synthesized non-deliverable address, **password reset is structurally
  impossible** (`src/lib/store.ts`) — a restore without the bcrypt hashes locks
  every user out permanently. That makes the dump a credential file, which is
  why it is gitignored, 0600, and flagged in its own header.
- **Plain SQL, not JSON.** In the disaster this exists for, the Supabase
  dashboard SQL editor may be the only tool available; neither the Supabase CLI
  nor `psql` is installed on this machine. A dump you can only restore with a
  tool you have not got is not a backup.
- **Rows are written as one `jsonb_populate_recordset` insert per table**, so
  Postgres does its own quoting and type coercion on the way back in. Hand-rolled
  SQL escaping is the classic route to a backup that cannot be restored.

**Verification, before it reports success.** The script re-reads what it wrote
from disk and checks: non-empty; the trailing `-- END OF DUMP sha256=…` sentinel
present (a truncated file loses it); the sha256 of the body matches that
sentinel; each table's JSON payload re-parses out of the *written file* and its
row count equals the count taken inside the same snapshot; referential closure
(no `owner_id`/`project_id`/identity `user_id` pointing at a row not in the
dump); and every user row carries a password hash. Any failure deletes both
artefacts and exits non-zero — an unverified dump in the backups directory is
indistinguishable from a good one at three in the morning.
The truncation path was fault-injected and confirmed to abort and clean up.

All reads happen in one `repeatable read read only` transaction, so the tables
are mutually consistent and the process cannot write to production.

**`docs/RUNBOOK.md`** — restore, auto-pause, forgotten password, and how to
verify a restore with specific numbers.

---

## F1 · The dump was unrestorable, and its own checks said it was fine

The first drill load failed on the first statement:

```
cannot insert a non-DEFAULT value into column "confirmed_at"
```

`auth.users.confirmed_at` is `generated always as (least(email_confirmed_at,
phone_confirmed_at))`. Postgres rejects any insert that *names* a generated
column. Two separate mistakes were needed to hit it, and the fix needed both:

1. the value was being dumped — now excluded, with the skipped columns recorded
   in the manifest (`auth.users.confirmed_at`, `auth.identities.email`);
2. `insert into t select * from jsonb_populate_recordset(...)` still names every
   column of the row type even when the payload omits the key — the insert now
   emits an explicit column list.

**Why this is the finding that matters.** The dump passed every check the script
made: right byte count, right row counts, matching hash, closed references. It
was still a file that could not be restored. Only executing the restore found
it. This is the entire argument for rehearsing recovery rather than writing it.

**Fixed** in `scripts/backup.mjs`; the corrected dump restored cleanly, twice.

## F2 · Restore verified — the numbers

Loaded into `restore_drill`, then compared to live:

| Table | Live | Restored |
|---|---|---|
| `auth.users` | 4 | 4 |
| `auth.identities` | 4 | 4 |
| `public.profiles` | 4 | 4 |
| `public.projects` | 7 | 7 |
| `public.tasks` | 46 | 46 |

Counts are the weak check, so full content was hashed —
`md5(string_agg(to_jsonb(row)::text, '|' order by id))` over every column of
every row:

- `profiles` and `auth.users` — **digests identical to live.**
- `projects` and `tasks` — identical once `updated_at` is excluded
  (`1e7b6625…` and `290212ee…` on both sides). The `updated_at` difference is
  F4, and it is a difference in the *live* table, not the restored one.

Spot checks: all 4 bcrypt hashes restored byte-identical (60 chars each); the
generated `confirmed_at` recomputed to the same value on every row; usernames
intact in `raw_user_meta_data`; and every project joined to its tasks across the
restored foreign keys with the expected distribution (22, 7, 5, 4, 4, 4, 0).

The drill tables were created with `like … including all` and then had the
foreign keys re-added by hand, because `like` never copies them — without that
the load would have proved only that values fit their columns, not that
`owner_id` and `project_id` still resolve. The load was run twice to prove the
upsert is idempotent.

`restore_drill` was dropped (`drop schema … cascade`, 5 objects) and its absence
confirmed: 0 schemas, 0 tables, namespace list back to its original 9.

## F3 · The pre-existing "verified snapshot" is not valid JSON

`.audit/backups/snapshot-20260826-193919-post-rls.json` — the safety net taken
before this audit — has `OK — .audit/_snap.sql` appended after the closing
bracket, because it was produced by redirecting a helper's stdout. `JSON.parse`
rejects it at byte 31457 of 31489.

The data is all there and a human can read it, so this is not a lost snapshot.
It is the exact failure mode `scripts/backup.mjs` is built to prevent: an
artefact that is named like a backup, believed to be one, and cannot be consumed
by the tool that would consume it. Not modified — it is another agent's file,
and it remains useful as a manual reference.

## F4 · **Live-data incident caused by this audit — one repair outstanding**

**What happened.** The drill loads the dump into `restore_drill` by rewriting
the schema names in the generated `.sql`. On the second attempt the rewrite
script's regex no longer matched the statements (F1's fix had added a column
list to the `insert into …` line), so it silently rewrote nothing and reported
success. The unrewritten dump was then executed **against the live tables**.

**Blast radius, measured rather than estimated.** Every value written was
identical to the value already in the row — the dump had been taken seconds
earlier. But `projects` and `tasks` carry `BEFORE UPDATE` triggers
(`projects_touch`, `tasks_touch`) that set `updated_at = now()`, and those fired
on all 53 rows. Confirmed by hashing every column of every row against the
pre-incident dump: **`updated_at` is the only column that differs, on
`public.projects` (7 rows) and `public.tasks` (46 rows).** All now read
`2026-08-27T02:47:06.679Z`; they previously held 7 and 39 distinct values.
`profiles`, `auth.users` and `auth.identities` are untouched. No row was
created, deleted, or otherwise altered.

**Status: NOT repaired.** The audit's mandate is read-only against `public`, and
repairing this is another write. The original per-row values survive in
`.audit/backups/dump-20260827-024648.sql`, and a ready-to-run repair is prepared
at `.audit/REPAIR-updated-at-20260827.sql` — it must disable the two touch
triggers around the update, or they overwrite the repair with `now()` again. The
maintainer decides whether to run it; `updated_at` currently feeds nothing
user-visible beyond ordering.

**The lesson, which is now in the runbook.** A dump that names production tables
is a loaded weapon in any workflow that rewrites it. The rewrite script now
refuses to emit a file that still contains a `public.`/`auth.`/`storage.`
reference in an executable position, and asserts its expected rewrite count.
"The rewrite reported success" is not the same claim as "the rewrite happened".

---

## Accepted, with reasons

- **The dump does not recreate the schema.** DDL lives in `supabase/schema.sql`
  in git and is idempotent; the dump carries a fingerprint of the live DDL as
  *evidence* to diff against, not as a restore path. Rebuilding a schema from
  introspected fragments is how a restore quietly produces a table with no RLS.
- **Backups live on one machine.** `.audit/backups/` is local and gitignored. A
  disk failure loses every copy. Off-machine storage is a real gap, deliberately
  not solved by putting a credential file in a public repo.
- **Sessions and refresh tokens are not dumped.** A restore signs everyone out
  and they sign in again.
- **Nothing is scheduled yet.** See below; the decision is the maintainer's.

## Scheduling — options, and the recommendation

| Option | Cost | Risk |
|---|---|---|
| **Windows Task Scheduler**, weekly, running `node scripts/backup.mjs` in the repo | free | Runs only when the machine is on. Backups stay on that one disk. Credential never leaves it. |
| **GitHub Actions** on a cron | free | Requires the production `DATABASE_URL` in repository secrets **of a public repo**. Any workflow — including one added by a PR from a fork under some configurations — becomes a potential exfiltration path, and the dump artefact itself contains password hashes. |
| **Supabase Pro** ($25/mo) | paid | Daily backups and PITR, managed. Removes the problem rather than scripting around it. |

**Recommendation: Windows Task Scheduler, weekly**, plus a manual run before any
schema change. It also solves the auto-pause problem for free — a successful
backup counts as activity, so the same job that copies the data keeps the
project awake.

**Do not put the production connection string in GitHub Actions secrets while
this repo is public.** The secret is a database superuser-adjacent credential
and the job's output is a file of password hashes; that combination in a public
repo's CI is not worth a scheduled backup. If off-machine copies become
necessary, the honest answer is Supabase Pro, or a private repo dedicated to it.

Suggested Task Scheduler action (weekly, Sunday, whenever the machine is on;
tick "Run task as soon as possible after a scheduled start is missed"):

```
Program:   node
Arguments: scripts/backup.mjs
Start in:  C:\Users\Noname\Desktop\Quick Projects\Project Tracker
```

---

## What this run could NOT check

- **Restore into a rebuilt Supabase project.** The drill restored into a new
  schema *inside the existing project*. It did not prove that a dump can be
  loaded into a brand-new project — that path also depends on
  `supabase/schema.sql` applying cleanly, on Supabase's own `auth` schema being
  byte-compatible with whatever version produced the dump, and on GoTrue
  accepting hand-restored `auth.users`/`auth.identities` rows. **Nobody has
  signed into a restored database.** That is the single biggest remaining
  unknown, and it is only answerable by creating a throwaway Supabase project
  and restoring into it.
- **Whether a restored account can actually authenticate.** Hashes and identity
  rows were verified as present and identical; that is not the same as GoTrue
  issuing a token.
- **`supabase/schema.sql` versus live.** The fingerprint was captured but not
  diffed statement-by-statement against the file. One difference was noticed:
  live carries a `public.rls_auto_enable()` event-trigger function (a
  Supabase-managed guard that enables RLS on newly created public tables) which
  is **not** in `schema.sql` — so a project rebuilt from git alone would not
  have it. Counts otherwise match expectations: 3 tables with RLS enabled,
  10 policies, 7 indexes, 3 triggers.
- **Restore duration at real scale.** 65 rows restore instantly. Nothing here
  says what happens at 65,000 — the single-statement-per-table shape and the
  all-in-one-transaction restore both have limits that this dataset cannot find.
- **Storage.** `storage.objects` was counted (0) and is otherwise not covered.
  A future upload feature would be silently outside every backup here.
- **Supabase project configuration.** API keys, auth settings, email templates,
  Edge Functions, cron — none of it is captured, and a rebuilt project needs it
  reconstructed by hand from the dashboard.
- **Whether the dump is restorable after the machine it lives on dies.** There
  is still exactly one copy of it, on one disk.

## Follow-ups

1. Decide on `.audit/REPAIR-updated-at-20260827.sql` (F4).
2. Install the weekly scheduled task.
3. Restore into a throwaway Supabase project once, and sign in to it. Until that
   is done, "recovery works" is a claim about a schema, not about the product.
4. `npm install --no-save pg` is currently how `scripts/backup.mjs` gets its
   driver — a fresh clone has no `pg`. Either add it as a dependency or say so
   in the script's failure path.
