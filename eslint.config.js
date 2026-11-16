// ESLint flat config.
//
// `npm run lint` used to be `node --check index.js`, which only proves the file
// parses. That let a dead `projectPath` parameter, unreachable catch blocks and
// an unused variable survive review (AUDIT HYG-02/04). This adds real analysis.
//
// Globals are declared explicitly rather than pulling in the `globals` package,
// so the config has no dependency ESLint does not already ship.

import js from '@eslint/js';
import pluginN from 'eslint-plugin-n';

// Node-specific checks (deprecated APIs, missing imports, `node:` protocol).
// The rule set is taken from the plugin's own recommended config so a plugin
// upgrade cannot silently shrink it; the two exclusions below are argued in
// place, and both are about *what this repo is*, not about quietening output.
const N_RULES = pluginN.configs['flat/recommended-module'].rules;

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
    plugins: { n: pluginN },
    rules: {
      ...N_RULES,
      // The exit status *is* the interface of a CLI entrypoint (index.js is the
      // stdio server, scripts/ are run by npm). Throwing instead would print a
      // stack trace where a one-line diagnosis belongs, and would turn the
      // documented exit codes into 1.
      'n/no-process-exit': 'off',
      // n/hashbang models *published package bins*: it wants every shebang'd file
      // to appear in package.json "bin". These are repo-internal executables that
      // are deliberately not published, so the rule has nothing to say here.
      'n/hashbang': 'off',
      // Require the `node:` prefix (S-19 class: the unprefixed name is the one
      // that resolves to a userland package of the same name on old resolvers).
      'n/prefer-node-protocol': 'error',
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
          selector: "ImportDeclaration[source.value=/^(node:)?child_process$/] > :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
          message: 'Import named bindings (spawn, spawnSync) from node:child_process so exec/execSync cannot be called via namespace.',
        },
        {
          selector: "CallExpression[callee.property.name='execSync']",
          message: 'execSync() invokes a shell. Use spawnSync() with an argument array.',
        },
        {
          selector: "CallExpression[callee.name=/^(spawn|spawnSync|execFile|execFileSync)$/] Property[key.name='shell']:not([value.value=false])",
          message: 'Never enable { shell: true } on process spawn calls; pass an explicit argv array without a shell.',
        },
        {
          selector: "CallExpression[callee.name=/^(spawn|spawnSync|execFile|execFileSync)$/][arguments.0.value=/^(sh|bash|zsh|dash|cmd(\\.exe)?|powershell(\\.exe)?|pwsh(\\.exe)?)$/i]",
          message: 'Do not spawn a shell binary directly; spawn the target executable with an argument array.',
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
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
];
