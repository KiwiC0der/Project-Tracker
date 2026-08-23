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
 * Scan every .js file directly under `<dir>/assets` for live credentials.
 * Returns a list of human-readable descriptions; empty means clean.
 */
export function scanDist(dir, ref) {
  const assets = path.join(dir, 'assets')
  const bundles = existsSync(assets)
    ? readdirSync(assets)
        .filter((f) => f.endsWith('.js'))
        .map((f) => readFileSync(path.join(assets, f), 'utf8'))
    : []

  const leaks = []
  if (ref && bundles.some((b) => b.includes(ref))) leaks.push(`Supabase project ref "${ref}"`)
  // Every Supabase anon key is an HS256 JWT; the header encodes to this prefix.
  if (bundles.some((b) => /eyJhbGciOiJIUzI1NiIs/.test(b))) leaks.push('a JWT anon key')
  return leaks
}
