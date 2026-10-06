# Changelog

## [Unreleased] — 2.0.0

> **Release note — two breaking changes**, so this ships as **2.0.0**, not 1.5.1:
>
> 1. `ara` was removed from the `audio_plugin_create` `type` enum. It scaffolded
>    `FORMATS ARA`, which `juce_add_plugin` rejects, from a plain
>    `juce::AudioProcessor` — a plugin that could never configure.
> 2. `engines.node` is now `>=22`. Node 18 ended 2025-04-30 and Node 20 ended
>    2026-04-30, so neither receives security patches. Installations still on
>    Node 20 must upgrade.
>
> The version now lives **only** in `package.json`; `index.js` reads it at startup
> (OPS-03), so the two cannot drift. Several tools also now return `isError` in
> cases where they previously reported success — see *Tool output & failure
> reporting* below.

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

#### Scaffold templates (the `audio_plugin_create` output)

The templates were the largest cluster of defects found in the audit, and the whole
class went unnoticed because the test suite only asserted that the tool's reply
*mentioned* a filename — never that the generated project was valid. A scaffolded
plugin could not configure or compile. Every shape below was verified against
JUCE 9.0.3 and free-audio/clap sources.

- **Unparseable CMake on the default path (critical).** `templates/juce/CMakeLists.txt`
  emitted a literal `{{#WEBVIEW}}…{{/WEBVIEW}}` block. `replaceTemplateVars()` does
  simple `{{KEY}}` substitution and has no notion of Mustache sections, so with the
  default `ui: "generic"` those tags reached the file verbatim and CMake could not
  parse it. The block is gone; the two templates now differ only where they need to.
- **`juce_add_webview_ui()` does not exist.** Zero matches anywhere in JUCE. Replaced
  with the real `juce_add_binary_data(<id>_WebData NAMESPACE <id>_UI SOURCES …)`.
- **`BINARY_DATA_ID` is not a `juce_add_binary_data` keyword** (it takes only
  `NAMESPACE`, `HEADER_NAME`, `SOURCES`). `juce_add_plugin` has no unparsed-argument
  check, so unknown keywords are silently dropped rather than reported — this one hid
  for two releases. It is now `NAMESPACE`, and it matches the BinaryData namespace
  forward-declared in `WebViewEditor.cpp`.
- **`COPYRIGHT` is not a `juce_add_plugin` keyword** — silently ignored. Now
  `COMPANY_COPYRIGHT`.
- **Neither JUCE template called `target_link_libraries` at all**, so every `juce::`
  symbol in the generated sources would have been undefined at link time. Both now link
  `juce::juce_audio_utils` PRIVATE plus the three `juce_recommended_*_flags` PUBLIC,
  matching JUCE's own AudioPlugin example; the WebView template additionally links
  `juce::juce_gui_extra` and its binary-data target.
- **`${PROJECT_NAME}` used as the plugin target name without a `project()` call.**
  These files are subdirectories of the user's project, so `PROJECT_NAME` belongs to
  the *host* project and every scaffolded plugin collided on one target name. Targets
  are now the literal plugin name.
- **Unguarded `add_subdirectory(JUCE)` per plugin.** A second plugin in the same
  project defined every `juce::*` target twice. Now guarded by
  `if(NOT TARGET juce::juce_audio_utils)`, autodetecting a vendored `_tools/JUCE`,
  and failing with an actionable `FATAL_ERROR` when neither is present. The CLAP
  template has the same guard around `_tools/clap`.
- **Non-reproducible plugin IDs.** `juce_add_plugin` defaults `PLUGIN_CODE` to a
  *random* four-character code, so re-scaffolding the same plugin produced a different
  binary identity. `index.js` now derives a stable `PLUGIN_MANUFACTURER_CODE` and
  `PLUGIN_CODE` from the vendor and plugin name via `fourCharCode()`.
