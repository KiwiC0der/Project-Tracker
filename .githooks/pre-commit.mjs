#!/usr/bin/env node
/* ============================================================================
   PRE-COMMIT GATE.

   This repository has no CI. There is one developer, on one machine, pushing
   straight to a branch that deploys. This hook is therefore not a convenience
   layered on top of a server-side check — it is the only mechanical reader
   this code has before it reaches production. Everything below is shaped by
   that, and by the fact that a gate which is annoying gets `--no-verify`'d and
   then quietly reports green for the rest of the project's life.

   THREE RULES IT OBEYS:

   1. FAST. Budget is ~5s. `tsc` runs incrementally against the committed
      project; eslint runs over the *staged files only*, with a cache in
      node_modules/.cache. Anything that pushed this past a few seconds would
      be trading a real gate for a theoretical one.

   2. RATCHETS, NEVER RESETS. The codebase was not at zero lint findings when
      this hook was written (15 errors, 15 warnings). A gate set to zero on a
      codebase that is not at zero fails on its first run and is switched off
      within a week. So the counts of the day are committed in
      docs/audits/baselines/lint.json, per file, and a commit fails only when
      a staged file gets WORSE than its recorded number. New files start at 0.
      Fix a file below its baseline and the number here should be lowered in
      the same commit — that is the ratchet, and it only turns one way.

   3. TYPES ARE NOT NEGOTIABLE. `tsc --noEmit` is at zero errors and must stay
      there, so it is a hard gate with no baseline. Until today the build ran
      `tsc -b --noCheck`, which parses types and discards the result: `strict`
      was decorative. If you are reading this because the hook is slow, cut
      the lint half, not this half.

   ESCAPE HATCH: `git commit --no-verify`. It exists and is sometimes right.
   If you reach for it twice in a week, the gate is wrong — fix the gate.

   IF THIS FILE IS NOT RUNNING: the hook lives in .git/hooks/, which is not
   cloned. Run `npm run hooks` to (re)install it. A missing hook is the worst
   failure mode here, because it looks exactly like a passing one.
   ========================================================================== */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASELINE = 'docs/audits/baselines/lint.json'
const started = Date.now()
const fail = (msg) => { console.error(`\npre-commit REFUSED — ${msg}\n`); process.exit(1) }

/* Both tools are spawned as plain node processes against their entry points
   rather than through `npx`. On Windows `npx` costs roughly a second of
   resolution per call, and two of those is a fifth of the whole time budget
   spent deciding where a file already on disk lives. */
const run = (bin, args) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

/* ACMR, not ACMRD: a file staged for deletion has nothing to lint, and asking
   eslint to read it would fail on a path that no longer exists. */
const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  .toString().split('\n').map((s) => s.trim()).filter(Boolean)

/* ============================================================================
   SECRET GATE — runs FIRST, and deliberately before `lintable` is computed.

   `lintable` drops anything under dist/, and the hook exits early when nothing
   lintable is staged. A commit consisting solely of a built tree would
   therefore have sailed straight through — which is not hypothetical: that is
   exactly how a `dist-verify/` tree carrying the live anon key reached a public
   tag. The check that would have caught it has to run before the filter that
   would have hidden it.

   Milliseconds, so it costs nothing to put ahead of the type-check.

   GitHub's own secret scanning is enabled on this repo WITH push protection,
   and it cannot see this project's one emitted secret: Supabase is not a
   scanning partner, anon keys are not a supported pattern, and there is no
   generic JWT detector. So this is not a second opinion — for this secret
   class it is the only reader, which is why it is hand-rolled rather than a
   shell-out that could silently skip when a binary is missing.
   ========================================================================== */
/* Text files only. A staged PNG is not a credential and reading it as UTF-8
   wastes the time budget. Build output is gitignored, but `git add -f` is not
   hypothetical: committing a dist-verify/ tree is exactly how the live anon
   key reached a public tag in v2.6.0. */
const SECRET_PATTERNS = [
  [/eyJhbGciOiJIUzI1NiIs/, 'a Supabase anon/JWT key (HS256 JWT header)'],
  [/https:\/\/[a-z0-9]{20}\.supabase\.co/i, 'a live Supabase project ref'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'a private key'],
  [/postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/, 'a Postgres URL with a password'],
]

/* The two files that must contain these patterns as literals in order to look
   for them. Without this the gate blocks anyone editing the scanner, which is
   the fastest possible way to get the gate deleted. Verified: these are the
   ONLY false positives across all 72 tracked files — the allowlist is two
   entries and must stay that short. Never add a file here to make a commit go
   through; unstage the secret instead. */
const SECRET_SCANNER_FILES = new Set([
  'scripts/lib/credential-scan.mjs',
  '.githooks/pre-commit.mjs',
])

