#!/usr/bin/env node
/* ============================================================================
   BUILD THE DEMO BUNDLE — the only build that is safe to click around in.

   `npm run build` bakes the real Supabase credentials from .env into dist/.
   Anyone who then runs `vite preview --outDir dist` is driving the LIVE
   backend: signing up there creates a real account in the real project. That
   has already happened once during development, which is why this script
   exists rather than a documented incantation.

   A shell-prefix (`VITE_SUPABASE_URL= vite build`) does not work here: npm on
   Windows runs scripts through cmd.exe, which treats `VAR=` as a command and
   fails. Setting the vars in Node covers every platform.

   Empty strings are enough — src/lib/supabase.ts gates on
   `Boolean(url && anonKey)`, so an empty value reads as unconfigured and the
   app falls back to the localStorage demo backend.
   ========================================================================== */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-demo')

const r = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
   'build', '--outDir', out, '--emptyOutDir'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
)
if (r.status !== 0) process.exit(r.status ?? 1)

/* Verify rather than assume. A build that silently picked up .env would send
   a tester at the production database, so this refuses to hand over a bundle
   it has not checked. The ref is read from .env so nothing is hardcoded. */
let ref = null
if (existsSync(path.join(root, '.env'))) {
  const m = readFileSync(path.join(root, '.env'), 'utf8')
    .match(/VITE_SUPABASE_URL\s*=\s*https:\/\/([a-z0-9]+)\.supabase\.co/i)
  ref = m?.[1] ?? null
}

const assets = path.join(out, 'assets')
const bundles = existsSync(assets)
  ? readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(assets, f), 'utf8'))
  : []

const leaks = []
if (ref && bundles.some((b) => b.includes(ref))) leaks.push(`Supabase project ref "${ref}"`)
if (bundles.some((b) => /eyJhbGciOiJIUzI1NiIs/.test(b))) leaks.push('a JWT anon key')

if (leaks.length) {
  console.error(`\ndemo build ABORTED — dist-demo contains ${leaks.join(' and ')}.`)
  console.error('This bundle would talk to the live backend. Do not preview it.')
  process.exit(1)
}

console.log('\ndist-demo/ verified free of live credentials — safe to preview.')
