# Changelog

> Documentation now lives in [docs/](docs/README.md); the current state is in
> [docs/project-status.md](docs/project-status.md). This file is the dated release
> history and is read by `scripts/ship.mjs` before tagging. File names mentioned in
> older entries (`TODO.md`, `AUDIT.md`, `HANDOFF.md`) reflect the pre-reorg layout:
> those records are now in `docs/` and `docs/archive/`.

## [Unreleased] — 2.0.0

> **2.0.0 release note:** `engines.node` is now `>=22`. Node 18 ended 2025-04-30 and Node 20 ended
> 2026-04-30, so neither receives security patches. Installations still on Node 20 must upgrade.
>
> During the 2.0.0 hardening work, `ara` was temporarily removed after the old generator was found
> to emit invalid `FORMATS ARA`. It is now reintroduced as a JUCE ARA effect scaffold using
> `IS_ARA_EFFECT TRUE` and real plugin formats; the intermediate removal is not part of the final
> supported type list. See **JUCE ARA effect template** below.
>
> The version now lives **only** in `package.json`; `index.js` reads it at startup
> (OPS-03), so the two cannot drift. Several tools also now return `isError` in
> cases where they previously reported success — see *Tool output & failure
> reporting* below.
>
> `apc` also **gains** `type: "standalone"` and `type: "lv2"` — additive enum
> values, not breaking ones.

### JUCE ARA effect template

- **`type="ara"` is reintroduced with a dedicated JUCE effect scaffold.** The generated target uses `FORMATS VST3 AU`, `IS_ARA_EFFECT TRUE`, stable ARA factory/archive IDs, an `AudioProcessorARAExtension` processor, an `AudioProcessorEditorARAExtension` editor, a playback renderer that reads ARA source regions, and an `ARADocumentControllerSpecialisation` with `createARAFactory()`.
- **External ARA SDK is required.** CMake fails early with `FATAL_ERROR` when `APC_ARA_SDK_PATH` is unset, empty, or does not point to an initialized SDK root containing `ARA_Library/PlugIn/ARAPlug.h` and `ARA_API/ARAInterface.h`; it calls `juce_set_ara_sdk_path(...)` before `juce_add_plugin(...)`. `apc` defers auto-configuration and reports the configure option; `formats` overrides are rejected for ARA. This supersedes the historical removal notes below, which describe the invalid intermediate scaffold.
- Added structural, C++ compile/link fixture and CMake missing-SDK integration coverage for the ARA template.

### DSP kit & optional licensing seam

- **Vendored `apc::dsp` kit and `apc::license` seam from `Noizefield/audio-plugin-coder` (MIT)** into `templates/common/dsp/` and `templates/common/licensing/` with upstream attribution.
- **CMake & scaffold integration:** All four JUCE plugin templates (`juce`, `juce-jive`, `juce-webview`, `ara`) now expose `APC_USE_DSP_KIT` (default `ON`, linking `APC::dsp` and defining `APC_HAS_DSP_KIT=1`) and `APC_USE_LICENSE_SEAM` (default `OFF`, adding the licensing include path and `APC_HAS_LICENSE_SEAM=1`). `apc` copies `common/dsp/` and `common/licensing/` into newly scaffolded JUCE projects when missing.

### Lint gate

- **The template house style is now checked by `npm test`, not only by CI.** `npm run cmake:lint`
  needs `pip install cmakelang`, so a template edit breaching `.cmake-format.py` was previously
  discovered only by the `lint-config` CI job. The ARA missing-SDK `FATAL_ERROR` was joined onto a
  single 111-column line this way and turned an otherwise green run red. Two tests in
  `tests/release.test.js` now reproduce cmake-lint's C0301 and C0307 findings (reading
  `line_width`/`tab_size` from `.cmake-format.py` rather than hard-coding them) and fail locally
  with the offending file, line and column count.

### Tool names

- The short names are canonical and preferred: `apc`, `apc-add-param`, `apc-ship`,
  `apc-doctor`, `apc-cfg`, `apc-build`, `apc-test`, `apc-lint`, `apc-val`, and
  `apc-list`. The previous `audio_plugin_*` names are registered as deprecated
  compatibility aliases and share the canonical handlers.

### Security

- **Path traversal in `apc-lint` closed (critical).** `target` was validated
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

- **Symlink containment hardened in `assertWithinProject()`.** Existing path
  ancestors are now resolved with `fs.realpathSync()` against the real project
  root, and `findFilesByExt()` skips symbolic links, preventing symlinks inside
  the project (such as `_tools/` links or a symlinked `plugins/` directory) from
  causing writes or `clang-format -i` edits outside the project root.
- **Context-specific template escaping & single-pass substitution.** `description`
  is now escaped separately for C++ string literals (`PLUGIN_DESCRIPTION_CXX`),
  CMake quoted arguments (`PLUGIN_DESCRIPTION_CMAKE`), and LV2 Turtle literals
  (`PLUGIN_DESCRIPTION_TTL`), and `replaceTemplateVars()` substitutes placeholders
  in a single pass so `{{KEY}}` substrings inside user values are never
  cross-expanded.
- **Dev-dependency `minimatch` advisory resolved.** `eslint` is now `^10.15.0`,
  whose own range is `minimatch@^11.0.5`, so `npm audit` reports **0**
  vulnerabilities across the runtime and dev trees with no `overrides` block. (The
  original fix pinned `minimatch@^11.0.5` through an override while `eslint`
  declared `^10.2.6`; that worked for the audit but left `npm ls` reporting an
  invalid tree across a declared major, and the override is gone.)
