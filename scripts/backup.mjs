#!/usr/bin/env node
/* ============================================================================
   DUMP THE LIVE DATABASE — the only copy of this data that exists off Supabase.

   The Supabase free plan includes no backups and no point-in-time recovery
   (https://supabase.com/docs/guides/platform/backups), and free projects are
   paused after a week idle. Everything in this application therefore lives in
   exactly one place, with no export path in the UI. This script is the export
   path.

   WHAT IT CAPTURES, AND WHY EACH PART IS NOT OPTIONAL
   ---------------------------------------------------------------------------
   * `auth.users` and `auth.identities` — first, and non-negotiable. Every
     `owner_id` in `projects` and `tasks` is a foreign key into `auth.users`.
     A dump of the public tables alone restores rows that no account can ever
     see, and that no insert will even accept: the FK rejects them.
   * `encrypted_password` inside `auth.users`. Accounts here are created with a
     USERNAME against a synthesized non-deliverable address, so there is no
     mailbox to send a reset link to — see the comment block in src/lib/store.ts.
     A restore that drops the bcrypt hashes locks every user out PERMANENTLY,
     with no recovery path that exists today. That makes this file a credential
     store: it is written into .audit/ (gitignored) with mode 0600, and must
     never be committed, pasted into an issue, or synced anywhere public.
   * `public.profiles`, `public.projects`, `public.tasks` — the application data.
   * A DDL fingerprint: columns, constraints, indexes, RLS state, policies,
     triggers and function bodies as they exist LIVE.

   WHAT IT DOES NOT CAPTURE, STATED PLAINLY
   ---------------------------------------------------------------------------
   * It does not recreate the schema. The DDL fingerprint is evidence, not a
     restore path — recovery runs `supabase/schema.sql` from git first, then
     diffs it against the fingerprint to prove git had not drifted from live.
     Rebuilding a schema from introspected fragments is how a restore quietly
     ends up with a table that has no RLS on it.
   * It does not capture Supabase-managed state outside these tables: project
     settings, API keys, auth providers, email templates, storage buckets, Edge
     Functions, cron. `storage.objects` is counted at dump time and recorded, so
     an empty count is evidence rather than an assumption — but a future feature
     that uploads files is NOT covered by this script.
   * It does not carry generated columns — `auth.users.confirmed_at` is one.
     Postgres refuses an insert that names them; they are recomputed on restore.
     The manifest lists which ones were skipped.
   * It does not capture sessions or refresh tokens. A restore signs everybody
     out and they sign back in. That is the intended trade, not an oversight.

   HOW THE ROWS ARE WRITTEN
   ---------------------------------------------------------------------------
   Neither the Supabase CLI nor pg_dump/psql is installed on this machine, so
   the dump is generated here. Values are never hand-quoted: each table is
   emitted as one `jsonb_populate_recordset` insert, so Postgres does its own
   literal parsing and type coercion on the way back in. Hand-rolled SQL string
   escaping is the classic way a backup becomes unrestorable — one apostrophe in
   one task title, discovered eighteen months later during an outage.

   Output is plain `.sql`, deliberately: in the disaster this exists for, the
   Supabase dashboard SQL editor may be the only tool available. A dump you can
   only restore with a tool you have not installed is not a backup.

   Usage:  node scripts/backup.mjs
   ========================================================================== */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/* `pg` is installed with --no-save and is deliberately absent from
   package.json, so a fresh clone does not have it. A bare import would fail
   with ERR_MODULE_NOT_FOUND before a single line of this file runs, which is a
   confusing way to learn that your backup did not happen. */
const pg = await import('pg').then((m) => m.default).catch(() => {
  console.error('\nbackup ABORTED — the `pg` driver is not installed.')
  console.error('  npm install --no-save pg')
  process.exit(1)
})

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.audit', 'backups')

/* Dumps older than the newest RETAIN are deleted — but only after the new one
   has passed every check below. Pruning on the way IN would let a failed run
   delete the last good copy on its way to producing nothing. */
const RETAIN = 10

/* Dollar-quoting tag for the JSON payloads, verified absent from the data
   before anything is written: a tag that appears inside its own payload ends
   the literal early and produces a file that fails to parse at restore time. */
const TAG = 'pt_dump'

/* Order matters, and it is a foreign-key order rather than an alphabetical one.
   Restoring tasks before projects fails the FK; restoring either before
   auth.users fails the owner_id FK. */
const TABLES = [
  { name: 'auth.users', pk: 'id' },
  { name: 'auth.identities', pk: 'id' },
  { name: 'public.profiles', pk: 'id' },
  { name: 'public.projects', pk: 'id' },
  { name: 'public.tasks', pk: 'id' },
]