- **`FORMATS` values were never validated.** Any string reached the template, so an
  invalid format surfaced only as a confusing CMake error. The accepted set is now
  checked at the tool boundary and the error lists the valid formats.
- **The CLAP template targeted a pre-1.0 CLAP API.** `find_package(CLAP CONFIG
  REQUIRED)` cannot resolve `clap-config.cmake` on a case-sensitive filesystem, and
  `CLAP::clap` does not exist — free-audio/clap exports a plain INTERFACE target named
  `clap`. Separately, `PluginEntry.cpp` put `get_plugin_count` / `get_plugin_descriptor`
  / `create_plugin` directly on `clap_plugin_entry`, a layout removed before CLAP 1.0,
  and exported the entry as `entry` rather than the `clap_entry` symbol hosts resolve.
  `PluginProcessor.cpp` used `clap_process::frames`, now `frames_count`, and called
  `strcmp` without including `<cstring>`. The template now implements the modern
  `clap_entry -> get_factory(CLAP_PLUGIN_FACTORY_ID) -> clap_plugin_factory_t ->
  create_plugin()` chain and the full `clap_plugin_t` vtable, and compiles clean with
  `-Wall -Wextra` against the real CLAP headers.
- **Scaffolded CLAP plugins could never be validated.** The template emitted
  `<build>/<name>.clap` while `audio_plugin_validate` scans
  `<build>/plugins/<name>/<name>_artefacts/<config>/CLAP/*.clap`. Output directories
  now match what the validator looks for.
- **The WebView C++ called five things that do not exist in JUCE 9.**
  `WebBrowserComponent::loadHTMLString()` (no such method — JUCE serves UI through a
  `ResourceProvider`), `m_webView.onPageAboutToLoad = …` (no such member;
  `pageAboutToLoad()` is *virtual*, so it needs a subclass), a `URLParser` helper used
  before its declaration, `new juce::DynamicObject{{"type", …}}` (`DynamicObject` has
  no such aggregate initialiser, and the nesting leaked), and
  `XmlDocument::storeXmlAsString()` (zero matches in all of JUCE 9 — state now uses
  `AudioProcessor::copyXmlToBinary()` / `getXmlFromBinary()`). `WebViewEditor` was
  rewritten around `Options{}.withBackend(…).withResourceProvider(…)` +
  `goToURL(getResourceProviderRoot())`, following JUCE's own WebViewPluginDemo, and it
  now matches the `window.updateState(array)` / `apc://callback?action=…` contract the
  generated `app.js` already expected.


#### Tool output & failure reporting

Every defect here made the server *report success or wrong numbers* while the
underlying tool had failed or disagreed — worse than crashing, because the model
acts on the report. 22 new tests; 13 of them fail against the pre-fix code.

- **`config` in `apc-mcp.json` was dead.** All four tools declared
  `config: z.enum([...]).default('Debug')`, so zod filled the value in whenever the
  caller omitted it and `params.config || cfg.config` never reached the project
  file. A project configured for Release silently built Debug. The field is now
  `.optional()`, resolved as `params.config ?? cfg.config ?? 'Debug'`, and the
  precedence is documented in each parameter description.
- **`lint(fix=true)` reported success when clang-format failed.** The exit status
  was never inspected, so a crashing formatter returned "No formatting issues" —
  *after* being handed `-i` and rewriting files in place. It now reports
  `isError: true`, the file count, and warns that files may be partially reformatted.
- **The ctest parser counted its own summary prose.** `parseTestOutput` counted
  occurrences of the words "passed" and "failed" anywhere in the stream, so ctest's
  `100% tests passed, 0 tests failed out of 3` added a phantom pass *and* a phantom
  fail: a clean 3/0/3 run was reported as **4/1/5**. Its total, `/^tests? (\d+)/im`,
  never matched ctest at all. It now reads the summary line, falls back to ctest's
  per-test result lines, and — rather than inventing numbers for an unrecognized
  harness — reports `unknown` and includes the raw output tail.