- **Second security review (`SECURITY-REVIEW-2.0.0.md`), all findings fixed.**
  - `audio_plugin_configure` no longer forwards `-D` variables whose value CMake
    executes or loads (`CMAKE_PROJECT_TOP_LEVEL_INCLUDES`, `CMAKE_PROJECT_INCLUDE*`,
    toolchain/module paths, compilers, launchers, `*_FLAGS`, `CMAKE_MAKE_PROGRAM`, …).
    A single option could previously run an arbitrary `.cmake` script or binary.
  - A `CMakeCache.txt` that belongs to another source tree, or that carries one of
    those settings, is deleted before `configure` and before `build`'s
    auto-configure — a committed cache used to execute code with no arguments at all.
  - Every write in `audio_plugin_create` now re-resolves the real path immediately
    before use, refuses to traverse a symlinked directory, creates directories one
    level at a time and opens files with `O_NOFOLLOW`/`O_EXCL`. A `plugins/`
    directory swapped for a symlink mid-call could previously redirect the scaffold
    outside the project root (reproduced: three plugin trees written outside).
  - `#` and `;` in `description`/`vendor` are escaped as octal C escapes (`\043`,
    `\073`). They reach a generated compile definition, where a raw `#` comments out
    the rest of the Makefile line and `;` splits the CMake list — either one made a
    legally-named JUCE plugin fail to compile.
  - `audio_plugin_plugins` caps `status.json` at 4 KiB, echoes only
    `type`/`status`/`version`, and flattens every project-authored string to one
    short line. A 2 MB or newline-bearing `status.json` was echoed verbatim.
  - `audio_plugin_validate` skips artefacts that are symlinks or resolve outside the
    project instead of handing them to the validator, and reports what it skipped.
  - `audio_plugin_lint` returns `isError` when an explicit target contains no C/C++
    files instead of reporting a clean result for zero files checked.
  - `buildDir`/`pluginsDir` reject `\` and `:` — values that produced CMake that
    could not configure (`Invalid character escape '\u'`) after a successful scaffold.
  - `htmlEscape()` also escapes quotes; diagnostic lines are capped at 500 characters;
    the documented `maxBuffer` (16 MB) now matches the code; timeouts kill the whole
    process group instead of just `cmake`.

### Fixed

- **JUCE plugin templates set an explicit `LV2URI` (CI: "Scaffolded JUCE
  builds" and "audio_plugin_validate against real pluginval" were red).** JUCE
  derives its default LV2 URI from `COMPANY_WEBSITE` as
  `<website>/plugins/<name>`. The templates ship no `COMPANY_WEBSITE` — it would
  be a guessed domain (`https://<lower-cased-vendor>.com`) printed verbatim in
  plugin metadata — so the derived value was `/plugins/<Name>`, which has no
  scheme and trips JUCE's `static_assert` in
  `juce_audio_plugin_client_LV2.cpp` (*"Your configured LV2 URI must include a
  leading scheme specifier"*). Because the LV2 target is built alongside VST3,
  this failed both the JUCE build job and the pluginval job. `templates/juce`
  and `templates/juce-webview` now pass `LV2URI "{{PLUGIN_URI}}"` — the same
  sanitized `urn:<vendor>:<plugin>` identity the native `type="lv2"` template
  uses — and the guessed `COMPANY_WEBSITE`/`COMPANY_EMAIL` values are gone from
  the JUCE and standalone templates. Regression tests now require every
  LV2-capable JUCE template to carry a scheme-prefixed, unique `LV2URI`, and
  fail if a template hard-codes a vendor `.com`/`.net`/`.org` URL again.

- **`audio_plugin_validate` CLI invocations & custom `pluginsDir` fixed.**
  `pluginval` now receives `--strictness-level 10 <path>` (replacing invalid
  `--strictness` and nonexistent `--validate-in-new-process`), `clap-validator`
  now receives `validate <path>`, the `clap-validator` install URL now points at
  `free-audio/clap-validator` (replacing the dead 404 `CLAP-Workspace` URL), and
  `findPluginBinaries()` honours `config.pluginsDir` instead of hardcoding
  `build/plugins`.
- **CLAP scaffold packaging & `CLAP_EXT_AUDIO_PORTS` fixed.** `templates/clap`
  now builds a `MODULE` library producing a CFBundle on macOS and a single
  `.clap` DSO on Linux/Windows (instead of a `<name>.clap/` directory), exposes
  stereo `CLAP_EXT_AUDIO_PORTS`, and returns `CLAP_PROCESS_CONTINUE` on 0-port
  transport calls so `clap-validator` transport tests pass.
- **Windows WebView2 compile definition added to `templates/juce-webview`.**
  Added `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1` alongside
  `NEEDS_WEBVIEW2 TRUE` so `JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE` is
  enabled on Windows under JUCE 9; switched `UI/app.js` to `encodeURIComponent`
  and `WebViewEditor.cpp` to preserve `=` in query values.
- **`audio_plugin_lint`, `audio_plugin_build`, `audio_plugin_test`, and CLI flags
  hardened.** `lint` now handles single-file `target` paths, lints `.c` files
  (such as `templates/lv2/Source/plugin.c`), and skips `build/` and `_tools/` on
  whole-project runs; `build` passes `--config <Config>`, reconfigures when
  cached `CMAKE_BUILD_TYPE` changes, parses tool-level `LINK : fatal error LNK...`
  lines, and surfaces raw output when unparsed build failures occur; `test`
  counts `***Timeout` / `***Exception` lines and includes `stderr` in failure
  details; `apc-mcp --version` and `--help` now exit cleanly instead of hanging
  on stdio.
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

#### Native LV2 metadata

- **A bug the new tests caught in the template before it shipped:** the first
  version of `manifest.ttl` declared `rdfs:seeAlso <{{PLUGIN_NAME}}.ttl>` while the
  scaffolded file was named `plugin.ttl`. A host would have loaded the plugin with
  **no metadata at all** — no name, no ports, no licence — and reported nothing
  wrong while doing it. `rdfs:seeAlso` now names the file that is actually
  scaffolded, and a test asserts it exists.


#### Artefact discovery (`audio_plugin_validate`)

- **`audio_plugin_validate` could not find most build artefacts (FUNC-21).** Two
  independent causes, both invisible in this README's own examples because they
  happen to dodge them.
  - **The artefact is not named after its directory.** `templates/juce/CMakeLists.txt`
    sets `PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"`, and `displayName()` title-cases the
    name and turns `_`/`-` into spaces. JUCE names the artefact after PRODUCT_NAME
    (`_juce_set_output_name`) but the directory after the CMake target, so
    `name="my_verb"` builds `VST3/My Verb.vst3` inside `plugins/my_verb/`. The old
    code constructed `${dir}.vst3`, found nothing, and reported *"No plugin binaries
    found … run audio_plugin_build first"* — telling the user to redo a build that
    had already succeeded. 4 of 6 plausible names were affected (`MyVerb` and
    `Phaser9000` are not, because `displayName()` is the identity for them).
  - **Audio Units were looked for in a directory JUCE never creates.** JUCE's kind
    string is `AU`, from `_juce_get_platform_plugin_kinds()`, so `.component`
    bundles live in `<Config>/AU/`. The code looked in `AudioUnit/`, which made AU
    artefacts undiscoverable at all.
  - **`Standalone` and `LV2` returned directories, not artefacts.** JUCE sets the
    Standalone artefact to `$<TARGET_BUNDLE_DIR>` on macOS (`X.app`) and
    `$<TARGET_FILE>` elsewhere (`X.exe`, or an extension-less executable on Linux) —
    returning the containing directory gave a path that cannot be run or validated.
    LV2 likewise reported `LV2/` instead of the `<name>.lv2` bundle inside it.

  Artefacts are now found by **scanning for the format's suffix** rather than by
  constructing a filename: `*.vst3`, `*.clap`, `*.lv2`, and `AU/*.component`.
  Standalone is matched by platform shape in JUCE's own priority order
  (`.app` bundle → `.exe` → an extension-less file that actually has the
  executable bit), so a README or a `.pdb` dropped into the output directory is
  never reported as the binary. `AudioUnit` stays the user-facing name in
  `apc-mcp.json`'s `validateFormats` so existing configs keep working, mapped to
  JUCE's `AU` directory internally.


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

- **`type: "lv2"` on `audio_plugin_create` — a new `templates/lv2/`.** A **native**
  LV2 plugin: pure C against `lv2/core/lv2.h` plus Turtle metadata, with no JUCE
  dependency. This is not the LV2 that `type="juce"` emits from a C++
  `AudioProcessor`; the two share only a name. You get `Source/plugin.c` (the
  `LV2_Descriptor`, its eight callbacks and the exported `lv2_descriptor()`, as a
  stereo gain stage with one control port), `Source/manifest.ttl` and
  `Source/plugin.ttl`, and a `CMakeLists.txt` that builds a `MODULE` library into
  the same `<build>/plugins/<name>/<name>_artefacts/<config>/LV2/<name>.lv2/`
  bundle layout `audio_plugin_validate` already scans, copying the `.ttl` files in
  beside the binary so the build output is a loadable bundle rather than a stray
  shared object. `PREFIX ""` and `SUFFIX ".so"` pin the filename on every platform,
  because `manifest.ttl` names it literally and a host loads it through the
  platform's dynamic loader, which does not care about the extension.
  - The plugin URI is derived **once** in `index.js` and written into all three
    files, so the C descriptor and the two Turtle subjects cannot disagree.
  - The descriptor uses **designated initialisers**. A positional initialiser
    compiles happily in the wrong order because `run` and `connect_port` are
    similar enough in shape to swap unnoticed.
  - `description` is escaped for Turtle before being written: `SAFE_DESCRIPTION`
    allows `"` and `\`, and either one would terminate the string literal early
    and leave the host with unparseable metadata.
  - `formats` is rejected for this type with a message that explains the
    difference from JUCE's LV2 output, rather than being silently dropped.

- **`type: "standalone"` on `audio_plugin_create` — a new `templates/standalone/`.**
  It scaffolds a standalone audio **application**, not a plugin: `juce_add_gui_app()`
  builds one executable that owns its audio device through `juce::AudioAppComponent`.
  You get `Source/Main.cpp` (a `juce::JUCEApplication` plus its `DocumentWindow`, with
  `START_JUCE_APPLICATION()` generating `main()`), `Source/MainComponent.{h,cpp}` (a
  440 Hz sine generator with a level slider), and a `CMakeLists.txt`. Two details
  it gets right that older example code does not:
  - **`AudioAppComponent` has no `start()` and no `stop()` to call.**
    `setAudioChannels()` both initialises the device and starts the callback, and its
    counterpart `shutdownAudio()` *must* be called from the derived destructor — the
    base class `jassert()`s otherwise. (This bullet originally claimed JUCE 9 had
    *removed* those methods and that most tutorials would not compile against
    JUCE 9. Both claims were fabricated history — see the template-comments
    correction below — the methods never existed in the JUCE versions checked.)
  - **An app target accepts no plugin keywords.** `juce_add_gui_app()` performs no
    `UNPARSED_ARGUMENTS` check, so `FORMATS`, `PLUGIN_CODE` and `IS_SYNTH` would be
    dropped silently. They are absent, and `audio_plugin_create(type="standalone",
    formats="VST3")` is now **rejected with an explanation** rather than silently
    ignoring the argument — the same silent-drop failure mode JUCE's CMake API has
    and this project refuses to copy.
  - The level is shared between the message and audio threads through a
    `std::atomic<float>`; a plain `float` there is a data race, and the oscillator
    advances its phase once per sample (not once per channel per sample) and wraps it
    with `fmod` so precision does not decay over a long run.

- **`.github/pull_request_template.md`.** The GitLab merge-request checklist that
  survived the move to GitHub was deleted (`.gitlab/` — GitHub never reads it), and
  its genuinely useful items were migrated here, updated for `npm run check`, the
  template and CMake-keyword rules, the red-phase-in-a-worktree requirement, and the
  `scripts/ship.mjs` release steps.
- **`eslint.config.js`** and `eslint` + `@eslint/js` as devDependencies (both under
  allowlisted licenses). `BlueOak-1.0.0` was added to `license_decisions.yml` — a
  permissive license in ESLint's dev tree that the gate was warning about.
- **A `scaffold-lv2` CI job** that configures a scaffolded LV2 plugin with real
  cmake against real LV2 headers, and `compile-scaffold` now clones `lv2/lv2` as
  well as `free-audio/clap`. `publish` is gated on `scaffold-lv2`: the policy, now
  encoded in `tests/release.test.js`, is that a scaffold job gates the release when
  it needs nothing but cmake, a compiler and a git clone — no apt packages whose
  names can move when `ubuntu-latest` is rebased. `scaffold-clap` and
  `scaffold-lv2` qualify; `scaffold-juce` installs JUCE's Linux dependency list and
  does not, so it stays out until it has one green run.

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
  derived from `juce::AudioProcessor` without `juce::AudioProcessorARAExtension`, so it
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

- **`tests/templates.test.js` grew 44 → 58** with a 14-test native-LV2 suite: the
  URI agrees across `plugin.c`, `manifest.ttl` and `plugin.ttl` and is a valid URN;
  **every `lv2:index`/`lv2:symbol` pair in the Turtle is checked against the enum
  and the `connect_port()` switch in the C** (a mismatch makes the host connect a
  gain value to an audio buffer with no error anywhere); indices are contiguous
  `0..n-1`; each port has exactly one `lv2:symbol` and at least one `lv2:name`, as
  `lv2core.ttl` requires; each declares a direction and a port type; control ports
  carry `lv2:default`/`minimum`/`maximum`; `lv2:minorVersion`/`microVersion` are
  integers not strings; `manifest.ttl`'s binary name matches what CMake builds;
  `rdfs:seeAlso` names a file that exists; the bundle lands where `validate` scans;
  `MODULE` not `SHARED`, with a `FATAL_ERROR` when the headers are missing and no
  `target_link_libraries` (LV2 core is header-only); designated initialisers and
  `LV2_SYMBOL_EXPORT`; the template is C, not C++; a `"`-and-`\`-laden description
  is escaped; and `ui` is ignored while `formats` is rejected.
- **`tests/cpp-api.test.js` now compiles C as well as C++** (7 → 9 tests) and is
  configured by a per-family table rather than a chain of conditionals. The LV2
  case compiles `plugin.c` with a C compiler and `-std=c11` against the **real**
  upstream LV2 headers via `APC_LV2_INCLUDE`, so its result is genuine rather than
  stub-level. A second guard test asserts the LV2 headers were actually present, so
  "the compile checks passed" cannot quietly mean "the compile checks were
  skipped". `-Wextra` was added to every compile invocation.
- **Three existing tests were re-scoped.** They used `if (s.type === 'clap')
  continue;` to mean "JUCE templates"; with `lv2` added that predicate is wrong, so
  they now select on the JUCE family explicitly.
- **Total 147 → 163 tests.** `scripts/smoke-scaffold.mjs` grew 7 → 9 cases with an
  `lv2` family for the optional `--configure` step.

- **New `tests/artefacts.test.js` — 13 tests** driving the real tool over stdio
  against planted build trees, so no cmake is needed. Red phase confirmed: 9 of 13
  failed before the FUNC-21 fix, with the predicted messages. The 4 that passed are
  deliberate regression guards (CamelCase names, CLAP, and two negative cases) so
  the fix cannot be over-broad.
- **`tests/templates.test.js` grew 30 → 44** with a standalone-application suite:
  `juce_add_gui_app` and never `juce_add_plugin`; **no plugin-only keyword** (each
  one would be silently dropped); every keyword used is one JUCE actually parses;
  the target is not `${PROJECT_NAME}`; app and plugin targets cannot collide;
  `START_JUCE_APPLICATION` names a real `JUCEApplication` subclass and appears
  exactly once; `shutdownAudio()` is in the destructor; **no `start()`/`stop()`**;
  all three pure-virtual `AudioSource` methods are overridden; the shared level is
  atomic; `ui` is ignored; and `formats` is rejected.
- **`tests/cpp-api.test.js` now compiles the standalone app's C++** against the
  fixture stub, which was extended with the application-side JUCE 9 API
  (`JUCEApplication`, `DocumentWindow`, `Slider`, `Label`, `Graphics`, `Colour`,
  `Justification`, `AudioSource`, `AudioSourceChannelInfo`, `AudioAppComponent`,
  `AudioDeviceManager`, `MathConstants`, `ProjectInfo`). The extension was checked
  for teeth: a component calling `start()`/`stop()` (methods `AudioAppComponent`
  never had in any version checked) and a typo'd `setUseNativeTitleBar` both fail
  to compile against it.
- **Total 119 → 147 tests.** `scripts/smoke-scaffold.mjs` grew 5 → 7 cases and now
  derives the expected CMake command from `type` (`add_library` / `juce_add_plugin` /
  `juce_add_gui_app`) instead of a two-way branch.

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

- **`type="ara"` remains unbuilt (`TODO.md`).** Removed in 2.0.0 because the old
  scaffold emitted invalid `FORMATS ARA` on a non-ARA processor; re-introducing
  it requires a dedicated `IS_ARA_EFFECT TRUE` template and external ARA SDK
  headers in CI.

*(Earlier `OPS-07` billing-lock and `scaffold-juce` CI notes from Phase 5 have
since been resolved: `compile-scaffold`, `scaffold-clap`, `scaffold-lv2`,
`scaffold-juce`, `license`, and `CodeQL` all run on GitHub-hosted runners, and
`scaffold-juce` is now in `publish.needs`.)*

### Post-audit remediation — 2026-11-16

A second release audit (`AUDIT-2.0.0-RELEASE.md`, kept out of the published
package) re-checked every 2.0.0 claim against the code, with reproduction. It
found two High and eight Medium defects; the changes below close them. No
behaviour here is new — it is the difference between a claim and a check.

- **The audit gate now actually passes (High).** `npm audit` reported two
  moderate `hono` / `@hono/node-server` advisories reached through the SDK's HTTP
  transport (never loaded by this stdio server) and exited 1, so both
  `npm run check` and `npm run ship` were blocked. `npm audit fix` resolved them —
  **0 vulnerabilities, no `overrides`, no `--audit-level` flag**. CI had been
  running `npm audit --audit-level=high`, which is why the workflow stayed green
  while the documented local gate failed; it now runs `npm run audit`.
- **Validators are exercised for real (High).** Every `audio_plugin_validate`
  test installs a `PATH` shim, so nothing anywhere proved that upstream's
  `pluginval` / `clap-validator` accepts the invocation, or that a scaffolded
  plugin passes it. Two new CI jobs install both tools from their releases,
  scaffold and build a real plugin, and require a `PASS` — via the new
  `scripts/smoke-validate.mjs`, which **exits non-zero when a dependency is
  missing instead of skipping**. `npm run check` is unchanged (it stays free of
  multi-GB SDK downloads). The first execution found three genuine defects that no
  shim could have caught: a CI step that relied on GNU `timeout` (absent on
  macOS), a guessed archive layout for `clap-validator` (the identical pluginval
  install worked), and a build tree placed outside `projectPath`, which
  `audio_plugin_validate` correctly refused to scan. All three are fixed and the
  jobs now pass against the real binaries.
- **`audio_plugin_validate` no longer reports an unactionable failure.** Asking
  for `LV2`, `AudioUnit` or `Standalone` produced `1 passed, 1 skipped` with
  `isError: true` and "install the missing validator(s)" — advice that can never
  be followed, because no validator exists for those formats. Those artefacts are
  now reported `NOT CHECKABLE` and do not affect `isError`; a *configured* but
  missing validator still fails the run. `format` also accepts all five artefact
  values now, instead of rejecting `LV2` as a schema error.
- **`projectPath` no longer rejects legitimate paths.** It was filtered through
  `SAFE_PATH`, whose rejection message said the path "contains shell
  metacharacters" — but this server never uses a shell. `my project (v2)`,
  `ACME's plugins` and `Path+Name&Co` were refused for no reason. Only
  non-strings, empty strings and NUL bytes are rejected now; the project boundary
  is still enforced by `assertWithinProject()`, which is what actually contained
  the paths. `SAFE_PATH` survives only for the two config values interpolated
  into CMake source.
- **`vendor` and `description` accept non-ASCII and are escaped per grammar.**
  Both were ASCII-only, so `Café Audio` was rejected, and the rejection leaked a
  raw regular expression (`must match /^[\x20-\x7E]+$/`) through JSON-RPC at the
  model. Both now accept any single line of text; control characters are rejected
  with an explanation. `vendor` joins `description` in being escaped per output
  grammar (C++ literal, CMake quoted argument, Turtle literal, HTML text node) via
  `VENDOR_CXX` / `VENDOR_CMAKE` / `VENDOR_TTL` / `VENDOR_HTML`. The bare
  `{{VENDOR}}` placeholder is gone, so a template that used it would leave a
  literal placeholder behind — which the scaffold smoke test fails on.
- **`configure` no longer fights the cache.** `-G <generator>` was passed on
  every configure, so a cached `CMakeCache.txt` from a different generator was
  either ignored or failed the configure with a confusing CMake error. The flag is
  now only sent when there is no cache yet. A failure with empty stderr no longer
  produces a blank failure message.
- **A test run that found no tests is a failure.** `ctest` exits 8 with
  `No tests were found!!!`, which the parser read as `0 failed` — a green result
  for a suite that never ran. It now returns `isError: true` with that
  diagnosis instead of a clean summary.
- **Tools advertise `title` and annotations.** All seven were registered via the
  deprecated `server.tool()` with only a name and schema, so a client showed bare
  snake_case names and no safety hints; `audio_plugin_lint(fix=true)` rewrites
  files with nothing saying so. Registration now goes through
  `server.registerTool()` with a title and `readOnlyHint` / `destructiveHint` /
  `idempotentHint` / `openWorldHint`, and a tool with no metadata throws at
  startup rather than shipping undefined hints.
- **Fabricated JUCE history removed from template comments.** Three templates
  claimed JUCE 9 "removed `start()`/`stop()`" and "removed
  `XmlDocument::storeXmlAsString`". Neither symbol exists in JUCE 6.1.6, 7.0.12,
  8.0.15 or 9.0.5 — the comments invented a breaking change to justify code that
  was simply written without them. The code was correct; the reasoning was not,
  and a reader would have learned something false about JUCE.
- **The suite runs on macOS too.** `test` is now a matrix over
  `ubuntu-latest` / `macos-latest`, because the server branches on
  `process.platform` and only the Linux branch had ever executed. Windows is
  documented as unverified rather than added speculatively: the security tests
  drive POSIX shebang shims, so a Windows job would test the fixtures, not the
  server.

### Static-quality review (S-1 … S-22)

Root-cause fixes for the findings in [REVIEW-STATIC-QUALITY.md](REVIEW-STATIC-QUALITY.md).
Each one is now guarded by a probe, a test, or a real toolchain run.

A subset (S-1, S-2, S-3, S-8 and the `npm.cmd` half of S-19) was fixed in a parallel
change that landed first; the entries below describe the code as it ships now, and
the review's §8 records which change carries which fix.

- **The no-shell lint rule now bans the option, not the variable name (S-1).** It
  matched an object literally named `child_process` and an import named `exec`, so a
  default import, a namespace import and `{ shell: true }` on the sanctioned
  `spawnSync` all passed. All four are rejected now, and `tests/release.test.js`
  lints each one through the real config so the rule cannot rot.
- **A crashed lint tool is no longer reported as "0 of N files with issues" (S-2)**,
  and unreadable directories are listed as skipped instead of vanishing (S-3).
- **`cmake --install` honours `--prefix` for LV2 (S-4).** The install `DESTINATION`
  was expanded from `CMAKE_INSTALL_PREFIX` at configure time, which froze the path
  into `cmake_install.cmake`: `cmake --install build --prefix X` installed into the
  configure-time prefix and left `X` empty. It is now relative
  (`${CMAKE_INSTALL_LIBDIR}/lv2`) via `GNUInstallDirs`.
- **The WebView gain is smooth and bounded (S-5).** The parameter was quantised to
  0.01 and applied as one multiply per block — zipper noise. It is now continuous
  and driven by a 20 ms `juce::SmoothedValue` advanced once per sample; the page's
  `setGain` message is clamped to 0..1 with NaN rejected instead of being trusted.
- **`strictnessLevel` is configurable (S-9)** — 1..10 in `apc-mcp.json`, still 10 by
  default — and the validator runs with the project as its working directory so its
  logs land inside the project.
- **`options` accepts values containing spaces (S-10)** by splitting on `;` first;
  plain whitespace separation still works. `;` was added to the schema charset and a
  space to the value class of `SAFE_CMAKE_OPTION_TOKEN` — each token is still one
  argv entry and is still validated, so `-DA=ON; rm -rf /` is still rejected.
- **Templates no longer assert things that are not true.** `JUCE_DISPLAY_SCALE_ENABLED`
  is gone (0 references in JUCE 9.0.5), `COMPANY_WEBSITE`/`COMPANY_EMAIL` are gone
  (they shipped a guessed domain in DLL properties and VST3 metadata), the LV2 gain
  is an `lv2:AmplifierPlugin` with `lv2:designation` on its ports instead of an
  anonymous `lv2:UtilityPlugin`, and the fabricated `doap:license` triple was
  replaced by a comment telling the user to state their own. `JUCE_MODAL_LOOPS_PERMITTED`
  is no longer defined for plugin targets, so a nested event loop cannot be compiled
  into a host callback (the standalone app keeps it deliberately).
- **The JUCE templates now pass an explicit `LV2URI`.** JUCE derives it as
  `<COMPANY_WEBSITE>/plugins/<Name>` when it is not given, which meant the LV2 identity
  of every scaffolded JUCE plugin was `https://<vendor>.com/plugins/<Name>` built from
  an invented domain — and the plugin's LV2 URI is permanent once a host saves a
  session. It is now `urn:<vendor>:<name>`, derived once in `index.js` and shared with
  the native LV2 template. Without this the LV2 target stopped compiling outright
  (`static assertion failed: Your configured LV2 URI must include a leading scheme
  specifier`) as soon as the fabricated `COMPANY_WEBSITE` was removed.
- **The LV2 NULL-port guard actually silences the output (S-14)** instead of
  returning early and leaving the host's previous block in the buffer.
- **Two templates stopped teaching the wrong buffer pattern.** The JUCE
  pass-through copied each channel onto itself (S-15; the loop is deleted, the
  comment says why a pass-through needs no code), and the standalone generator
  hoists `getArrayOfWritePointers()` instead of calling `setSample()` per sample
  (S-16).
- **`ship` is Windows-correct and cannot hang (S-19).** It spawns `npm.cmd`, which
  Node refuses to spawn without `shell: true` (`EINVAL`); it now runs npm's CLI JS
  with `process.execPath`. Every child has a timeout and git runs with
  `GIT_TERMINAL_PROMPT=0`, so a missing credential fails the release instead of
  blocking it forever.
- **`assertWithinProject()` fails closed (S-21)**: a `realpath` error now rejects
  instead of silently skipping the symlink check.
- Schema fields gained `.max()` caps (S-6), the single `spawn()` wrapper diagnoses
  `ENOBUFS` as a 16 MB output overflow rather than a failed start (S-8), the template
  map throws on an unknown type instead of falling through a `default:` arm (S-17),
  and the docs now say that **no tool** writes
  `status.json` (S-18).

`outputSchema` / `structuredContent` (S-20) is deferred: it is an additive feature,
not a defect, and the existing `format: "json"` modes remain machine-readable.


### Static-analysis gates (review §5)

The review's §5 listed analysis that was missing. PR #37 left it open on purpose: it
is new CI machinery rather than a defect fix. Each gate below is wired into CI, was
run in this checkout, and was shown to fail on a deliberately broken input before
being kept.

- **`tsc --checkJs` over `index.js` and `scripts/`** — `tsconfig.json`, `npm run
  typecheck`, and `npm run quality` is now lint + typecheck + test. It found four
  defects: `spawnSync(...).error.code` was read at four sites behind a type that says
  `code` does not exist (narrowed now, through `trySpawn()`'s `spawnError` and
  `ship.mjs`'s `errno()`); `audio_plugin_validate`'s result rows mixed `reason` and
  `output` freely across statuses (now a JSDoc union that says which status owns
  which field); and two test helpers passed loosely-typed options.
- **`eslint-plugin-n`** — its recommended module rules plus `n/prefer-node-protocol`.
  It caught two defects in code that shipped in 2.0.0: `scripts/smoke-stdio.mjs` used
  `import.meta.dirname`, which exists only on Node ≥ 22.16.0 (and 24), while
  `engines.node` promises `>=22` — so the stdio smoke test threw on its first line on
  Node 22.0–22.15; and `index.js` imported `path`/`fs`/`os`/`url` without the `node:`
  prefix. `n/no-process-exit` and `n/hashbang` are off, with the reason written where
  they are configured rather than suppressed inline.
- **`-Wall -Wextra -Wpedantic -Werror` in `templates/clap` and `templates/lv2`**
  (`/W4 /WX` under MSVC, guarded by `if(MSVC)`), applied `PRIVATE` to the generated
  target so a host project's targets are unaffected, with the third-party headers
  included `SYSTEM` so `-Werror` only judges generated code. Both templates build
  clean against real `free-audio/clap` and `lv2/lv2` headers.
- **`clang-tidy`** over the generated sources, configured by a new `.clang-tidy`
  (analyzers plus `bugprone-*`, `performance-*`, `portability-*`, findings promoted to
  errors) and driven through CMake's `compile_commands.json`. The style families
  (`readability-*`, `cppcoreguidelines-*`, `modernize-*`) are deliberately excluded: a
  scaffold that ships a stranger's taste is not thereby more correct. It runs with
  `--config-file=` because the scaffolded sources live in a temp directory, so
  clang-tidy's own upward search would never find the config — the first CI run proved
  that by reporting warnings that were not promoted to errors.
- **`lv2lint`** on every built bundle. Nothing in the repo previously parsed the Turtle
  that gets copied into the bundle, so a malformed or mis-typed description could only
  be found by a host.
- **`cmake --install --prefix` smoke** — the thing that would have caught S-4. It fails
  if the bundle lands under `/usr/local/lib/lv2` despite `--prefix`, and it checks the
  installed bundle for the binary and both `.ttl` files.
- **`cmake-lint`** (`npm run cmake:lint`, and the CI `lint-config` job) with a new
  `.cmake-format.py` that *declares* the house style — 4-space indents, 100 columns —
  instead of disabling the two checks that complained, so `C0301`/`C0307` still fire on
  a real violation. It found two 121-column `OUTPUT_DIRECTORY` lines in the LV2
  template, now the `LV2_ARTEFACTS_DIR`/`LV2_BUNDLE_DIR` variables.
- **`actionlint` + `shellcheck`** in a new `lint-config` CI job, which `publish` now
  needs along with the rest. `actionlint` checks the workflow schema and expressions and
  runs `shellcheck` over every `run:` block; it is pinned to a commit like every other
  action here.

`scripts/smoke-scaffold.mjs` no longer reports a pass for work it did not do: a
`--build` run with a missing SDK used to print `skip <family>` and finish with exit 0,
so a misconfigured job looked green. A build run now names the family it was asked for
(`--family=clap|juce|lv2`, once per family) and fails if that family has no SDK; each
CI job passes exactly the one it has. Outside a `--build` run the skip is still a skip.
The new `--install`, `--lv2lint` and `--clang-tidy` flags fail when their tool is
absent, for the same reason.

`license_decisions.yml` gained `PSF-2.0`, reached dev-only through
`eslint-plugin-n → js-yaml → argparse`; nothing under it is distributed.

Bringing the gates up found three more things, all fixed here: `lv2lint` takes a plugin
URI and a *bundle* directory (`-I` is handed to `lilv_world_load_bundle()`), not a path,
and it is packaged by neither Debian, Ubuntu nor Homebrew, so CI builds it from the
upstream mirror at a pinned commit; `clang-tidy`'s `performance-trivially-destructible`
flagged the CLAP template's out-of-line `~Processor() = default;`, which hid that the
class is trivially destructible (now defaulted on its first declaration); and
`portability-avoid-pragma-once` is disabled, argued in `.clang-tidy`, because
`#pragma once` is what these templates use and what GCC, Clang and MSVC all support.
Three checks are excluded in total, each with its reason written next to the setting.

Not done, and why: `sord_validate` (it needs the LV2 schema files staged on disk, and
`lv2lint` already validates the description through lilv against lv2core) and
`clang-tidy`'s style families (above).

### Hardening pass — PR #36 (2026-11-16, previously undocumented here)

A static-analysis-driven hardening pass whose findings were catalogued in the PR
body (SEC-NEW-01..04, NODE-01..05, CPP-01..04, CMAKE-01..02, UI-01, FUP-07) but
never made it into this file. The user-visible changes:

- **`audio_plugin_configure` `options` are grammar-checked before `cmake` runs**
  (`SAFE_CMAKE_OPTION_TOKEN`). Only `-D<VAR>[:<TYPE>]=<VALUE>`, `-U<GLOB>` and
  `-W[no-]dev/deprecated` flags are accepted; `-B`, `--trace-redirect`,
  `--graphviz`, `-C`, `-P` and friends are rejected, so `options` can no longer
  redirect the build tree or script execution.
- **SDK discovery is root-first in every template.** `clap`, `juce`, `vst3`,
  `standalone`, `lv2` and `juce-webview` all check `${CMAKE_SOURCE_DIR}/_tools/…`
  before the legacy two-directories-up fallback, so a custom `pluginsDir` in
  `apc-mcp.json` no longer breaks vendored-SDK resolution.
- **`audio_plugin_create` cleans up a partially created plugin directory when it
  fails after creating it** (FUP-07), instead of leaving half-written scaffolds
  behind.
- Template-level C++ correctness and WebView fixes (including the
  `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING` compile definition), ESLint script
  hardening, and `toString()`-safe error rendering in the server.

### Substantiation audit remediation — 2026-11-17

A third audit (`SUBSTANTIATION-LOG.md`, kept out of the published package)
graded every 2.0.0 claim as an evidence officer: claim, current evidence level,
and what would be required to tag. Core substantiation was Strong; three
blockers and five should-fixes are closed below. Every fix lands with a
regression test that was **proven to fail against the pre-fix tree** (10 new
tests red on `6c23658`, green after).

Three findings were fixed independently and concurrently by the second security
review above (the artefact-symlink escape, the lint dry-run misreport, and the
`maxBuffer` doc drift); this PR merges with those and adds what was still
missing — the reporting semantics, the remaining parser/config defects, and the
coverage gaps:

- **Residual-risk statement rewritten (security.md).** The old section claimed
  "no residual risk of … arbitrary file read/write outside the project root",
  which is falsifiable: a crafted `options` value (`-DCMAKE_PROJECT_INCLUDE=…`)
  directs CMake to execute a file outside the project, and CMake cache values
  legitimately accept absolute paths, so no charset can contain that. The section
  now states the true boundary — apc-mcp's *own* file operations are contained
  (including the new symlink guards below); the subprocesses it launches
  (`cmake`, compilers, `clang-format -i`, validators) run with your privileges
  and are not containable by design.
- **A refused artefact fails the validation run (blocker-adjacent).** The
  security review made `findPluginBinaries()` *skip* a symlinked or escaping
  artefact; the substantiation audit's requirement is one step stronger — a run
  that declined to validate something it found must never read as clean. A run
  with refused artefacts now reports them in the header (`N refused`), lists
  them with their reason, and returns `isError: true`; a run where *every*
  discovered artefact was refused reports `## Validation refused` instead of
  "no plugin binaries found".
- **A symlinked `apc-mcp.json` resolving outside the project root is ignored**
  (with a stderr warning); one that resolves inside the project is still
  honoured.
- **`{"constructor": …}` in `apc-mcp.json` no longer breaks every tool call**
  (blocker). The schema lookup walked the prototype chain
  (`CONFIG_SCHEMA[key]`), so inherited properties like `constructor` resolved to
  `Object.prototype.constructor` and `validator.safeParse is not a function`
  leaked into every result. The lookup is now `Object.hasOwn()`-based: prototype
  keys are unknown keys, exactly like the documented forward-compatibility
  behaviour.
- **`audio_plugin_lint` dry-run no longer misreports a crashed or timed-out
  `clang-format` as "0 files with problems"** (blocker; found independently as
  DEF-1 here and SEC-NEW-08 in the security review — the review's wording and
  branch merged first, and the regression test added here targets it). The
  failure cause is surfaced and the `fix=true` advice only appears when
  per-file diagnostics exist.
- **Compiler diagnostics from paths containing spaces are counted** (should-fix
  F3). Both the clang/gcc and MSVC patterns required space-free file tokens, so
  an exit-0 build emitting `/home/dev/My Project/Foo.cpp:12:3: error: …` was
  reported as `Build succeeded / Errors: 0`. The anchored `:<line>:<col>:` /
  `(line[,col]):` suffixes do the discriminating; the file token may contain
  spaces.
- **ctest `***Skipped` outcomes are counted as skips** (should-fix F2).
  Previously the line matched neither outcome alternation nor the summary, so a
  run whose every test was skipped reported `## Tests passed` with unknown
  counts. Skips are now a third category (`Skipped: N`, excluded from passed
  and failed), and an all-skipped run reports
  `Tests skipped (none ran to completion)` instead of `Tests passed`.
- **A single `../` inside a `-D` value is rejected** (should-fix F7).
  `hasDotDot()` ran on the whole token, where `-DTEST=../outside` has no bare
  `..` segment — only `../../` values were caught, and the test loop only
  covered that case. The value after `=` is now checked too; the security test
  covers `../x`, `..\x` and a bare `..`.
- **`validateCommand` / `clapValidatorCommand` are regression-tested
  end-to-end** (should-fix): a custom `clapValidatorCommand` receives
  `validate <path>`, and values failing `SAFE_TARGET` (`/x/y`, `a b`, `..`)
  degrade to the default commands rather than escaping.
- **Doc drift** (should-fix): the `options` grammar is documented in `tools.md`
  (merged with the review's `;`-separator documentation), `_tools` discovery is
  described root-first in `toolchain.md` and `project-status.md` (PR #36
  behaviour), and this file gained the missing PR #36 entry above. (The
  `maxBuffer` 2 MB → 16 MB doc fix was also carried by the security review.)
### Verification-matrix follow-ups — 2026-11-18

The second verification pass over the merged 2.0.0 tree left Failed/Partial rows
that no earlier round had closed. The behaviour- and template-changing ones are
closed here. Every fix lands with regression tests **proven to fail against the
pre-fix tree** (5 template tests and 6 handler tests red on `95e3a49`, green
after), and the CLAP template still compiles and links with `-Wall -Wextra
-Werror` against real `free-audio/clap` headers.

- **The CLAP scaffold is host-configurable now: `clap.params` + `clap.state`.**
  The template implemented only audio ports, so a host could load it but never
  adjust it — its gain was a constant from the host's point of view, and a host
  had no way to persist anything. It now exposes one automatable parameter
  (`Gain`, 0…1, default 0.75 — the same value the JUCE templates publish) with
  `value_to_text`/`text_to_value` ("75 %"), consumes `CLAP_EVENT_PARAM_VALUE` in
  `process()` and `flush()` through one shared `applyParameterEvents()`, and
  saves/loads a version-tagged gain through `clap.state` streams.
- **Two CLAP defects the real `clap-validator` caught in this PR's own CI.**
  `param-set-wrong-namespace` failed: the template interpreted any event whose
  type number was `CLAP_EVENT_PARAM_VALUE`, but type numbers only mean that
  within the core event *space* — events with a foreign `space_id` must be
  ignored, and the validator sends exactly such events to prove values do not
  move. And `state-reproducibility-*` failed: after `state.load()` changed
  parameter values, the plugin never told the host to rescan, so a host
  reloading a project would keep displaying the pre-load values. The template
  now checks `space_id == CLAP_CORE_EVENT_SPACE_ID` before interpreting an
  event, requests `CLAP_PARAM_RESCAN_VALUES` through the host's params
  extension when a loaded state actually changed a value, and reads/writes
  state through short-read/short-write-tolerant loops — the CLAP stream
  contract allows partial transfers (the validator exercises 17-byte-buffered
  streams), and a single-shot `read() == sizeof(x)` comparison is not
  contract-safe. Corrupted payloads with a non-finite gain are rejected rather
  than silently clamped to the default.
- **F5 closed: the WebView "Level" bar measures audio.** The processor tracks
  the peak absolute sample of the processed output (after gain — what the
  listener hears) in a `std::atomic<float>`; the editor's 30 Hz timer decays it
  (~0.85 per tick) and pushes it to JS as `level`. The JS no longer drives the
  meter from the slider position, in `updateState` or in the `input` handler:
  a meter that tracks the knob tells a developer nothing about the audio.
- **`formats` is now rejected for `type="clap"` outright.** `formats="CLAP"`
  used to be silently accepted as a no-op even though the schema and docs
  describe the argument as rejected for clap. It now fails with the same
  explanation as any other value, and the advertised schema names clap in the
  `formats` description.
- **`audio_plugin_plugins(format="json")` returns JSON when there is nothing to
  list.** A missing `plugins/` directory used to return the prose sentence
  `No plugins/ directory found in project.` even in JSON mode, breaking every
  caller that did `JSON.parse`. JSON mode now returns `[]`; the prose stays in
  text mode.
- **The validation report no longer overclaims.** An artefact with no validator
  integrated used to be described as "found and is fine" — it was found, but
  never checked, and "found" is not a correctness claim; the wording now says
  exactly that. And a requested format that produced no artefact at all is no
  longer silently omitted from the report: a `**No artefact found**` line names
  those formats, because absence is not proof of a broken build, but silence is
  not coverage either.
- **Diagnostics tell the truth about the grammar they enforce.** The
  invalid-option message advertised `-U<GLOB>`; the whitelist accepts a single
  variable *name* (`-UOLD_VAR`). It now says `-U<NAME>`.
- **Documentation drift.** `security.md` claimed CI runs
  `npm audit --audit-level=high`; CI deliberately runs plain `npm audit` (via
  `npm run audit`) so the gate matches the documented local baseline.
  `security.md` also said `vendor`/`description` accept "any single line" —
  they are capped at 128/512 characters, and now it says so. `tools.md` said
  "no validator exists" for LV2/AU/Standalone (external validators do exist;
  none is integrated here), hardcoded `plugins/` in the validate scan path
  (`pluginsDir` is configurable), and its `-G` guidance contradicted the
  tested behaviour (an explicitly passed generator *is* re-issued onto an
  existing cache; only the default is suppressed). Two stale CHANGELOG
  passages still taught the fabricated "JUCE 9 removed `start()`/`stop()`"
  story; they are corrected in place above.
- **Kept deliberately:** `NOT CHECKABLE` (no validator integrated for
  LV2/AudioUnit/Standalone) does not set `isError`. The first review wanted
  every skipped validation to fail, but there is nothing a user could install
  to change it, and the qualified policy is documented and tested. The lint
  unreadable-subtree reporting the matrix asked for had already landed in the
  2026-11-17 round.

### Release signing toolkit — 2026-11-20

- **The distribution signing path now exists and fails closed.** Two new scripts
  encode the full release sequences instead of leaving them as prose:
  `scripts/sign-release-macos.mjs` (a **Developer ID Application** identity is
  required — the ad-hoc `-` identity is refused; signing is always
  `--force --deep --options runtime --timestamp`; `xcrun notarytool submit
  --wait` whose output is gated on the literal `status: Accepted`; then `xcrun
  stapler staple` + `stapler validate`, with `--allow-unstapled` as the
  explicit, opt-in exception for unstapleable bare `.vst3`/`.component`
  bundles) and `scripts/sign-release-windows.mjs` (every PE binary found by
  MZ magic — including the inner `.vst3` — is signed
  `signtool sign /fd sha256 /tr <RFC 3161 timestamp> /td sha256` with the
  certificate from `/sha1` thumbprint, `/n` subject, `/f` PFX, or store `/a`
  auto-select with EV preferred; `signtool verify /pa /v` gates each file).
  Both validate credentials **before** invoking any signing binary and never
  fall back to an unsigned or self-signed build — there is no silent success.
- **New [Release signing & distribution](docs/release.md)** documents the
  complete macOS sequence (Developer ID → hardened runtime →
  `notarytool submit --wait` → stapling, including the honest treatment of
  unstapleable bare plugin bundles and shipping a stapled `.pkg`/`.dmg`
  instead) and the Windows Authenticode sequence (EV preferred, SHA-256,
  RFC 3161 timestamp), plus a reusable
  [`docs/examples/plugin-release.yml`](docs/examples/plugin-release.yml)
  GitHub Actions workflow for scaffolded plugin repositories (tag-triggered,
  macOS + Windows jobs, secrets documented, assets uploaded to the GitHub
  release). The published npm package is unchanged: still `index.js` +
  `templates/` only.
- **Ad-hoc signing is now labelled local-only everywhere it appears.**
  `README.md`, `docs/tools.md`, `docs/toolchain.md`, both JUCE templates'
  `INSTALL.txt` and their `package`-target comments, and the
  `clap-vst3-packaging` skill now state that `codesign --force --deep --sign -`
  is a local-testing signature that is never valid for distribution — distinct
  from the release path above. Tool references use the canonical `apc-*` names
  (the `audio_plugin_*` aliases are deprecated).
  `apc-ship` behaviour is unchanged: it remains a local
  build/validate/staging gate, not a release process.
- **Tests**: new `tests/release-sign.test.js` (26 tests) drives both scripts
  against PATH shims — refusal of the ad-hoc identity, notarization
  credentials validated before signing, the `status: Accepted` gate, stapler
  gating and the `--allow-unstapled` opt-out (macOS), and MZ-magic PE
  discovery with inner `.vst3` signing, `/fd sha256 /tr /td sha256` argv
  shape, non-PE skipping and per-file `verify /pa` gating (Windows).
  The delivery of distribution signing remains the plugin author's
  certificates and CI secrets, not apc-mcp's.

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
