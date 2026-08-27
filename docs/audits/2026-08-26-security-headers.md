# Audit 05 — security headers and Content-Security-Policy

**Status** RESOLVED — deployed to pt.anteneh.tech 2026-08-26, version `4227d0a6`.
Headers confirmed live via `curl -I`; zero CSP violations on the production hero.

**Date:** 2026-08-26
**Scope:** HTTP response headers served by the Cloudflare Workers static-assets
deploy at `https://pt.anteneh.tech`, and the Content-Security-Policy the app can
actually run under.
**Standard:** MDN HTTP Observatory, algorithm version 4
(<https://developer.mozilla.org/en-US/observatory>). Grade bands and per-test
score modifiers were read from the scanner's own source
(`mdn/mdn-http-observatory`, `src/grader/charts.js` and `src/analyzer/tests/`)
rather than recalled, because the score depends on branch order in the CSP test
in ways the prose documentation does not spell out.
**Artefact:** `public/_headers` (new).

---

## ⚠ Do not commit this file yet

`docs/audits/README.md` is explicit: a report goes in `docs/audits/` **only once
its finding is fixed and deployed**, because this repository is public and a
live finding published here is an attacker's to-do list.

At the time of writing, **nothing in this report is deployed**. `public/_headers`
exists in the working tree and has not been built, deployed, or committed. Until
`npx wrangler deploy` has run and the `curl` check at the bottom of this document
passes, this file describes a live exposure and belongs in `.audit/`.

The gate is one command; see *Verification after deploy*.

---

## What was measured, and how

Three separate measurements, kept separate because they answer different
questions.

### 1. The live deploy's current headers

```
curl -sI http://pt.anteneh.tech/     -> 301 -> https://pt.anteneh.tech/
curl -sI https://pt.anteneh.tech/    -> HTTP/2 200
```

The HTTPS response carries `date`, `content-type`, `cf-cache-status`,
`cache-control`, `report-to`, `nel`, `server`, `cf-ray`, `alt-svc`. **No
security headers of any kind, and no `set-cookie`.** The premise of this audit
is confirmed rather than assumed. The HTTP-to-HTTPS redirect is in place.

### 2. What the app actually loads

Measured, not inferred, by building the credential-free demo bundle
(`npm run preview:demo`) and driving it through hero → sign-up → dashboard →
mark-a-task-done (confetti + toast) → appearance dialog → light-mode switch,
reading the network log, the console, and the live DOM.

| Question | Measured answer |
|---|---|
| Scripts | 1 same-origin ES module entry + 10 same-origin `modulepreload` chunks. **No inline `<script>` in the app shell.** No third-party script host. |
| Stylesheets | 1 same-origin `<link rel=stylesheet>`. |
| Runtime-injected `<style>` elements | **4** — `@paper-design/shaders` (334 B, at import), `sonner` (14,916 B, at import), `#liquid-metal-button-styles` (1,565 B, `useInjectedStyles`), and the `TOAST_CSS` block React renders in `src/components/ui/toast.tsx`. |
| Inline `style` attributes | **25** on the dashboard (panel geometry for drag/resize, token-coloured swatches). |
| `adoptedStyleSheets` | 0. |
| Fonts | **None fetched.** All four appearance faces are system stacks (`src/index.css` lines 392–412). |
| Images | `favicon.svg`, same-origin. No `data:` image was observed loading; supabase-js contains one `data:image/svg+xml` on the MFA/TOTP QR path, which this app never reaches. |
| Workers / Service Workers | **None.** No `new Worker`, no `createObjectURL`, no `blob:`, no `importScripts`, no registered service worker. |
| WASM / eval | **None.** No `WebAssembly`, no `eval(`, no `new Function`. Three.js and `@paper-design/shaders` compile GLSL on the GPU, which CSP does not govern — `'wasm-unsafe-eval'` is **not** needed, and neither is `worker-src blob:`. |
| Canvas | 1 (`webgl2` context acquired successfully under the policy). |
| `connect-src` destinations | In demo mode, none. In production, `https://<ref>.supabase.co` only — auth (`signUp`, `signInWithPassword`, `signOut`, `getSession`, `getUser`), PostgREST, and one `rpc('seed_starter_project')`. **No Realtime, no Storage, no Edge Functions**, so no `wss:` origin is required today. |
| Cookies | **None.** The Supabase session lives in `localStorage` under `project-tracker-auth`. |
| Browser APIs used | `localStorage`, `sessionStorage`, `matchMedia`, `navigator.clipboard.writeText`. Nothing else. |

### 3. Does the proposed policy break the app?

The demo bundle (`dist-demo`, verified free of live credentials) plus
`public/explorations/` were copied to a scratch directory and served by a local
static server that parses `public/_headers` using the same rules as Cloudflare's
parser — and then **promotes the Report-Only policy to enforcing**, so anything
that would eventually be blocked is blocked now. Violations were collected two
ways: a `securitypolicyviolation` listener installed before the app's own
scripts, and a `report-uri` collector on the server.

Result over the full app flow plus four of the eleven exploration prototypes
(`index`, `dashboard`, `composingroom`, `orbit`):

> **0 violations.** WebGL hero renders, confetti fires, toasts style correctly,
> the appearance dialog opens, light/dark switching works, and every exploration
> prototype renders its content.

---

## The policy, and every compromise in it

```
default-src 'none';
script-src 'self' <11 sha256 hashes>;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://*.supabase.co;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

### Compromise 1 — `style-src 'unsafe-inline'` is unavoidable. Saying otherwise would be a lie.

Four separate `<style>` blocks are injected at runtime and 25 elements carry
`style` attributes. A hash-based `style-src` would have to cover sonner's
14 KB stylesheet — which changes on every version bump of a dependency — and
hashes do not apply to `style` attributes at all (those need
`style-src-attr 'unsafe-inline'` regardless). Tailwind v4 and the theming system
write CSS custom properties at runtime, which compounds it.

So this policy is **not** a "strict CSP". It is a strict *script* policy with an
open style policy. The distinction matters: `style-src 'unsafe-inline'` allows
an attacker who already has an injection point to restyle the page (and to
exfiltrate a limited amount of data via CSS selectors in older browsers); it
does not let them execute script. `script-src` carries no `'unsafe-inline'`, no
`'unsafe-eval'`, and no wildcard, which is where the actual XSS defence lives.

Observatory scores this exact shape as `csp-implemented-with-unsafe-inline-in-style-src-only`,
modifier **0** — a *pass*, not a penalty — provided `form-action` is set to
`'self'` or `'none'`. It is.

### Compromise 2 — `connect-src https://*.supabase.co`, not the exact project ref

The project ref is already public: it is baked into the deployed bundle at
`https://pt.anteneh.tech/assets/*.js` and into all ten archived builds under
`/v/*`, and the anon key is a publishable key protected by RLS (see
`.env.example` and `src/lib/supabase.ts`). So naming it here would leak nothing
new *to a visitor*.

It would, however, move it from "readable by anyone who opens the deployed
bundle" to "readable by anyone who reads the repository", and `public/v/` is
gitignored precisely so the repo does not carry it. That asymmetry is not worth
the marginal tightening, so the wildcard stands.

The cost is stated plainly: an XSS that got past `script-src` could exfiltrate to
*any* `*.supabase.co` project rather than only ours. Given such an attacker could
equally read the session token out of `localStorage` and use it against our own
project, the wildcard is close to free. **If the maintainer prefers, replacing
`https://*.supabase.co` with the exact `https://<ref>.supabase.co` is a
one-token edit and strictly better.**

### Compromise 3 — eleven script hashes for `/explorations/*`

`public/explorations/` holds eleven frozen prototypes, each with one inline
`<script>` block. Under `script-src 'self'` they render blank.

The alternatives were: give that path `'unsafe-inline'`, or hash the blocks.
`'unsafe-inline'` was rejected because those pages share an origin with the
app — and therefore share `localStorage`, and therefore the Supabase session
token. They build their DOM with `innerHTML` over data they persist themselves;
that is a stored-XSS surface, and `'unsafe-inline'` would additionally re-enable
inline event handlers (`onerror=`), which is exactly the shape such an injection
takes. So: hashes.

**The hashes must be computed over CRLF-normalised text.** This was found the
hard way: the first attempt hashed the raw file bytes, and five of eleven pages
rendered blank because the HTML tokenizer normalises `\r\n` to `\n` before the
script text is hashed, and this repository has mixed line endings with
`core.autocrlf=true` and no `.gitattributes`. Normalising is not merely a fix —
it is what makes the hashes *stable*, because it renders the CRLF/LF churn
between a Windows checkout and a Linux one invisible to the hash.

The hashes live in the single global `script-src` rather than in a
`/explorations/*` rule of their own, for a reason given in the next section.
The security cost of that is close to zero: an attacker who can inject one of
those eleven exact, known, self-contained scripts gains nothing they could not
get by simply loading `/explorations/dashboard.html`.

Regenerate with:

```bash
node -e "const{readFileSync,readdirSync}=require('fs'),{createHash}=require('crypto'),p=require('path'),d='public/explorations';
for(const f of readdirSync(d).filter(f=>f.endsWith('.html'))){const s=readFileSync(p.join(d,f),'utf8').replace(/\r\n?/g,'\n');
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m;while(m=re.exec(s))
console.log(f,\"'sha256-\"+createHash('sha256').update(m[1],'utf8').digest('base64')+\"'\");}"
```

### Compromise 4 — Report-Only first means the Observatory grade does not improve yet

The rollout ships two CSP headers:

* `Content-Security-Policy: base-uri 'self'; form-action 'self'; frame-ancestors 'none'` — **enforcing**. These three directives constrain navigation and framing and cannot block a resource from loading, so they cannot break the app regardless of what it fetches.
* `Content-Security-Policy-Report-Only: <the full policy>` — observation only.

Report-Only is the right first move for `script-src`, because a mistake there is
a blank page for every visitor and there is no way to be certain from a local
measurement that a real deploy fetches the same things.

It is the **wrong** move for `frame-ancestors`, which browsers ignore entirely in
a report-only policy. A pure report-only rollout would have left the sign-in page
framable for the whole observation window — i.e. it would have left the single
most serious finding in this audit unfixed while looking like progress. Hence the
split.

---

## Non-CSP headers, and the reasoning

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Unambiguous. The concrete failure mode here is `/v/*`: ten archived builds served from this origin, where anything a sniffing browser decides is script runs with access to the live app's `localStorage`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Full URL to ourselves, bare origin to third parties, nothing on downgrade. The app links out to GitHub; those links should not carry the in-app path. In Observatory's `goodness` list. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Severs `window.opener` in both directions. Outbound links already carry `rel="noreferrer"`; this covers being opened *by* a hostile page. Nothing here uses popups. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Stops other origins embedding our assets. Nothing here is meant to be embedded. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | See below. |
| `Permissions-Policy` | 25 features denied | Enumerated from the API grep, not copied. `clipboard-write` is deliberately **not** denied — `src/components/ErrorBoundary.tsx` uses `navigator.clipboard.writeText` to copy the crash report, and denying it would turn the only useful control on the crash screen into a dead button. Not scored by Observatory; cheap defence in depth. |
| `X-Frame-Options` | **omitted** | `frame-ancestors 'none'` supersedes it. XFO's `ALLOW-FROM` was never implemented outside legacy IE/Edge, it cannot express an allow-list, and every browser this app targets honours `frame-ancestors`. Observatory agrees: its `x-frame-options` test returns `x-frame-options-implemented-via-csp` (+5) when `frame-ancestors` is present in the *enforcing* header — which is another reason `frame-ancestors` is in the enforcing policy from day one. |
| `Cross-Origin-Embedder-Policy` | **omitted** | Worth +10 to the score. Every subresource is same-origin so `require-corp` would probably work — but COEP is the one of the three cross-origin headers that breaks a page outright when it is wrong, and this app has no `SharedArrayBuffer` or high-resolution-timer requirement that would earn the risk. Revisit only if a real need appears. |
| `X-Robots-Tag: noindex` on `/v/*` | applied | See *Out of scope* — the search half of the problem belongs here; the rest does not. |

### On `Strict-Transport-Security`, and why not `preload`

`max-age=31536000` (one year) with `includeSubDomains` and **no `preload`**.

`includeSubDomains` is safe here specifically because HSTS binds to the host
that served it: it covers `pt.anteneh.tech` and `*.pt.anteneh.tech`, which has no
subdomains to strand. It does **not** touch sibling subdomains of
`anteneh.tech`. Setting the same header on the apex would be a different and
much larger decision.

`preload` is omitted deliberately. `max-age` is browser-local state that expires;
the preload list is compiled into browser binaries, and removal takes months of
release cycles across every vendor. Submitting the host is a promise that it will
speak HTTPS forever, and it cannot be withdrawn on the timescale of noticing a
mistake. Observatory pays **+5** for `preload` — and that bonus is only awarded
at all if the pre-bonus score is already ≥ 90, so it is worth nothing until the
enforcing policy lands, and even then it is 5 points against an irreversible
commitment on a hobby subdomain. Recommendation: never, unless the domain becomes
load-bearing.

---

## Expected Observatory grade

Score starts at 100. Round 1 subtracts penalties; **bonuses are only added if the
post-penalty score is ≥ 90**, which is what makes the phasing visible in the
number.

### Baseline — measured today, before any change

| Test | Result | Modifier |
|---|---|---|
| Content Security Policy | not implemented | **−25** |
| Strict Transport Security | not implemented | **−20** |
| X-Frame-Options | not implemented | **−20** |
| X-Content-Type-Options | not implemented | **−5** |
| Redirection | HTTP → HTTPS present | 0 |
| Referrer Policy | not implemented (passes) | 0 |
| Cookies | none set | 0 |
| Subresource Integrity | all scripts same-origin | 0 |
| CORS / CORP / COEP / COOP | not implemented | 0 |

**Baseline: 30 → grade D.** (Bands: 100+ A+, 90–99 A, 85–89 A−, 80–84 B+, 70–79 B,
65–69 B−, 60–64 C+, 50–59 C, 45–49 C−, 40–44 D+, 30–39 D, 25–29 D−, 0–24 F.)

### Phase 1 — this commit (partial enforcing CSP + Report-Only)

| Test | Expected result | Modifier |
|---|---|---|
| Content Security Policy | `script-src` unset in the enforcing header, so it falls back to `*` → `csp-implemented-with-unsafe-inline` | **−20** |
| X-Frame-Options | `x-frame-options-implemented-via-csp` — a **pass**, and a +5 *bonus* that is not awarded below 90 | 0 |
| Strict Transport Security | max-age ≥ 6 months | 0 |
| X-Content-Type-Options | `nosniff` | 0 |
| Referrer Policy | private — +5 bonus, not awarded below 90 | 0 |
| CORP / COOP | same-origin — +10 each, not awarded below 90 | 0 |
| Everything else | as baseline | 0 |

**Phase 1: 80 → grade B+.**

Worth naming precisely: shipping the full policy as Report-Only earns **nothing**.
Observatory's CSP test returns `csp-not-implemented-but-reporting-enabled`, which
carries the same **−25** as no CSP at all, and because `csp.data` is null the
X-Frame-Options test then also fails at **−20**. A pure report-only rollout would
score **55 (C)** — *worse* than phase 1, and with the sign-in page still framable.
That is the entire argument for the split header.

### Phase 2 — after swapping Report-Only to enforcing

| Test | Expected result | Modifier |
|---|---|---|
| Content Security Policy | `csp-implemented-with-unsafe-inline-in-style-src-only` — a **pass** | 0 |
| **Post-penalty total** | | **100** ≥ 90, so bonuses apply |
| Referrer Policy | private | +5 |
| X-Frame-Options | via CSP | +5 |
| Cross-Origin-Resource-Policy | same-origin | +10 |
| Cross-Origin-Opener-Policy | same-origin | +10 |

**Phase 2: 130 → grade A+** (the scanner caps at 145).

Tests expected to **pass** in phase 2: CSP, cookies, CORS, redirection,
referrer-policy, HSTS, SRI, X-Content-Type-Options, X-Frame-Options, CORP, COOP.
Tests expected to **fail**: none. COEP will report `coep-not-implemented`
(modifier 0, and its `pass` flag is false in the scanner) — that is the one row
that will look red on the report card and is an accepted, documented decision,
not an oversight.

---

## What was fixed

| Finding | Severity | Fix |
|---|---|---|
| Sign-in page framable by any origin (clickjacking) | **High** | `frame-ancestors 'none'` in the **enforcing** CSP |
| No CSP at all | High | Full policy shipped Report-Only; enforcing swap gated on observed-zero violations |
| No `base-uri` — an injected `<base>` could repoint every relative script URL | Medium | `base-uri 'self'`, enforcing |
| No `form-action` — an injected form could POST a password cross-origin | Medium | `form-action 'self'`, enforcing |
| MIME sniffing | Low–Medium | `X-Content-Type-Options: nosniff` |
| Full URLs leaking to GitHub via `Referer` | Low | `Referrer-Policy: strict-origin-when-cross-origin` |
| No HSTS | Medium | `max-age=31536000; includeSubDomains` |
| Powerful features not denied | Low | 25-feature `Permissions-Policy` |
| Archived builds competing in search | Low | `X-Robots-Tag: noindex` on `/v/*` |

**Commit:** not yet committed. `public/_headers` is untracked in the working tree
alongside other in-flight audit work. Fill this line in when it lands.

---

## What was accepted

1. **`style-src 'unsafe-inline'`.** Unavoidable without rewriting how sonner,
   `@paper-design/shaders`, the liquid-metal button and the theming system inject
   CSS. Accepted; the script policy is where the defence is.
2. **`connect-src https://*.supabase.co` rather than the exact ref.** Accepted to
   keep the project ref out of a committed file. One-token upgrade available.
3. **Eleven inline-script hashes in the global `script-src`.** Accepted because a
   per-path CSP rule cannot loosen the global one (see below), and the hashed
   content is fixed, known, and already reachable on the origin.
4. **No `Cross-Origin-Embedder-Policy`.** −10 points of available score traded for
   not shipping the header most likely to break the page.
5. **No HSTS `preload`.** −5 points traded for reversibility.
6. **Report-Only first for `script-src`.** One grade band (B+ instead of A+) held
   for one deploy cycle, in exchange for not risking a blank page.

### A parser behaviour that dictated the file's shape

Cloudflare's `_headers` parser
(`workers-sdk/packages/workers-shared/utils/configuration/parseHeaders.ts`,
read at source) joins same-named headers from *every* matching rule with a comma.
For most headers that is harmless. For CSP it is not: `Content-Security-Policy: A, B`
is two policies and the browser enforces **both** — the intersection. A
`/explorations/*` rule therefore **cannot** loosen the `script-src` set on `/*`;
it can only tighten it. That is why this file has exactly one CSP rule.

Also confirmed from source, and relied on: `#` comments and blank lines are
skipped and do **not** count against the 100-rule limit; the 2,000-character
per-line limit is applied to the trimmed line including the header name, and an
over-length line is **dropped silently** rather than truncated. Current usage:
**2 of 100 rules**, longest line **890 of 2,000 characters** (the Report-Only
policy).

---

## What this run could NOT check

This is the section that matters most on the next run. Read it before trusting
any number above.

1. **Nothing in `public/_headers` has been observed working.** `_headers` is
   parsed by Cloudflare at deploy time. `vite preview` does not read it, and this
   audit was forbidden from deploying. Every statement about what the deployed
   site will send is a **prediction**. The local verification used a
   hand-written server that reimplements the parser from its source; that
   validates the *policy*, not the *delivery*.
2. **The Observatory grades are calculated, not scanned.** They were derived by
   reading `mdn/mdn-http-observatory` and applying its documented branch order to
   the headers this file declares. No scan was run, because the scanner requires
   a public host and the headers are not on it yet. Treat 80 and 130 as
   falsifiable predictions to compare against, not as results.
3. **The CSP was validated against the *demo* bundle, not the production one.**
   `dist-demo` is built with empty Supabase credentials, so **no request to
   Supabase was ever made under the policy**. `connect-src https://*.supabase.co`
   is the one directive in the policy that has not been exercised even once. It
   is also the one most likely to bite: if supabase-js opens a Realtime
   WebSocket in some path not exercised here, `wss://` would be blocked. Grep
   says no `.channel()` call exists; that is evidence, not proof.
4. **Four of eleven exploration prototypes were loaded.** `index`, `dashboard`,
   `composingroom` and `orbit` were verified (deliberately spanning both files
   whose hash changed under CRLF-normalisation and files whose hash did not).
   The other seven were not opened. Their hashes were produced by the same
   script in the same run.
5. **`/v/*` was never loaded under the policy.** The ten archived builds carry
   the live anon key, so they were removed from the scratch copy before anything
   was served — deliberately, to avoid a local server handing out a bundle that
   talks to the production database. They will receive the same CSP as the app.
   They *should* be compatible (same build shape: one module script, one
   stylesheet, no inline script — verified statically across all ten
   `index.html` files), but an older bundle could load something the current one
   does not. **If any `/v/*` build breaks under the enforcing policy, this is
   why.**
6. **No violation collector is configured.** The Report-Only policy has no
   `report-uri`/`report-to`, so violations surface only in the console of
   whoever happens to look. Deciding "zero violations" therefore means *someone
   drove the deployed app with the console open*, not *a dashboard said zero*.
   If that bar is too low, add an endpoint before swapping to enforcing.
7. **`upgrade-insecure-requests` was not exercised**, because everything local
   was served over plain HTTP.
8. **Cloudflare may add its own headers.** The docs state Cloudflare "reserves
   the right to attach new headers to static asset responses at any time".
   Interactions with zone-level settings (an "Always Use HTTPS" rule, a Transform
   Rule, a dashboard HSTS setting) were not inspected — no dashboard access.
   A zone-level HSTS setting, if one exists, could conflict with the one here.
9. **Only Chrome was used.** Safari and Firefox differ on `Permissions-Policy`
   feature names and on CORP/COOP edge cases. Nothing observed suggests a
   problem; nothing was checked.
10. **The `Permissions-Policy` denials were not individually tested.** They are
    denials of features the code does not call. The failure mode of a mistake is
    a feature silently not working in a future change, not a break today.

---

## Verification after deploy

Run this and compare against the expected output. Do not mark this audit
complete on the strength of the file existing.

```bash
curl -sI https://pt.anteneh.tech/ | grep -i -E \
  'content-security|strict-transport|x-content-type|referrer-policy|permissions-policy|cross-origin'
```

Expected, phase 1:

```
content-security-policy: base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-security-policy-report-only: default-src 'none'; script-src 'self' 'sha256-…
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: accelerometer=(), ambient-light-sensor=(), …
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
```

And the `/v/*` rule:

```bash
curl -sI https://pt.anteneh.tech/v/2.6.0/index.html | grep -i x-robots-tag
# x-robots-tag: noindex
```

If `content-security-policy` is absent while the others are present, the CSP line
exceeded the 2,000-character limit and was dropped — count the characters.
If **nothing** appears, `_headers` did not reach `dist/`; confirm the build
copied `public/_headers` and that `wrangler` uploaded it.

Then, before promoting Report-Only to enforcing:

1. Open the deployed site with the console visible.
2. Sign in with a real account, create a project, drag a task, trigger a toast,
   let the shader hero run, open the appearance dialog.
3. Load `/v/2.6.0/` and two or three `/explorations/*` pages.
4. Confirm zero `[Report Only]` CSP messages.
5. Swap the header names, redeploy, re-run the `curl`, then scan at
   <https://developer.mozilla.org/en-US/observatory> and record the grade here.

---

## Out of scope — reported, not fixed

These were found while measuring and are **not** touched by this audit.

1. **`scanDist()` does not scan `/v/*`, so the demo build's safety guarantee is
   narrower than it claims.** `scripts/lib/credential-scan.mjs` reads only
   `<dir>/assets/*.js`. Vite copies `public/` — including `public/v/` — into the
   output, so `dist-demo/v/*/assets/*.js` contains the live Supabase project ref
   and anon key, and `build-demo.mjs` still prints *"dist-demo/ verified free of
   live credentials — safe to preview."* `npm run preview:demo` therefore serves
   a live-credentialed bundle at `/v/*`. The anon key is publishable and
   RLS-protected, so this is not a secret leak — but the scanner's claim is
   false, and the same blind spot would hide a real leak placed under
   `public/`. Fix: recurse, or scan every `.js` under the output directory.
   (`scripts/` is owned by another agent.)

2. **`/v/*` runs old code against the current database.** Ten complete older
   builds of the app are served from the live origin with the current anon key.
   A bug fixed in the app remains reachable at `/v/<old>/`, against live data,
   from a shared origin that also holds the session token. `X-Robots-Tag:
   noindex` addresses only the search-result half; unindexed is not unreachable.
   This is a deployment-shape decision (serve archives from a separate origin,
   behind Access, or as inert source rather than runnable builds) and is
   deliberately left to the maintainer.

3. **`public/explorations/` shares an origin with the app.** The prototypes build
   their DOM with `innerHTML` over data they persist themselves. No URL-derived
   input reaches a sink (no `location.search`/`hash`/`URLSearchParams` anywhere in
   the directory), so there is no reflected vector, but a stored one would run on
   the same origin as the live session token. Hashing the inline scripts is the
   mitigation available from a headers file; moving them off-origin is the real
   fix. `X-Robots-Tag` for `/explorations/*` was **not** applied — whether a
   design showcase should be indexed is a product decision, not a security one.

4. **No `.gitattributes` with `core.autocrlf=true`.** Working-tree line endings
   depend on the platform that checked out, which means `dist/` bytes depend on
   the machine that built. It does not affect the CSP hashes (they are computed
   over normalised text precisely so it cannot), but it does mean two builds of
   the same commit can differ byte-for-byte.

5. **No `Cache-Control` policy for `/assets/*`.** Cloudflare's default for static
   assets is `public, max-age=0, must-revalidate`, which is safe but leaves the
   fingerprinted, immutable bundles revalidating on every load. `_headers` is
   where that would be fixed; it is a performance question and was left alone so
   this audit's diff stays one concern wide.
