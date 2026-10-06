# Changelog

## [Unreleased]

> **Release note:** removing `ara` from the `audio_plugin_create` `type` enum is a
> **breaking input-schema change**. Per this project's semver policy this must ship
> as **2.0.0**, not 1.5.1.

### Security

- **Path traversal in `audio_plugin_lint` closed (critical).** `target` was validated
  only against `SAFE_PATH`, which permits `.`, so `../x` passed and was joined onto the
  project root before being handed to `clang-format -i`. A single tool argument could
  rewrite any `.cpp/.cc/.cxx/.h/.hpp` file the user could write. `target` now rejects
  `..` segments and is re-checked against the project boundary via a new
  `assertWithinProject()` guard, which also catches absolute paths outside the project.
- **`checkPluginPath()` now delegates to `assertWithinProject()`** so the create and
  lint write paths share one boundary implementation and cannot drift apart.
- **`apc-mcp.json` is validated per key** (`CONFIG_SCHEMA`) instead of being spread
  over the defaults unchecked. A non-array `validateFormats` no longer crashes on
  `.join()`; `buildDir`/`pluginsDir` must be relative and free of `..`; `generator`
  and the validator command names are pattern-checked. Unknown keys are still tolerated
  for forward compatibility, and one bad value degrades to its default rather than
  discarding the file.
- **Shell removed from binary discovery.** `findBinary()` previously ran `sh -c 'which …'`,
  contradicting the file's stated no-shell invariant. It now scans `PATH` directly
  (with `PATHEXT` handling on Windows) — no subprocess at all.
- **Dependency vulnerabilities resolved.** `@modelcontextprotocol/sdk` bumped
  `1.30.0 → 1.32.1` and the lockfile regenerated: `npm audit` went from
  6 vulnerabilities (1 critical, 2 high, 3 moderate) to **0**. `npm run check` and
  `npm run security` were both failing (exit 1), which blocked `npm run ship`.
  All six were transitive via the SDK's HTTP transport, which this stdio-only
  server never loads.

### Fixed

- **Prerequisite detection actually works now.** `findBinary()` wrapped `spawnSync` in
  `try/catch` and returned `true` unconditionally — `spawnSync` does not throw on a
  missing binary, it returns `{ error, status }`. Every tool was reported as installed,
  silently disabling the 1.3.0 prerequisite feature.
- **Missing tools and timeouts produce actionable messages.** `trySpawn()`'s `ENOENT`
  branch was unreachable and `result.error`/`result.signal` were never inspected, so a
  missing `cmake` reported `"Configure failed:\nexit code null"`. It now reports
  `'cmake' not found on PATH (needed for build/configure). Install: …`, and a timeout
  reports the elapsed limit instead of `exit code null`.
- **Non-existent `projectPath` is rejected without side effects.** `audio_plugin_build`
  previously `mkdir -p`'d a directory tree for a bogus path and reported on a project
  that never existed. Project roots must now exist, be a directory, and contain
  `CMakeLists.txt` or `apc-mcp.json`.
- **Tool handler exceptions become readable results.** All seven tools are registered
  through a `registerTool()` wrapper that converts a thrown `Error` into an
  `isError: true` tool result, so actionable messages reach the model instead of an
  opaque JSON-RPC protocol error.

### Added

- **Dependency license gate, ported to GitHub Actions.** `npm run licenses` runs
  `scripts/check-licenses.mjs`, which verifies every package in `package-lock.json`
  against the allowlist in `license_decisions.yml` — so that file remains the single
  source of truth for license policy instead of being orphaned by the GitLab CI removal.
  Zero dependencies: it reads the lockfile directly (no install needed) and handles SPDX
  `OR` / `AND` / `WITH` expressions, non-SPDX strings like `SEE LICENSE IN …`, and
  missing license fields. Production dependencies outside the allowlist fail the build;
  devDependencies warn (they are never distributed) unless `--strict-dev` is passed.
  Individual packages can be accepted via a `reviewed_packages:` list in the decisions
  file. Wired into `npm run check` and into a new `license` CI job that `publish` now
  depends on.

### Removed

- **`type: "ara"` removed from `audio_plugin_create` (breaking).** It mapped to the
  plain JUCE template with `FORMATS ARA` — not a valid `juce_add_plugin` format — and
  derived from `juce::AudioProcessor` rather than `juce::ARAAudioProcessor`, so it
  reported success while scaffolding a plugin that could never configure. Restoring it
  requires a real ARA template (still tracked in `TODO.md`).
- **`.gitlab-ci.yml` deleted.** The repo is hosted on GitHub and all README badges point
  at GitHub Actions; the GitLab pipeline was broken in six places (a `junit.xml` report
  that was never generated, a coverage regex matching `ℹ tests` when `node --test` emits
  `# tests` in non-TTY mode, `npm ci` inside a `docker:27-cli` image with no npm, a
  secret-detection job ending in `|| true`, hand-rolled docker invocations of Ultimate
  scanner images, and no `node --check` or `npm audit` step). The one part worth keeping
  — the license policy in `license_decisions.yml` — was ported to a GitHub Actions job;
  see **Added** above.

### Tests

- **New `tests/security.test.js` — 30 negative tests.** Security controls previously had
  no test asserting they *reject* anything. Covers the lint traversal PoCs (including a
  planted out-of-project victim file and an instrumented `clang-format` that records the
  exact argv it receives), 10 shell-metacharacter rejection cases across 4 tools,
  missing-toolchain messaging, bogus-`projectPath` rejection with a no-side-effect
  assertion, malformed-config handling, and the `ara` removal.
- Tests use `os.tmpdir()` fixtures rather than writing into `tests/fixtures/`.
- The test client performs a full MCP `initialize` handshake and advances on responses
  rather than fixed timers — the suite runs in ~14s instead of ~126s.