- **MSVC diagnostics were invisible.** `parseBuildOutput` matched only `: error:`
  and `: error\d*\s*\(`, so `Bar.cpp(17): error C2065:` counted as nothing and a
  failing Windows build could report `Errors: 0`. The warning test
  `/^.*warning:/` was literally equivalent to `includes('warning:')`, counting any
  line with that substring — including source lines compilers echo *underneath* a
  diagnostic. Classification now uses four anchored shapes (clang/gcc, MSVC,
  `CMake Error|Warning`, tool-prefixed `ld: error:`) and treats `note`/`remark` as
  context rather than diagnostics.
- **Compiler output on stderr was never parsed.** `trySpawn` returns stdout as
  `output` and stderr separately, but the build handler parsed only `r.output` —
  and compilers write diagnostics to stderr, so the `### Errors` section was empty
  precisely on the builds that failed. It now parses both streams.
- **A build that emitted errors reported success.** `errorCount` was computed and
  printed, then ignored by `isError: !r.ok`. Now `isError` also reflects it.
- **A missing optional validator aborted the whole report.**
  `audio_plugin_validate` discarded `checkOptionalTool()`'s return value and then
  called `requireTool()` from *inside* the per-binary results loop, so one absent
  validator threw away every result already computed and surfaced as an opaque tool
  error. Availability is now checked once up front; a missing validator yields a
  `SKIPPED` entry with an install hint, and `isError` is true whenever validation is
  incomplete — an unfinished validation must never read as a clean one.
- **`validateCommand` / `clapValidatorCommand` are honoured.** Both were accepted
  and regex-validated in `apc-mcp.json` and then ignored in favour of hardcoded
  binary names.


#### Release engineering

- **A failed publish could not fail CI.** `npm publish --provenance` carried
  `continue-on-error: true`, so a rejected or partial publish left the workflow
  green while the tag looked released. Removed — a publish failure is now a red
  run.
- **The version had two sources of truth.** It was hardcoded in `package.json`
  *and* in `index.js`, and `CONTRIBUTING.md`'s release checklist mentioned only
  the former, so drift was guaranteed and `initialize` would have reported a
  stale server version. `index.js` now reads `package.json` at startup (which npm
  always includes in the tarball regardless of the `files` allowlist), falling
  back to `0.0.0-unknown` only if run detached from it.
- **Both Node 18 and Node 20 are end of life.** Node 18 ended 2025-04-30 and
  Node 20 ended **2026-04-30** — so the audit's original "drop 18" recommendation
  was already out of date by the time it was implemented. `engines.node` is now
  `>=22` (maintenance LTS to 2027-04-30), the CI matrix is `[22, 24]`, and the
  single-version jobs run on 24 (active LTS to 2028-04-30).
- **`npm run ship` pushed `main` from whatever branch you were on.** It ran
  `git tag v$npm_package_version && git push origin main --tags`, so from a
  feature branch it tagged a commit `main` did not contain and then pushed a
  `main` that did not have the tag. Replaced by `scripts/ship.mjs`, which refuses
  — with a specific reason — unless HEAD is `main`, the tree is clean, the tag
  does not already exist, and `CHANGELOG.md` has a `## [<version>]` heading
  rather than `[Unreleased]`. `--dry-run` exercises every guard without changing
  anything.
- **Actions were pinned to mutable major tags.** `@v7` / `@v4` let an upstream
  push change what CI runs. All refs are now 40-character commit SHAs, verified
  with `git ls-remote` at the time of pinning; Dependabot already manages
  `github-actions`, so it will keep them current. Note that `codeql-action@v4` is
  an **annotated** tag: `7999b86c…` is the *tag object* and GitHub Actions
  resolves `uses:` to a commit, so the peeled `2892aa5e…` is the value pinned —
  pinning the tag object would not have resolved.

#### QA tooling & documentation

