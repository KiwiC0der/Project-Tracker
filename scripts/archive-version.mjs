#!/usr/bin/env node
/* ============================================================================
   ARCHIVE A TAGGED VERSION

     node scripts/archive-version.mjs v1.0.0

   Builds that git tag into public/v/<version>/ so the Versions page can open
   the real thing rather than describing it. Screenshots go stale and lie;
   a running build cannot.

   Mechanics worth knowing:

   - A detached worktree under .archive/ keeps your working tree untouched, and
     living INSIDE the repo means Node resolves bare imports up to the project's
     own node_modules — no second install per version.

   - Vite is spawned with an argument array and no shell. Passing --base=/v/x/
     through a shell on Windows lets MSYS rewrite the leading slash into a drive
     path, and the built HTML silently points at /x/ instead. Nothing errors;
     the archived page just loads nothing.

   - The archive is pruned of public/explorations and any nested public/v: an
     archived version should not carry its own archives, and duplicating the
     prototype lab per version would add ~600KB a time for nothing.
   ========================================================================== */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = process.argv[2]

if (!tag) {
  console.error('usage: node scripts/archive-version.mjs <git-tag>')
  process.exit(1)
}

const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(' ')} failed (${r.status ?? r.error})`)
    process.exit(1)
  }
}

const version = tag.replace(/^v/, '')
const tree = path.join(root, '.archive', tag)
const out = path.join(root, 'public', 'v', version)
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

// A left-over worktree from an interrupted run would check out stale source.
if (existsSync(tree)) run('git', ['worktree', 'remove', '--force', tree])
run('git', ['worktree', 'add', '--detach', tree, tag])

// The build bakes VITE_* in, so the archive needs the same credentials as the
// live app or it ships pointing at nothing.
if (existsSync(path.join(root, '.env'))) {
  cpSync(path.join(root, '.env'), path.join(tree, '.env'))
}

run(process.execPath, [vite, 'build', `--base=/v/${version}/`, '--outDir', out, '--emptyOutDir'], tree)

for (const junk of ['explorations', 'v']) {
  rmSync(path.join(out, junk), { recursive: true, force: true })
}

run('git', ['worktree', 'remove', '--force', tree])
console.log(`\narchived ${tag} -> public/v/${version}/`)
