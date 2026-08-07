#!/usr/bin/env node
/* ============================================================================
   Ensure every past release has a build under public/v/.

   Runs as part of `npm run build`, so a deploy can never ship a Versions page
   whose links 404. Archives are NOT committed — they are reproducible from the
   git tags, which is a stronger guarantee than a directory someone remembered
   to check in, and keeps ~1MB per release out of history forever.

   Already-built versions are skipped, so this costs nothing on a warm tree.
   ========================================================================== */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const here = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

const tags = spawnSync('git', ['tag', '-l', 'v*'], { cwd: root, encoding: 'utf8' })
if (tags.status !== 0) {
  // A tarball export or a shallow clone has no tags. That is not a build error;
  // the Versions page simply has nothing to offer but source links.
  console.log('archive-all: no git tags available, skipping')
  process.exit(0)
}

const wanted = tags.stdout.split('\n').map((t) => t.trim()).filter(Boolean)
  .filter((t) => t.replace(/^v/, '') !== here)   // the current release is not an archive

let built = 0
for (const tag of wanted) {
  const version = tag.replace(/^v/, '')
  if (existsSync(path.join(root, 'public', 'v', version, 'index.html'))) continue
  console.log(`archive-all: building ${tag}`)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'archive-version.mjs'), tag],
    { cwd: root, stdio: 'inherit', shell: false })
  if (r.status !== 0) process.exit(1)
  built++
}

console.log(`archive-all: ${wanted.length} past release(s), ${built} built, ${wanted.length - built} already present`)
