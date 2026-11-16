// ESLint flat config.
//
// `npm run lint` used to be `node --check index.js`, which only proves the file
// parses. That let a dead `projectPath` parameter, unreachable catch blocks and
// an unused variable survive review (AUDIT HYG-02/04). This adds real analysis.
//
// Globals are declared explicitly rather than pulling in the `globals` package,
// so the config has no dependency ESLint does not already ship.

import js from '@eslint/js';

const NODE_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  requestAnimationFrame: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URLSearchParams: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      // Not a source directory: the stub JUCE header is a test fixture.
      'tests/fixtures/**',
    ],
  },

  js.configs.recommended,

  // Server, scripts and tests — Node, ESM.
  {
    files: ['*.js', 'scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    rules: {
      // A catch block that deliberately swallows an error is common when probing
      // the filesystem, but it must be written as `catch {}` or comment why.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      // The project's whole security model is "never build a shell string", so
      // the shell-invoking APIs are banned outright. spawn/spawnSync are fine —
      // they take an argv array and involve no interpreter.
      //
      // These rules used to be name-based (an object literally called
      // `child_process`, a named import called `exec`), which left three ways
      // through: a default import (`import cp from 'node:child_process'`), a
      // namespace import, and — worst — `{ shell: true }` on the *sanctioned*
      // API, which re-enables a shell for an argv array. All three are closed
      // below; `shell` is banned as a property name outright, because there is
      // no legitimate use for it in this codebase.
      'no-restricted-properties': ['error',
        {
          object: 'child_process', property: 'exec',
          message: 'exec() invokes a shell. Use spawnSync() with an argument array.',
        },
        {
          object: 'child_process', property: 'execSync',
          message: 'execSync() invokes a shell. Use spawnSync() with an argument array.',
        },
      ],
      'no-restricted-syntax': ['error',
        {
          selector: "ImportSpecifier[imported.name=/^exec(Sync)?$/]",
          message: 'Do not import exec/execSync — they invoke a shell, which is the '
                 + 'injection vector SECURITY.md exists to close. Use spawnSync.',
        },
        {
          // Default/namespace imports make the callee name unpredictable, which
          // is what defeated `no-restricted-properties`. Only named imports are
          // allowed from child_process.
          selector: "ImportDeclaration[source.value=/^(node:)?child_process$/] > ImportDefaultSpecifier",
          message: 'Import { spawnSync } by name from child_process — a default import '
                 + 'hides exec/execSync behind an alias the other rules cannot see.',
        },
        {
          selector: "ImportDeclaration[source.value=/^(node:)?child_process$/] > ImportNamespaceSpecifier",
          message: 'Import { spawnSync } by name from child_process — a namespace import '
                 + 'hides exec/execSync behind an alias the other rules cannot see.',
        },
        {
          // The one option that turns an argv array back into a shell string.
          selector: "Property[key.name='shell']",
          message: 'Never pass `shell` to a child_process call: it re-enables a shell and '
                 + 'voids the argument-array guarantee. Pass discrete argv entries instead.',
        },
        {
          // The other way to get a shell: name it as the executable.
          // Only bare names are matched: esquery cannot carry an escaped "/"
          // inside a regex (it terminates the literal), so "/bin/sh" would need a
          // second rule for a case that does not exist here. This is a tripwire,
          // not a sandbox — the argv guarantee does the actual work.
          selector: "CallExpression[callee.name=/^(spawn|spawnSync|captureSync)$/] > Literal:first-child"
                 + "[value=/^(sh|bash|zsh|dash|ksh|fish|cmd|cmd\\.exe|powershell|pwsh)(\\.exe)?$/]",
          message: 'Spawning a shell by name is a shell invocation. Run the program directly '
                 + 'with an argument array.',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },

  // Scaffolded browser UI — different globals, and it is shipped verbatim to the
  // plugin's WebView rather than run by Node.
  {
    files: ['templates/**/UI/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
  },
];
