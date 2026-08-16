// The project's first linter. Deliberately the non-type-checked presets: `tsc
// --noEmit` already runs clean under `npm run check` and covers what type-aware
// rules would, at a fraction of the time — running the type graph twice buys
// nothing here.
//
// No formatting rules. Nothing in this file may reflow a file it is pointed at.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'

export default tseslint.config(
  {
    // Generated, vendored, or not source. `.astro/` holds generated types,
    // `src/data/match/` and the two cache directories hold computed artefacts,
    // and `photos/`, `inspiration/` and `public/img/` are imagery.
    ignores: [
      'node_modules/',
      'dist/',
      '.astro/',
      '.netlify/',
      '.match-cache/',
      '.scout-cache/',
      'src/data/match/',
      'public/img/',
      'photos/',
      'inspiration/',
      'certs/',
      // Vendored tooling, not this project's source: 144 of the 198 errors the
      // first run reported were in these, and none of them are ours to fix.
      '.claude/',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,

  // Browser code: the pages, the view layer, the service worker.
  {
    files: ['src/**/*.{ts,astro}', 'public/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },

  // Everything that runs under Node: build scripts, Netlify functions, the
  // test and profiling harnesses.
  {
    files: ['scripts/**/*.ts', 'netlify/**/*.{ts,js}', 'tests/**/*.{ts,mts}', '*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Unit tests reach for Node's built-in runner, which brings its own globals.
  {
    files: ['**/*.test.ts', 'tests/**/*.{ts,mts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    rules: {
      // An unused argument is often the shape of a callback rather than a
      // mistake, and a leading underscore is how this codebase already says
      // "deliberately unused". `ignoreRestSiblings` matters more than it looks:
      // `const { embedding, colourGrid, ...rest } = raw` in manifest.ts is an
      // omit, and "deleting the unused names" there would put the two heaviest
      // fields in the manifest back into `rest`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],

      // Every empty block in this codebase is a `catch {}` around something
      // allowed to fail — `sessionStorage` in private mode, `scrollRestoration`
      // where it is unimplemented. Swallowing there is the intent, not an
      // oversight.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // `cond ? a() : b()` as a statement is used deliberately in the pages.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],

      // The two below are real signal, but neither is a defect and turning them
      // into errors would mean editing code this issue is not allowed to touch.
      // They stay visible as warnings so the count can be worked down later.
      //
      // 31 `any`s, most of them in inspiration.astro's upload flow. Typing them
      // is a job with its own judgement calls, not a lint fix.
      '@typescript-eslint/no-explicit-any': 'warn',
      // New in ESLint 10. All three sites are an initialiser overwritten before
      // it is read; dropping the initialiser risks a definite-assignment error
      // for no gain at runtime.
      'no-useless-assignment': 'warn',
    },
  },
)