function fail(...lines) {
  console.error(`\nbackup ABORTED — ${lines[0]}`)
  for (const l of lines.slice(1)) console.error(`  ${l}`)
  process.exit(1)
}

/* ---------------------------------------------------------------------------
   Connection. Read from the environment, never echoed. Every failure here says
   what to do about it, because this script is run by someone who has just
   discovered they need a backup.
   ------------------------------------------------------------------------ */
function connectionString() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim()
  }

  const envFile = path.join(root, '.env')
  if (!existsSync(envFile)) {
    fail(
      'no database connection available.',
      'Set DATABASE_URL in the environment, or create .env from .env.example.',
      'Supabase dashboard -> Project Settings -> Database -> Connection string (URI).',
    )
  }
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('DATABASE_URL='))
  if (!line) {
    fail(
      'DATABASE_URL is not set in .env.',
      'Add it: DATABASE_URL=postgresql://...  (dashboard -> Settings -> Database).',
      'The anon key is not a substitute: it is bound by RLS to one signed-in user,',
      'so a backup taken through it omits every other account and reports success.',
    )
  }
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
}

/** Never let a credential reach stdout, whatever pg attached it to. */
const scrub = (s) => String(s).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<connection string redacted>')

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

const client = new pg.Client({
  connectionString: connectionString(),
  // Supabase terminates TLS with a cert this client has no root for. The
  // connection is still encrypted; only the chain is unverified. Same trade as
  // .audit/dbrun.mjs, and the same reason this is an operator tool rather than
  // something the app or CI imports.
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
})

let sql
let manifest

