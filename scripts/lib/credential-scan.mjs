/* ============================================================================
   SHARED CREDENTIAL SCANNER for built bundles.

   `npm run build` bakes the real Supabase URL and anon key from .env into the
   output. That is correct for a deploy and wrong for anything a human clicks
   around in: a tester who signs up against such a bundle creates a real account
   in the real project. That happened once during v2.5 development, which is why
   both the demo build and the preview server check rather than trust.

   scanDist() answers one question — does this directory's JS contain live
   credentials? — and is used by build-demo.mjs (must be clean) and preview.mjs
   (must warn before serving).
   ========================================================================== */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The project ref out of .env, so nothing is hardcoded. null if no .env. */
export function projectRef(root) {
  const env = path.join(root, '.env')
  if (!existsSync(env)) return null
  const m = readFileSync(env, 'utf8')
    .match(/VITE_SUPABASE_URL\s*=\s*https:\/\/([a-z0-9]+)\.supabase\.co/i)
  return m?.[1] ?? null
}

/**
 * Every .js file anywhere under `dir`, not just `<dir>/assets`.
 *
 * The non-recursive version was a false negative waiting to happen, and it
 * found one: `npm run archives` copies a full built app into `public/v/<ver>/`
 * for every past release, Vite copies `public/` into the output verbatim, and
 * each of those archived bundles was built with the real .env of its day. So
 * `dist-demo/v/1.0.0/assets/index-*.js` carries the live project ref while the
 * top-level `dist-demo/assets/*.js` is genuinely clean — and the scanner
 * printed "verified free of live credentials" over the top of it.
 *
 * The lesson is not "add /v/ to the list". A scanner that checks one directory
 * cannot make a claim about a tree, and this one's output is read as a claim
 * about a tree. So it walks the whole thing.
 */
function jsFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...jsFiles(full))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) out.push(full)
  }
  return out
}

/**
 * Scan a built output directory for live credentials.
 * Returns human-readable descriptions; empty means clean.
 *
 * `.html` is scanned as well as `.js`: an inline <script> in an archived
 * index.html would carry a key just as effectively as a bundle chunk.
 */
export function scanDist(dir, ref) {
  const files = jsFiles(dir)
  const hits = (test) => files.filter((f) => test(readFileSync(f, 'utf8')))

  const leaks = []
  if (ref) {
    const found = hits((b) => b.includes(ref))
    if (found.length) {
      leaks.push(`Supabase project ref "${ref}" in ${found.length} file(s), e.g. ` +
        path.relative(dir, found[0]))
    }
  }
  // Every Supabase anon key is an HS256 JWT; the header encodes to this prefix.
  const jwt = hits((b) => /eyJhbGciOiJIUzI1NiIs/.test(b))
  if (jwt.length) {
    leaks.push(`a JWT anon key in ${jwt.length} file(s), e.g. ` + path.relative(dir, jwt[0]))
  }
  return leaks
}