- **ESLint is now the real linter (HYG-04).** `npm run lint` used to be
  `node --check index.js`, which only proves the file parses. It is now
  `eslint . && node --check index.js`, with a flat config (`eslint.config.js`)
  declaring Node and browser globals explicitly so no extra `globals` dependency is
  needed. Beyond the usual rules it bans importing `exec`/`execSync` — the
  shell-invoking APIs the entire security model exists to avoid. `npm run quality`
  runs `lint` before `test`, so `npm run check` and CI both lint the repo now. The
  first run found **15 real problems**, all fixed:
  - two useless escapes inside the `SAFE_OPTIONS` / `SAFE_PATH` security allowlists.
    These are the regexes that reject shell metacharacters, so rather than assume
    the escape was cosmetic, both were compared to their cleaned forms over
    **65,536 probe strings** (every code point below U+2000, alone and embedded in
    a valid token) — **0 behavioural differences** — before the backslashes were
    removed.
  - an empty `catch` in `audio_plugin_plugins` that silently swallowed a malformed
    `status.json`, so the user saw a plugin with no type and no explanation. It now
    reports `statusError` on that entry and still lists the plugin.
  - the dead `projectPath` parameter on `findPluginBinaries` (HYG-02), an unused
    import, and eight empty catch blocks that now say why they are empty.
- **`index.js` reports an unreadable `status.json` instead of hiding it.**
  `audio_plugin_plugins` adds `statusError` to that plugin's entry. The listing
  still succeeds — a bad metadata file must not break discovery — but it no longer
  fails silently.
- **`SECURITY.md` rewritten (HYG-08).** It was materially false: it called `0.1.0`
  the current version, described 17 tests and 6 findings, claimed layer 3 performed
  `path.resolve()` and `realpathSync` checks that **do not exist in the code**,
  listed superseded dependency versions, and asserted there was *"no residual risk
  of arbitrary file read/write"* — untrue, since the guard allowlists paths
  *within* the project boundary and everything inside it is writable by design. It
  also recorded SEC-01 as fixed in `0.3.0`; the lint path traversal was actually
  closed in this release cycle, so **1.4.0 and 1.5.0 as published are still
  vulnerable**. The replacement states the threat model, eight defence layers each
  citing its source, an honest residual-risk section, and a correct audit history.
- **`CONTRIBUTING.md` corrected (HYG-09).** The nonexistent `tryRun()`/`run()` are
  now `trySpawn()`/`spawn()`; `server.tool()` is now the `registerTool()` wrapper
  (with the reason — it is what turns a thrown error into a readable `isError`
  result rather than an opaque protocol error); the stale advice to bump the
  version in `index.js` is gone; and it now states the red-phase-first requirement,
  the `isError` rule, and which test file covers which kind of change.
- **`README.md` documents what the tool actually accepts (HYG-10).** All three
  `type` values are tabulated — including that `vst3` is a JUCE alias which sets
  `FORMATS VST3` — and `ui="generic"|"webview"` is documented with the bridge
  contract (`window.updateState(...)` for C++→JS, `apc://callback?action=...&data=...`
  for JS→C++). The structure tree lists `templates/juce-webview/` and every test and
  script file. The FAQ no longer quotes a shell-style `command not found: cmake`;
  it quotes the real message the server produces and explains the 2.0.0
  honest-failure change. The Node badge is `node-22+`.
- **`publish.yml`'s `test` job now runs the smoke test and the dependency audit.**
  Neither `npm run smoke` nor `npm audit` ran anywhere in CI before, so a scaffold
  regression or a vulnerable dependency could be published without any job
  noticing.
- **`index.js` is executable (HYG-11).** It has a shebang but was mode 644, so
  `./index.js` failed even though `bin` pointed at it. Mode 755 is now recorded in
  the index, and the installed tarball was confirmed to serve `initialize`.

### Added

- **`.github/pull_request_template.md`.** The GitLab merge-request checklist that
  survived the move to GitHub was deleted (`.gitlab/` — GitHub never reads it), and
  its genuinely useful items were migrated here, updated for `npm run check`, the
  template and CMake-keyword rules, the red-phase-in-a-worktree requirement, and the
  `scripts/ship.mjs` release steps.