try {
  await client.connect()

  /* One repeatable-read snapshot for the whole dump. Table-by-table reads on
     separate snapshots can capture a task whose project was deleted between
     queries — a backup that is valid per table and referentially broken as a
     whole. READ ONLY is belt and braces: this process cannot write to the
     production database even if a later edit to this file tries to. */
  await client.query('begin transaction isolation level repeatable read read only')

  /* Generated columns must be dumped OUT, not in. `auth.users.confirmed_at` is
     `generated always as (least(email_confirmed_at, phone_confirmed_at))`, and
     Postgres rejects any insert that names it: "cannot insert a non-DEFAULT
     value into column". A dump that carries it verifies perfectly and then
     fails on the first statement of the restore. This was found by running the
     restore drill, not by reading the dump. */
  const generated = new Set(
    (await client.query(`
      select n.nspname || '.' || c.relname || '.' || a.attname as col
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where a.attgenerated <> '' and a.attnum > 0 and not a.attisdropped`)).rows.map((r) => r.col))

  const data = {}
  for (const t of TABLES) {
    const r = await client.query(`select to_jsonb(x) as row from ${t.name} x order by ${t.pk}`)
    data[t.name] = r.rows.map((x) => {
      for (const k of Object.keys(x.row)) {
        if (generated.has(`${t.name}.${k}`)) delete x.row[k]
      }
      return x.row
    })
  }

  const ddl = {
    columns: (await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema = 'public'
      order by table_name, ordinal_position`)).rows,
    constraints: (await client.query(`
      select rel.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' order by 1, 2`)).rows,
    indexes: (await client.query(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1")).rows,
    rls: (await client.query(`
      select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
      from pg_class join pg_namespace n on n.oid = relnamespace
      where n.nspname = 'public' and relkind = 'r' order by 1`)).rows,
    policies: (await client.query(`
      select tablename, policyname, cmd, roles::text as roles, qual, with_check
      from pg_policies where schemaname = 'public' order by 1, 2`)).rows,
    triggers: (await client.query(`
      select tgname, pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public', 'auth') order by 1`)).rows,
    functions: (await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`)).rows,
  }

  /* Counted inside the same snapshot as the rows, so "rows dumped" and "rows in
     the database" are two measurements of one instant and can honestly be
     compared. Counting after commit compares the dump to a moved target. */
  const counts = {}
  for (const t of TABLES) {
    counts[t.name] = Number((await client.query(`select count(*)::int as n from ${t.name}`)).rows[0].n)
  }
  counts['storage.objects'] = Number(
    (await client.query('select count(*)::int as n from storage.objects')).rows[0].n)

  await client.query('commit')

  manifest = {
    taken_at: new Date().toISOString(),
    source: 'supabase/postgres',
    counts,
    // Recorded so the omission is evidence rather than a silent gap: these are
    // recomputed by Postgres on restore, and naming them in the insert fails.
    generated_columns_excluded: [...generated].filter((g) => TABLES.some((t) => g.startsWith(`${t.name}.`))),
    ddl,
  }

  /* Refuse rather than warn. An empty auth.users cannot produce a usable
     system — every application row FKs into it — so a dump like that is not a
     small backup but a broken one, and the worst outcome is that it sits in the
     directory looking like insurance. Same for a row array that disagrees with
     its own count, which means a read returned partial results. */
  if (counts['auth.users'] === 0) {
    fail('auth.users is empty — refusing to write a dump that cannot restore a usable system.',
      'Check that DATABASE_URL points at the intended project before trusting this.')
  }
  for (const t of TABLES) {
    if (data[t.name].length !== counts[t.name]) {
      fail(`${t.name}: dumped ${data[t.name].length} rows but the table holds ${counts[t.name]}.`,
        'The read returned partial results. Nothing was written.')
    }
  }

  const payloads = Object.fromEntries(TABLES.map((t) => [t.name, JSON.stringify(data[t.name])]))
  for (const [name, p] of Object.entries(payloads)) {
    if (p.includes(`$${TAG}$`)) {
      fail(`${name} contains the literal $${TAG}$, which terminates its own SQL quoting.`,
        'Change TAG in scripts/backup.mjs and re-run. Nothing was written.')
    }
  }

  sql = buildSql(manifest, payloads)
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('\nbackup FAILED — the database read did not complete.')
  console.error(scrub(err.message))
  await client.end().catch(() => {})
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}

function buildSql(m, payloads) {
  const blocks = TABLES.map((t) => {
    const rows = JSON.parse(payloads[t.name])
    /* Idempotent by design: a restore is often run twice, the first time
       half-way. `do nothing` would be actively wrong for profiles — the
       on_auth_user_created trigger fires during the auth.users insert and
       creates a profile from metadata, so `do nothing` would keep the trigger's
       guess and silently discard the backed-up row. */
    const all = Object.keys(rows[0] ?? {})
    const cols = all.filter((c) => c !== t.pk)
    const upsert = cols.length
      ? `on conflict (${t.pk}) do update set\n    ` +
        cols.map((c) => `"${c}" = excluded."${c}"`).join(',\n    ')
      : `on conflict (${t.pk}) do nothing`

    /* The column list is explicit, and that is not cosmetic. `insert into t
       select * from jsonb_populate_recordset(...)` names EVERY column of the
       row type, generated ones included, and Postgres rejects the whole
       statement: "cannot insert a non-DEFAULT value into column". Leaving the
       value out of the payload is not enough — the column must not be named.
       Found by running the restore drill; the dump verified fine without it. */
    if (!rows.length) return `-- ${t.name}: 0 rows — nothing to restore\n`
    const list = all.map((c) => `"${c}"`).join(', ')

    return [
      `-- ${t.name}: ${rows.length} row(s)`,
      `insert into ${t.name} (${list})`,
      `select ${list} from jsonb_populate_recordset(null::${t.name}, $${TAG}$${payloads[t.name]}$${TAG}$::jsonb)`,
      `${upsert};`,
      '',
    ].join('\n')
  })

  const body = [
    '-- ===========================================================================',
    '-- Project Tracker — database dump (scripts/backup.mjs)',
    `-- taken_at: ${m.taken_at}`,
    `-- rows: ${TABLES.map((t) => `${t.name}=${m.counts[t.name]}`).join(' ')}`,
    '--',
    '-- CONTAINS BCRYPT PASSWORD HASHES. Treat as a credential file: never commit,',
    '-- never paste anywhere public. .audit/ is gitignored; keep it that way.',
    '--',
    '-- RESTORE: run supabase/schema.sql FIRST (it is idempotent), then this file',
    '-- whole, in one go — the transaction below is all-or-nothing.',
    '-- See docs/RUNBOOK.md.',
    '-- ===========================================================================',
    '',
    'begin;',
    '',
    ...blocks,
    'commit;',
    '',
  ].join('\n')

  /* The sentinel is the truncation check. A dump cut short by a full disk, a
     killed process or a half-flushed write loses its last line, and the hash of
     what remains cannot match. A backup that fails loudly at write time is
     recoverable; one that fails silently is discovered during the outage. */
  const digest = createHash('sha256').update(body, 'utf8').digest('hex')
  return `${body}-- END OF DUMP sha256=${digest}\n`
}

mkdirSync(outDir, { recursive: true })
const sqlPath = path.join(outDir, `dump-${stamp}.sql`)
const jsonPath = path.join(outDir, `dump-${stamp}.manifest.json`)

writeFileSync(sqlPath, sql, { encoding: 'utf8', mode: 0o600 })
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      ...manifest,
      sql_file: path.basename(sqlPath),
      sql_bytes: Buffer.byteLength(sql, 'utf8'),
      sql_sha256: sql.match(/sha256=([0-9a-f]{64})/)[1],
    },
    null,
    2,
  ) + '\n',
  { encoding: 'utf8', mode: 0o600 },
)

/* ---------------------------------------------------------------------------
   VERIFY FROM DISK. Everything above proves what was in memory; none of it
   proves what landed in the file. These checks re-read the artefacts the way a
   restore would, because the failure this guards against is a dump that reports
   OK and cannot be restored — strictly worse than no dump, since it stops you
   looking for one.
   ------------------------------------------------------------------------ */
const problems = []
const onDisk = readFileSync(sqlPath, 'utf8')

if (onDisk.length === 0) problems.push('the dump file is empty')

const sentinel = onDisk.match(/-- END OF DUMP sha256=([0-9a-f]{64})\n$/)
if (!sentinel) {
  problems.push('the end-of-dump sentinel is missing — the file is truncated')
} else {
  const body = onDisk.slice(0, onDisk.length - sentinel[0].length)
  const actual = createHash('sha256').update(body, 'utf8').digest('hex')
  if (actual !== sentinel[1]) problems.push('sha256 of the written body does not match the sentinel')
}

/* Re-parse the payloads out of the SQL text itself rather than trusting the
   in-memory objects: this is the only check that reads what a restore reads. */
const written = {}
for (const t of TABLES) {
  const re = new RegExp(`null::${t.name.replace('.', '\\.')}, \\$${TAG}\\$(.*?)\\$${TAG}\\$`, 's')
  const m = onDisk.match(re)
  if (!m) {
    problems.push(`${t.name}: no insert block found in the written file`)
    continue
  }
  try {
    written[t.name] = JSON.parse(m[1])
  } catch {
    problems.push(`${t.name}: the written JSON payload does not parse`)
    continue
  }
  if (written[t.name].length !== manifest.counts[t.name]) {
    problems.push(
      `${t.name}: file holds ${written[t.name].length} rows, database had ${manifest.counts[t.name]}`)
  }
}

/* Referential closure. Every count can match while the dump is still
   unrestorable: an owner_id with no matching auth.users row fails the FK on the
   way back in, and finds that out halfway through the restore. */
if (!problems.length) {
  const idsOf = (t) => new Set(written[t].map((r) => r.id))
  const users = idsOf('auth.users')
  const projects = idsOf('public.projects')
  const orphans = (rows, key, set, label) => {
    const n = rows.filter((r) => r[key] !== null && r[key] !== undefined && !set.has(r[key])).length
    if (n) problems.push(`${label}: ${n} row(s) reference a ${key} that is not in this dump`)
  }

  orphans(written['public.profiles'], 'id', users, 'public.profiles')
  orphans(written['public.projects'], 'owner_id', users, 'public.projects')
  orphans(written['public.tasks'], 'owner_id', users, 'public.tasks')
  orphans(written['public.tasks'], 'project_id', projects, 'public.tasks')
  orphans(written['auth.identities'], 'user_id', users, 'auth.identities')

  /* Password hashes are what make a restore usable at all — see the header. A
     user row restored without one is an account nobody can ever sign into, and
     this application has no password reset with which to repair it. */
  const noPw = written['auth.users'].filter((u) => !u.encrypted_password).length
  if (noPw) {
    problems.push(`auth.users: ${noPw} row(s) carry no password hash — those accounts would be unrecoverable`)
  }
}

if (problems.length) {
  // Removed, not left in place. An unverified dump sitting in the backups
  // directory is indistinguishable from a good one at three in the morning.
  for (const f of [sqlPath, jsonPath]) {
    try { unlinkSync(f) } catch {}
  }
  console.error('\nbackup ABORTED — the written dump failed verification:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nThe unusable files were deleted. No backup was produced.')
  process.exit(1)
}

/* ---------------------------------------------------------------------------
   RETENTION: keep the newest RETAIN verified dumps, delete anything older. Only
   reached on success, so a failing run can never prune the last good copy.
   Filenames sort chronologically by construction (UTC, fixed width).
   ------------------------------------------------------------------------ */
const dumps = readdirSync(outDir).filter((f) => /^dump-\d{8}-\d{6}\.sql$/.test(f)).sort()
const stale = dumps.slice(0, Math.max(0, dumps.length - RETAIN))
for (const f of stale) {
  try { unlinkSync(path.join(outDir, f)) } catch {}
  try { unlinkSync(path.join(outDir, f.replace(/\.sql$/, '.manifest.json'))) } catch {}
}

const c = manifest.counts
console.log(`\nbackup VERIFIED — ${path.relative(root, sqlPath)}`)
console.log(
  `  auth.users ${c['auth.users']} · auth.identities ${c['auth.identities']} · ` +
  `profiles ${c['public.profiles']} · projects ${c['public.projects']} · tasks ${c['public.tasks']}`)
console.log(
  `  ${Buffer.byteLength(sql, 'utf8')} bytes · sha256 sentinel matched · referential closure checked`)
if (stale.length) console.log(`  pruned ${stale.length} dump(s) beyond the newest ${RETAIN}`)
console.log('  contains password hashes — do not commit, do not share')
