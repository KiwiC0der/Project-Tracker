#!/usr/bin/env node
/* ============================================================================
   GUARDED `npm run preview`.

   Plain `vite preview` serves dist/, which `npm run build` fills with the real
   Supabase credentials. Clicking through that bundle is not a preview — it is
   the production app pointed at production data, and signing up in it creates a
   real account. Use `npm run preview:demo` for anything interactive.

   This refuses to serve a dist/ that carries live credentials. Verifying a real
   build before `wrangler deploy` is legitimate, so the refusal is overridable:

       ALLOW_LIVE_PREVIEW=1 npm run preview

   Note the guard only covers this script. `npx vite preview --outDir dist`
   still bypasses it — the fix for that is to reach for `preview:demo` by habit.
   ========================================================================== */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { projectRef, scanDist } from './lib/credential-scan.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

if (!existsSync(dist)) {
  console.error('\nNo dist/ to preview. Run `npm run build` first,')
  console.error('or `npm run preview:demo` for a safe interactive build.')
  process.exit(1)
}

const leaks = scanDist(dist, projectRef(root))

if (leaks.length && process.env.ALLOW_LIVE_PREVIEW !== '1') {
  console.error(`\npreview REFUSED — dist/ contains ${leaks.join(' and ')}.`)
  console.error('This bundle talks to the LIVE backend: anything you do in it —')
  console.error('signing up, creating projects — writes to the real database.\n')
  console.error('  npm run preview:demo                 safe, localStorage-backed')
  console.error('  ALLOW_LIVE_PREVIEW=1 npm run preview  serve it anyway (deploy check)\n')
  process.exit(1)
}

if (leaks.length) {
  console.warn(`\nWARNING: serving a LIVE bundle (${leaks.join(', ')}).`)
  console.warn('Do not sign up or create data — it lands in the real database.\n')
}

const r = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview'],
  { cwd: root, stdio: 'inherit', shell: false },
)
process.exit(r.status ?? 1)