- **`eslint.config.js`** and `eslint` + `@eslint/js` as devDependencies (both under
  allowlisted licenses). `BlueOak-1.0.0` was added to `license_decisions.yml` — a
  permissive license in ESLint's dev tree that the gate was warning about.

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
- **`npm run smoke` / `scripts/smoke-scaffold.mjs`.** Scaffolds every
  `type` x `ui` combination through the real MCP server into a throwaway project,
  checks that no placeholders survive and that each plugin gets its own CMake target,
  and writes a host `CMakeLists.txt` so several plugins configure together (the
  multi-plugin collision case). `--configure` additionally runs real `cmake -B build`
  when `APC_JUCE_DIR` / `APC_CLAP_DIR` point at checkouts. Now part of `npm run check`.
- **`scripts/ship.mjs` — a guarded release.** `npm run ship` now runs the checks
  itself (so invoking the script directly cannot bypass them) and refuses to tag
  unless the branch, working tree, tag and CHANGELOG heading are all correct.
  `CONTRIBUTING.md` documents the process and the `--dry-run` preview.
- **CI: three new jobs.** `compile-scaffold` compiles every scaffolded source with a
  real C++ front end (JUCE against the committed API stub, CLAP against real headers);
  `scaffold-clap` and `scaffold-juce` run `cmake -B build` on scaffolded plugins
  against real dependencies. `publish` now also depends on `compile-scaffold` and
  `scaffold-clap`.

### Removed

- **`.gitlab/`** — an orphaned GitLab merge-request template left over from before
  the repository moved to GitHub. GitHub does not read it, so the checklist in it was
  invisible to anyone opening a PR. Its useful content now lives in
  `.github/pull_request_template.md`.

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

- **`tests/server.test.js` rewritten onto the shared MCP client (HYG-06, HYG-07).**
  It carried its own stdio client that duplicated the other two suites **and sent
  `tools/list` and `tools/call` with no `initialize` handshake**, so it never
  exercised the path a real MCP client takes. It now uses
  `tests/helpers/mcp-client.mjs`, which performs the handshake. Every deep property
  access is optional-chained with a descriptive assertion message, so a response
  shape change fails an assertion instead of throwing a `TypeError`. Fixtures moved
  to `os.tmpdir()`, so a test run leaves nothing in the repository.
- **11 → 12 tests in that file, and 118 → 119 overall**, with better coverage than
  before: the scaffold tests now also assert that no `{{...}}` placeholder survives,
  that the requested `FORMATS` is actually emitted, that a rejected `create` writes
  nothing, and that a malformed `status.json` is surfaced rather than swallowed.

- **New `tests/security.test.js` — 30 negative tests.** Security controls previously had
  no test asserting they *reject* anything. Covers the lint traversal PoCs (including a
  planted out-of-project victim file and an instrumented `clang-format` that records the
  exact argv it receives), 10 shell-metacharacter rejection cases across 4 tools,
  missing-toolchain messaging, bogus-`projectPath` rejection with a no-side-effect
  assertion, malformed-config handling, and the `ara` removal.
- **New `tests/templates.test.js` — 30 structural tests over the generated project.**
  Runs with no cmake, JUCE or CLAP present. Asserts no leftover `{{…}}` or Mustache
  tags, per-plugin target names with no collisions, only real `juce_add_plugin`
  keywords and formats, `target_link_libraries` present, guarded
  `add_subdirectory(JUCE)`, deterministic four-char IDs, balanced parentheses, every
  file named by `target_sources` / `juce_add_binary_data SOURCES` actually existing,
  the C++ BinaryData namespace matching CMake's, and the CLAP template's modern
  factory/entry layout plus its artefact path matching what `audio_plugin_validate`
  scans. **Against the pre-fix templates 25 of these 30 fail.**