- `npm test` is now `node --test` (auto-discovery) so new test files are picked up
  without editing `package.json`.

### Known issues still open

Tracked in `AUDIT.md`. Notably **the default JUCE scaffold still emits unparseable
CMake** (`{{#WEBVIEW}}` tags, FUNC-01), both JUCE templates call the non-existent
`juce_add_webview_ui()` (FUNC-02) and use `${PROJECT_NAME}` without a `project()` call
(FUNC-03); `cfg.config` is still shadowed by the zod default (FUNC-06); `lint(fix=true)`
still reports success on failure (QA-01); and the ctest and build-output parsers still
miscount (QA-02/03/04). These are Phase 2 and Phase 3.

## [1.5.0] — 2026-06-17

### Added
- **WebView UI template**: `audio_plugin_create(name="X", type="juce", ui="webview")` scaffolds a plugin with HTML/CSS/JS UI.
- **`ui` parameter** on `audio_plugin_create`: `generic` (JUCE's GenericAudioProcessorEditor) or `webview` (WebBrowserComponent with embedded UI).
- **JS↔C++ bridge**: `WebViewEditor` uses `pageAboutToLoad` URL interception for JS→C++ and `evaluateJavascript()` for C++→JS.
- **Dark theme UI**: Gain slider, meter visualization, all styled in modern DAW-compatible dark theme.

### Changed
- `mapPluginType()` now accepts `ui` parameter to select between `juce` and `juce-webview` templates.
- TODO.md updated with completion status.

## [1.4.0] — 2026-06-16

### Security (CRITICAL fixes)
- **Eliminated shell injection vector**: replaced all `execSync()` with `spawnSync()` + argument arrays. No user-supplied value ever reaches a shell interpreter. Previously, unquoted user input in `target`, `options`, `testName`, `generator`, and `projectPath` could be exploited via shell metacharacters (`;`, `$()`, backticks) if an attacker controlled tool arguments (e.g. via prompt injection).
- **Input validation**: zod `.regex()` constraints on all user-controlled string parameters (`target`, `options`, `testName`, `generator`, `name`, `vendor`, `projectPath`). Invalid inputs are rejected at the schema level before handlers run.
- **Path traversal protection**: `checkPluginPath()` ensures `audio_plugin_create` writes only within the project boundary. Rejects paths containing `..` that escape the project root.
- **No shell pipeline for lint**: replaced `find | xargs` pipe with Node.js `fs.readdirSync` recursive walk. Eliminates the only remaining shell invocation in the codebase.

### Changed
- All child process execution uses `spawnSync()` with explicit argument arrays — no `/bin/sh` involved
- `maxBuffer` limit on all process output (2MB) prevents memory exhaustion from large build logs
- Test fixtures auto-clean before each run

## [1.3.0] — 2026-06-16

### UX improvements
- **Smart project discovery**: walks up parent directories looking for `apc-mcp.json` or `CMakeLists.txt`. Run from any subdirectory in your project.
- **Prerequisite checking**: when cmake/clang-format/pluginval/clap-validator are missing, the tool tells you exactly how to install them instead of throwing a cryptic error.
- **Better error messages**: `tryRun` distinguishes "command not found" from "command failed" and gives actionable instructions.
- **Safe file finding**: lint uses `find -print0 | xargs -0` to handle filenames with spaces.
- **Richer tool descriptions**: every parameter has a detailed description so the LLM understands what it does without guessing.

### Changed
- Server version bumped to 1.3.0

## [1.2.0] — 2026-06-16

### Added
- **Logo**: SVG banner in README with dark/light mode support
- **.editorconfig**: Standardized editor settings
- **Issue templates**: Bug report + feature request templates in `.github/ISSUE_TEMPLATE/`
- **Dependabot**: Weekly automated dependency updates for npm + GitHub Actions
- **CodeQL**: Security analysis workflow
- **SECURITY.md**: Vulnerability reporting policy
- **CI matrix**: Tests run on Node 18, 20, and 22 in parallel
- **Lint step**: `node --check index.js` in CI to catch syntax errors
- **FAQ / Troubleshooting** section in README
- **Semantic versioning** policy documented

### Changed
- README restructured with banner, badges, nav links, and cleaner tool docs
- CI workflow renamed to "CI" (was "CI / Publish"), publish step uses `continue-on-error`
- package.json: added `lint` script

## [1.1.1] — 2026-06-16

### Changed
- Primary install method now uses `npx github:sgm-audio/apc-mcp` — no npm account needed
- Updated README, AGENTS_REFERENCE, meta-orchestrator to reflect GitHub-based install
- Switched local opencode config to `npx github:` method

## [1.1.0] — 2026-06-16

### Added
- `audio_plugin_create` — Scaffold new CLAP or JUCE plugins from templates
- `audio_plugin_validate` — Run pluginval (VST3) and clap-validator on built binaries
- Config system: `apc-mcp.json` per-project defaults for generator, buildDir, validateFormats, etc.
- CWD auto-detection: `projectPath` optional when `apc-mcp.json` present
- Structured output: parsed error/warning counts, test pass/fail summary, `format=json` for plugins
- Test suite: 11 tests using Node `node:test` — zero dependencies
- CHANGELOG.md, CONTRIBUTING.md
- Updated CI workflow with proper test step

## [1.0.0] — 2026-06-16

### Added
- Initial release
- `audio_plugin_build` — CMake configure + build
- `audio_plugin_configure` — CMake configure with custom generator/flags
- `audio_plugin_test` — ctest runner
- `audio_plugin_lint` — clang-format check/auto-fix
- `audio_plugin_plugins` — List project plugins with metadata
- MIT licensed**