const secretHits = []
for (const file of staged) {
  if (SECRET_SCANNER_FILES.has(file)) continue
  if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|zip|pdf)$/i.test(file)) continue
  // Read the STAGED blob, not the working tree — they can differ, and it is
  // the staged bytes that are about to become a public commit.
  const blob = spawnSync('git', ['show', `:${file}`], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  if (blob.status !== 0 || !blob.stdout) continue
  for (const [re, what] of SECRET_PATTERNS) {
    if (re.test(blob.stdout)) secretHits.push(`${file} — ${what}`)
  }
}

if (secretHits.length) {
  console.error('\npre-commit REFUSED — a credential is staged:\n')
  for (const h of secretHits) console.error(`  ${h}`)
  console.error(`
This repository is PUBLIC. A commit is not undone by a later deletion: an
already-pushed secret stays reachable through tags and forks, and rotation —
not a revert, not a rebase — is the only thing that invalidates it.

  Unstage it:      git restore --staged <file>
  Built output?    it belongs in .gitignore, never in a commit
  Already pushed?  rotate the key first, then worry about the history
`)
  process.exit(1)
}

const lintable = staged.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.startsWith('dist'))
if (!lintable.length) process.exit(0)

/* ---- 1. types: hard gate, whole project ---------------------------------- */
/* Per-file typechecking is not a thing — a change in store.ts breaks a caller
   in DashboardScene.tsx that is not staged. Incremental via tsbuildinfo. */
const tsc = run('node_modules/typescript/bin/tsc', ['-b'])
if (tsc.status !== 0) {
  console.error(tsc.stdout || '')
  console.error(tsc.stderr || '')
  fail('`tsc -b` reported type errors. The project is at zero; keep it there.')
}

/* ---- 2. lint: ratcheted against the committed per-file baseline ---------- */
const eslint = run('node_modules/eslint/bin/eslint.js', [
  '--format', 'json',
  /* Only staged files are linted, so the cache is what keeps a one-file commit
     from paying for a cold plugin load every time. It lives under
     node_modules/, which is already gitignored. */
  '--cache', '--cache-location', 'node_modules/.cache/eslint/',
  ...lintable,
])
/* status 1 means "found problems", which is expected while a baseline exists.
   status 2 means eslint itself broke — a bad config, a crashed rule — and that
   must not read as a pass. */
if (eslint.status !== 0 && eslint.status !== 1) {
  console.error(eslint.stderr || eslint.stdout || '')
  fail('eslint failed to run. Config or plugin problem, not a code problem.')
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} }
const results = JSON.parse(eslint.stdout || '[]')
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim()
/* eslint reports absolute, Windows-separated paths; the baseline is keyed on
   repo-relative POSIX ones. Both halves matter — on this machine the two forms
   never match, and a lookup miss reads as "new file, baseline 0", which would
   fail every commit that touches a file with a pre-existing finding. */
const BACKSLASH = String.fromCharCode(92)
const posix = (p) => p.split(BACKSLASH).join('/')
const rel = (p) => posix(p).replace(`${posix(repoRoot)}/`, '')

const regressions = []
const improvements = []
for (const r of results) {
  const f = rel(r.filePath)
  const was = base.files[f] ?? { errors: 0, warnings: 0 }
  const now = { errors: r.errorCount, warnings: r.warningCount }
  if (now.errors > was.errors || now.warnings > was.warnings) {
    regressions.push({ f, was, now, messages: r.messages })
  } else if (now.errors < was.errors || now.warnings < was.warnings) {
    improvements.push({ f, was, now })
  }
}

if (regressions.length) {
  console.error('\npre-commit REFUSED — new lint findings in staged files.\n')
  for (const { f, was, now, messages } of regressions) {
    console.error(`  ${f}   ${was.errors}e/${was.warnings}w  ->  ${now.errors}e/${now.warnings}w`)
    for (const m of messages) {
      console.error(`      ${m.line}:${m.column}  ${m.severity === 2 ? 'error  ' : 'warning'}  ${m.message}  ${m.ruleId ?? ''}`)
    }
  }
  console.error(`\nFix them, or — if the finding is wrong — change the rule in eslint.config.js`)
  console.error(`and say why in a comment. Raising the number in ${BASELINE} is not a fix.\n`)
  process.exit(1)
}

/* An improvement is written straight back into the baseline and staged with the
   commit, so the ratchet tightens by itself. Without this it only tightens when
   somebody remembers to, which is never. */
if (improvements.length) {
  for (const { f, now } of improvements) base.files[f] = now
  writeFileSync(BASELINE, `${JSON.stringify(base, null, 2)}\n`)
  execFileSync('git', ['add', BASELINE])
  console.log(`pre-commit: baseline tightened for ${improvements.map((i) => i.f).join(', ')}`)
}

console.log(`pre-commit OK — ${lintable.length} file(s), ${Date.now() - started}ms`)
