# Runbook

Four incidents, in the order they are likely to happen. Every command assumes
the repo root and a `.env` containing `DATABASE_URL`.

**The one thing to know before anything else:** the Supabase free plan has
**no backups and no point-in-time recovery**
([docs](https://supabase.com/docs/guides/platform/backups)). Nothing can be
recovered from Supabase's side. The only copies that exist are the dumps in
`.audit/backups/`, on this machine. If those are gone, the data is gone.

---

## 0. Take a backup

```bash
node scripts/backup.mjs          # needs pg: npm install --no-save pg
```

It prints `backup VERIFIED` and the row counts, or it refuses and deletes what
it wrote. There is no in-between state to interpret. Output goes to
`.audit/backups/dump-YYYYMMDD-HHMMSS.sql` (gitignored), newest 10 kept.

**The dump contains bcrypt password hashes.** Never commit it, never paste it
into an issue or a chat, never sync it to anywhere public.

---

## 1. Restore the database

Do this when data is lost, corrupted, or the project has been deleted and
recreated. Takes about five minutes.

1. **Pick the dump.** Newest first:
   ```bash
   ls -t .audit/backups/dump-*.sql | head -3
   ```

2. **Check it is intact before trusting it.** The last line carries a sha256 of
   everything above it:
   ```bash
   f=.audit/backups/dump-20260827-024648.sql        # <-- your file
   head -c $(( $(wc -c < "$f") - $(tail -1 "$f" | wc -c) )) "$f" | sha256sum
   tail -1 "$f"
   ```
   The two hashes must match. If they do not, the file is truncated — use the
   next-newest dump. Do not restore a file that fails this check.

3. **Recreate the schema first.** The dump contains data only.
   Supabase dashboard → SQL Editor → New query → paste all of
   `supabase/schema.sql` → Run. It is idempotent; running it on an intact
   database is safe.

4. **Load the data.** Either:
   - SQL Editor → New query → paste the whole `.sql` file → Run, or
   - `node .audit/dbrun.mjs .audit/backups/dump-YYYYMMDD-HHMMSS.sql`

   It is one transaction: it either lands completely or not at all. It is also
   an upsert, so running it twice is safe — do that rather than guessing
   whether the first attempt got half-way.

5. **Verify — see section 4.** A restore is not finished until the numbers
   match.

> **If you are restoring into a scratch schema rather than over the real one:**
> the dump names `public.` and `auth.` tables explicitly. Rewriting those names
> and *checking the rewrite actually applied* is your responsibility — an
> unrewritten file runs against production. That mistake was made during the
> Audit 02 drill; see `docs/audits/2026-08-26-backup-recovery.md`.

---

## 2. The project was auto-paused

Free projects pause after **one week with no activity**. The app stops
answering; nothing is lost.

1. <https://supabase.com/dashboard> → select the project → **Restore project** /
   **Unpause**. It takes a few minutes to come back.
2. Confirm it is actually back: `node scripts/backup.mjs`. If that prints
   VERIFIED with the expected counts, the database is up and you now also have a
   fresh backup.
3. Nothing in the app or in Cloudflare needs redeploying — the URL and keys do
   not change.

**Prevention:** any successful `node scripts/backup.mjs` counts as activity, so
a weekly scheduled backup keeps the project awake and takes a copy in the same
run. See the scheduling section of the Audit 02 report.

**If it was paused for over 90 days**, Supabase may have deleted it. Then this
is section 1, into a brand-new project — and the restore is only as good as the
newest dump on disk.

---

## 3. A user forgot their password

**Say plainly: it cannot be reset. The account is lost.**

Accounts are created with a username, not an email address. The app synthesizes
`<username>@users.noreply.pt.anteneh.tech` to satisfy Supabase Auth — no such
mailbox exists, so a reset link has nowhere to go. See the comment block at the
top of `src/lib/store.ts`. This is structural, not a missing setting.

What the maintainer **can** honestly offer:

- **Create a fresh account** — a different username; they keep the app.
- **Hand back their data.** Their projects and tasks still exist and can be read
  out of a dump; the maintainer can send them the contents. Re-attaching that
  data to a *new* account means rewriting `owner_id` on their rows, which is a
  deliberate, one-off maintainer operation, not a supported feature.
- **Nothing else.** Do not offer to "reset it on the backend": setting a
  password hash by hand means writing to `auth.users`, and there is no
  verification step that proves the person asking is the account holder. There
  is no identity to check against — that is precisely what is missing.

Do not remove the warning on the sign-up form until a real recovery email
feature ships.

---

## 4. Verify a restore actually worked

Run this against the restored database and compare to the `-- rows:` line in the
header of the dump you restored — that line is the count as it was at dump time.

```sql
select
  (select count(*) from auth.users)      as users,
  (select count(*) from auth.identities) as identities,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.projects) as projects,
  (select count(*) from public.tasks)    as tasks;
```

As of 2026-08-27 that is **users 4 · identities 4 · profiles 4 · projects 7 ·
tasks 46**.

Counts alone are not proof. Also check:

```sql
-- 1. Nobody is locked out: every account must still have a password hash.
--    Expect 0. There is no password reset — see section 3.
select count(*) from auth.users where encrypted_password is null;

-- 2. No orphans: every row must belong to an account that exists. Expect 0, 0.
select count(*) from public.projects p
  where not exists (select 1 from auth.users u where u.id = p.owner_id);
select count(*) from public.tasks t
  where not exists (select 1 from public.projects p where p.id = t.project_id);

-- 3. RLS is on for all three tables. Expect 3 rows, all true. A restore that
--    recreated a table without RLS exposes every row to every signed-in user.
select relname, relrowsecurity from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relkind = 'r' order by 1;

-- 4. All 10 policies are present. Expect 10.
select count(*) from pg_policies where schemaname = 'public';
```

Then run `supabase/tests/rls-adversarial.sql` (17 assertions, expect 17 PASS)
and sign in through the app as a real user. A restore that satisfies every query
above and cannot be signed into is not a restore.
