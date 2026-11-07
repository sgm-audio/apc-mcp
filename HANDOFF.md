# HANDOFF — apc-mcp maintenance guide

**Updated:** 2026-11-07

**Current version:** 2.0.0 (unreleased)

**Latest published GitHub release:** v1.5.0

This is the current operating manual. [`AUDIT.md`](AUDIT.md) retains the original
2026-10-06 audit as a historical report and has a dated follow-up section for the
latest findings. [`TODO.md`](TODO.md) tracks the remaining ARA template.

## 1. Current state

The server exposes seven MCP tools from `index.js`: create, configure, build,
test, lint, validate and list plugins. It supports these scaffold families:

- CLAP (`templates/clap/`), using free-audio/clap headers
- JUCE and VST3 (`templates/juce/`), with generic or WebView UI
- JUCE WebView (`templates/juce-webview/`)
- Standalone JUCE applications (`templates/standalone/`)
- Native LV2 plugins in C (`templates/lv2/`)

ARA is intentionally not offered. The old implementation emitted an invalid JUCE
format and could not configure; restoring it requires a real ARA extension and
SDK integration.

GitHub Actions is operational. The CLAP, LV2 and JUCE configure jobs and native
compile job have passed on real runners. Every native scaffold job is included
in `publish.needs`; keep it that way.

`@sgm-audio/apc-mcp` is not yet on npm and there is no `v2.0.0` tag. Do not tell
users to install that scoped package until a release has actually published.

## 2. Local verification

Use Node 22 or 24, matching `package.json` and CI:

```sh
npm ci
npm run check
```

The check runs ESLint and syntax validation, the full `node:test` suite,
structural scaffold smoke tests, `npm audit` and the dependency license gate.
Test totals are deliberately not duplicated here; use the totals printed by the
current run.

Useful focused commands:

```sh
npm test
npm run lint
npm run smoke
node --test tests/security.test.js
node --test tests/templates.test.js
node --test tests/tool-output.test.js
node --test tests/release.test.js
```

### Native headers and configure checks

The JUCE compile tests use the checked-in API stub. CLAP and LV2 compile checks
skip unless their real upstream headers are supplied:

```sh
git clone --depth 1 https://github.com/free-audio/clap.git /tmp/apc-clap
git clone --depth 1 https://github.com/lv2/lv2.git /tmp/apc-lv2

APC_CLAP_INCLUDE=/tmp/apc-clap/include \
APC_LV2_INCLUDE=/tmp/apc-lv2/include \
  node --test tests/cpp-api.test.js
```

To run real CMake configure checks for CLAP and LV2:

```sh
APC_CLAP_DIR=/tmp/apc-clap \
APC_LV2_DIR=/tmp/apc-lv2/include \
  node scripts/smoke-scaffold.mjs --configure
```

JUCE configure checks additionally need a JUCE 9.0.3 checkout and its native
build dependencies:

```sh
git clone --depth 1 --branch 9.0.3 \
  https://github.com/juce-framework/JUCE.git /tmp/apc-juce
APC_JUCE_DIR=/tmp/apc-juce node scripts/smoke-scaffold.mjs --configure
```

The environment can be combined in one invocation. Never accept a skipped native
check as proof that it passed.

## 3. Test map

- `tests/server.test.js` — MCP handshake, tool registration and happy paths
- `tests/security.test.js` — malicious arguments, traversal, symlink boundaries,
  malformed project configuration and missing tools
- `tests/tool-output.test.js` — config precedence, process streams, diagnostics,
  ctest summaries and honest failure reporting
- `tests/templates.test.js` — every scaffold family, metadata escaping, CMake
  references and native metadata invariants
- `tests/cpp-api.test.js` — real C/C++ front-end checks of generated sources
- `tests/artefacts.test.js` — JUCE/CLAP/LV2 artefact discovery
- `tests/release.test.js` — version source, workflow pins, Node support and
  release guards
- `tests/helpers/mcp-client.mjs` — shared full-handshake stdio client

All fixtures belong in `os.tmpdir()`. Do not recreate the retired
`tests/fixtures/test-project/` output directory.

When fixing a bug, add a focused regression test first and verify that it fails
against the old code. Structural template tests are necessary but not sufficient:
retain the real compiler and CMake configure jobs.

## 4. Runtime invariants

### No shell execution

Use `spawnSync()` through the existing wrappers with an argv array. Do not import
or call `exec`/`execSync`; ESLint rejects them. User-controlled strings must not
be assembled into shell commands.

### Filesystem boundary

`assertWithinProject()` performs both lexical and `realpath` checks. Use it for
every project-relative read/write root, including new tools. Checking only `..`
or a string prefix is insufficient because symlinks can redirect an in-project
path outside the project.

The final create destination may not exist yet; the guard intentionally resolves
the nearest existing ancestor. Keep that behavior when changing the helper.

### Honest results

A failed or incomplete operation returns `isError: true`. Preserve stderr on
successful commands because compilers put warnings there. Include actionable
output when a command fails, and do not report skipped validation as success.

### Generated source escaping

Metadata is inserted into different languages. Use the dedicated C++, CMake and
Turtle escaped template values rather than reusing a raw description. Add a test
for every new output context; printable ASCII includes quotes, backslashes and
CMake expansion syntax.

### Build configurations

Multi-config generators require `cmake --build ... --config <config>`.
Single-config generators require regeneration when `CMAKE_BUILD_TYPE` changes.
`buildNeedsConfigure()` handles that distinction; do not reduce it to a cache-file
existence check.

## 5. CI and release

Workflows are in `.github/workflows/`:

- `publish.yml` — Node 22/24 tests, lint, audit, licenses, native compilation and
  CLAP/LV2/JUCE configure checks; publishes only on `v*` tags
- `codeql.yml` — JavaScript analysis on push, PR and a weekly schedule

All actions must remain pinned to immutable 40-character SHAs, and the same
action must use the same SHA in every job. `tests/release.test.js` enforces both.

Release from a clean `main` checkout:

1. Bump `version` in `package.json` (the only version source).
2. Complete the matching `CHANGELOG.md` section.
3. Run `node scripts/ship.mjs --dry-run` and then `npm run ship`.
4. Watch the tag workflow and verify the npm package only after publication.

The ship script checks the branch, tree, upstream, existing tag and changelog.
Do not bypass its quality gate as a routine release step.

## 6. Known limitations / remaining work

- **ARA:** the only remaining template expansion in `TODO.md`; requires the ARA
  SDK and corresponding CI coverage.
- **macOS CLAP packaging:** the native CLAP template emits the correct single
  `.clap` binary on Linux/Windows. Its macOS bundle layout still needs a dedicated
  packaging step, as noted in `templates/clap/CMakeLists.txt`.
- **Validators:** VST3 uses pluginval and CLAP uses clap-validator. Other artefact
  formats can be discovered but have no configured validator and therefore report
  an incomplete (`isError`) validation rather than a clean pass.
- **External tools:** CMake, ctest and clang-format are not installed by this
  package. Tests use instrumented shims where appropriate; native CI validates
  the real configure paths.

## 7. Documentation hygiene

Keep README examples and the tool table synchronized with `index.js`. Avoid
copying volatile test counts, line numbers, CI status or release status into
multiple files. `AUDIT.md` is dated evidence; this file is the current guide;
`CHANGELOG.md` records user-facing changes; `TODO.md` is feature scope.