- **New `tests/cpp-api.test.js` — compiles the scaffolded C++.** Runs
  `g++/clang++ -std=c++20 -fsyntax-only -Wall` over every generated source. JUCE
  sources check against `tests/fixtures/juce-api-stub/JuceHeader.h`, a transcription of
  the JUCE 9 API surface (each signature annotated with the JUCE header it came from);
  CLAP sources check against real free-audio/clap headers when `APC_CLAP_INCLUDE` is
  set. Skips cleanly when no compiler is available, so `npm test` still works on a
  Node-only machine.
- **New `tests/tool-output.test.js` — 22 tests over config precedence, failure
  reporting and both output parsers.** Drives the real handlers through the MCP
  interface using PATH shims that emit canned stdout/stderr and a chosen exit code,
  so no cmake, ctest or clang-format needs to be installed. Covers GCC, clang and
  MSVC diagnostic shapes, a clean ctest run, a failing one, a run with no summary,
  errors arriving on stderr, a build that emits errors but exits 0, and a validator
  that is missing while another succeeds.
- **New `tests/release.test.js` — 19 tests over release engineering.** Static
  checks with no network: `initialize` reports the `package.json` version and
  `index.js` holds no second copy of it; no workflow step uses
  `continue-on-error`; every `uses:` is a 40-hex SHA, consistently across files
  and across `codeql-action` sub-paths; `engines` and the CI matrix contain no
  EOL Node major; and `ship.mjs` refuses a branch mismatch, rejects unknown
  options with exit 2, and leaves no tag behind in a dry run. **11 of these fail
  against the pre-fix repo.**
- **The MCP stdio client moved to `tests/helpers/mcp-client.mjs`** and is shared by all
  three test files instead of being duplicated.
- Tests use `os.tmpdir()` fixtures rather than writing into `tests/fixtures/`.
- The test client performs a full MCP `initialize` handshake and advances on responses
  rather than fixed timers — the suite runs in ~14s instead of ~126s.
- `npm test` is now `node --test` (auto-discovery) so new test files are picked up
  without editing `package.json`.

### Known issues still open

Tracked in `AUDIT.md`. The template defects above are fixed, and `scaffold-juce` is the
job that will confirm a scaffolded JUCE plugin configures end to end — **it has not had
a green run yet**, because neither cmake nor apt is reachable from the environment the
fixes were developed in, and `publish` deliberately does not depend on it until it has.
Phases 3, 4 and 5 are complete. The remaining blocker is **OPS-07: GitHub Actions
cannot run at all until the account's billing lock is cleared**, so none of the new CI
jobs — including `scaffold-juce`, the only check that can prove a scaffolded JUCE plugin
configures against real JUCE — has ever executed. No workflow change made in Phase 4 or
5 has been validated by a real run either; they were validated by parsing, by
`tests/release.test.js`, and by `npx js-yaml`. `publish` therefore still does not depend
on `scaffold-juce`, and its apt package list is unverified against whatever
`ubuntu-latest` is by the time it first runs (`ubuntu-latest` becomes Ubuntu 26 on
2026-10-19).

The largest unverified assumption in the project is **`cmake -B build` on a scaffolded
plugin** (AUDIT Phase 6, item 41). No CMake binary was obtainable in the environment the
fixes were made in. What is proven instead: the generated CLAP sources compile clean
under `g++ -Wall -Wextra` against **real** free-audio/clap headers, and the generated
JUCE sources pass `g++ -std=c++20 -fsyntax-only` against a **transcribed stub** of the
JUCE 9 API — not real JUCE. Configure and build of a generated project have never run
anywhere.

Coverage is incomplete in a known way too: `clean`, `generator`, `options` and
`testName` have no tests, and `audio_plugin_create`/`plugins` have happy-path coverage
only. The unbuilt `TODO.md` feature scope (Standalone → ARA → LV2) follows. See
`HANDOFF.md` for file:line detail.

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
