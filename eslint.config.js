/* ============================================================================
   LINT CONFIG.

   Until 2026-08-27 this repository had no linter and no CI, and the build ran
   `tsc -b --noCheck`, which parses the types and then throws the result away.
   Nothing mechanical read this code before it shipped. Everything here exists
   to close that gap on one developer's machine, because there is no server to
   close it on.

   Two rules decide the shape of this file:

   1. NOTHING IN HERE MAY REWRITE THE SOURCE. The comments and formatting in
      src/ are authored, not generated. So: no stylistic rules, no formatter,
      and the rules that stayed on are the ones that find defects rather than
      opinions. `--fix` is not wired into the hook for the same reason.

   2. THE PRE-COMMIT HOOK MUST STAY UNDER A FEW SECONDS. A gate that costs ten
      seconds gets `--no-verify`'d inside a week and then reports green for the
      rest of the project's life. That is the single constraint that rules out
      type-aware linting here — see the note on `recommendedTypeChecked` below.
   ========================================================================== */
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default tseslint.config(
  { ignores: ['dist/', 'dist-demo/', 'dist-verify/', 'public/v/', '.archive/', '.wrangler/', 'supabase/'] },

  /* ---- the browser app -------------------------------------------------- */
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      /* `recommended`, not `recommendedTypeChecked`. The type-aware presets are
         better rules, but they build the whole TS program on every run: ~9s
         here against ~2s untyped, on top of the ~6s `tsc` the hook already
         spends. `npm run typecheck` covers the type errors those rules would
         restate; what is genuinely lost is the nullish/promise-floating family
         (no-floating-promises, no-unnecessary-condition). Logged as a ratchet
         target in docs/audits/2026-08-27-typecheck-lint.md, not as a silent
         omission. */
      ...tseslint.configs.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      /* The classic two hook rules only. eslint-plugin-react-hooks v7's
         `recommended-latest` also turns on the React Compiler rule set
         (purity, immutability, manual-memoization…), which is a different
         audit than this one: it reports on code that works, to make a compiler
         that is not enabled here able to optimise it. Adopting it would mean
         either a large baseline of permanently-yellow warnings or edits across
         most of src/. Deferred deliberately. */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      /* Vite's HMR only accepts a module whose exports are all components.
         A non-component export silently downgrades edits to that file into a
         full reload — a papercut that is invisible until you go looking. */
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* `_`-prefixed names are the escape hatch for a parameter that exists to
         position the ones after it, and for a destructure-to-omit. Without
         this the only way to silence those is to delete real code. */
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      /* Downgraded, not off. Every `any` in this codebase is at a boundary the
         types do not reach (WebGL uniforms, Supabase row shapes). They should
         shrink over time; they should not block a commit today. */
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  /* ---- node-side build and tooling scripts ------------------------------ */
  {
    files: ['scripts/**/*.mjs', '.githooks/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      /* `try { unlink(f) } catch {}` is the intended shape in backup.mjs: the
         file being already gone is the same outcome as deleting it. Naming the
         error only to discard it would read as if something were handled. */
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
