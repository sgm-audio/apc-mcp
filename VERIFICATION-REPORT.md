# apc-mcp 2.0.0 — Independent Verification & Validation Report

**Date:** 2026-11-16 · **Tree:** `0ec788f` (merge of PR #35, branch `arena/d4596250-apc-mcp`) · **Package:** 2.0.0 (unreleased)
**Method:** every claim below was checked against `index.js` / `templates/` / `tests/` and, wherever the sandbox allowed, **executed** — real CMake 4.4.5, real g++, real clang-format 23, real free-audio/clap + lv2/lv2 headers cloned from upstream, real JUCE 9.0.3 cloned for static API cross-checks, and the real GitHub Actions state via `gh`. Where the sandbox blocked execution (release binaries on non-allowlisted hosts, GUI system libraries), CI evidence from run `43817093143` — whose merge commit **is this tree's base** — is cited instead and marked accordingly.

---

## 0. Executive summary

| Verdict | Count |
|---|---|
| **Verified** (evidence in code **and** reproduced live / in CI) | 74 |
| **Partial** (holds for the documented cases; one real gap found) | 2 |
| **Failed** | 0 |
| **Unverifiable in this sandbox** (environment-blocked; CI/docs evidence only) | 4 |

**One genuine defect found** (Minor, message quality — no false success): `audio_plugin_lint` **dry-run** misreports a *timeout or crash* of clang-format as `## Lint found issues / Files with problems: 0 of N / Run with fix=true to auto-format.` It never surfaces the cause and gives advice that is wrong for a hanging binary. `isError` is still `true`, so the "never report success on failure" invariant holds; the "and says why" part of the honesty claim does not. Details in §D8.

Everything else the README, `docs/tools.md`, `docs/security.md`, `docs/project-status.md` and `CHANGELOG.md` claim was either reproduced in this sandbox or is backed by enforceable code plus green CI on this exact tree. The documentation is unusually honest: it *under*-claims (e.g. "Windows is unverified", "macOS CLAP CFBundle packaging is compiled nowhere in CI" — both true in the workflow).

---

## A. Seven tools, honest failure reporting

| # | Claim | Evidence (file + logic) | Result |
|---|---|---|---|
| A1 | Seven tools registered over stdio | `index.js`: seven `registerTool(...)` blocks; `scripts/smoke-stdio.mjs` asserts "7 tools registered, all titled" — ran it: `PASS` | **Verified** |
| A2 | `isError: true` when the underlying command failed | `trySpawn()` sets `ok:false` on non-zero status / spawn error / timeout; build returns `isError: !r.ok \|\| parsed.errorCount > 0`. Reproduced live: real compile error → `## Build failed`, Errors: 2, `isError: true` | **Verified** |
| A3 | Compiler errors counted even when cmake exits 0 | `index.js` build handler: `isError: !r.ok \|\| parsed.errorCount > 0`; `tests/tool-output.test.js:409` ("reports isError when cmake exits 0 but errors were emitted") | **Verified** |
| A4 | Compiler output on **stderr** is parsed | build handler concatenates `r.output + r.stderr` before `parseBuildOutput`; live run showed both gcc errors listed (they are emitted on stderr) | **Verified** |
| A5 | Failing tests → `isError: true` with counts | `failedRun = !r.ok \|\| parsed.failed > 0`; reproduced live with a real failing ctest suite (`Passed: 0, Failed: 1, Total: 1`, `isError: true`) | **Verified** |
| A6 | ctest counts are real, not invented | `parseTestOutput()` reads the authoritative summary line first, falls back to per-test lines, else `recognized:false` → "unknown" with raw tail. Live: clean run reported `1/0/1` (the old phantom 2/1/3 bug is gone) | **Verified** |
| A7 | "No tests were found" is a failure, not `0 failed` | `index.js` test handler: exit-8 / regex branch → `## No tests were found`, `isError: true`. Reproduced live | **Verified** |
| A8 | Skipped validation never reads as clean | live: no `clap-validator` on PATH → `SKIPPED` + `isError: true` + "Validation is **incomplete**" | **Verified** |
| A9 | `NOT CHECKABLE` (LV2/AU/Standalone) does **not** fail the run | `isError: failed > 0 \|\| missing > 0`; `VALIDATOR_CONFIG_KEY` has no entry for LV2/AU/Standalone. Reproduced live with a built LV2 bundle → `NOT CHECKABLE`, `isError: false` | **Verified** |
| A10 | `format` accepts all five artefact values + `all` | schema `z.enum([...KNOWN_FORMATS, 'all'])`; live calls with `LV2`, `AudioUnit`, `Standalone`, `all` all accepted | **Verified** |
| A11 | Missing binary → actionable install hint, never "exit code null" | `trySpawn()` ENOENT branch returns `installHint(cmd)`; `binaryOnPath()` uses `fs.accessSync` (no subprocess). Live: PATH with no cmake → `'cmake' not found on PATH (needed for build/configure). Install: …` | **Verified** |
| A12 | Timeout reported as a timeout | `trySpawn()` ETIMEDOUT/SIGTERM branch. Reproduced live with a hanging cmake shim: `'cmake' timed out after 120s and was killed. Partial output may be above; …` | **Verified for build/configure** — see D8 for the lint gap |
| A13 | Handler exceptions become readable `isError` results | `registerTool()` wrapper catches and converts; live: reserved name `test` → `## audio_plugin_create failed / "test" is a reserved CMake target name…` | **Verified** |
| A14 | Tools advertise `title` + annotations; registration throws if missing | `TOOL_META` map + `registerTool()` throws without it; `smoke-stdio` verified all 7 titled | **Verified** |
| A15 | `--version` / `--help` exit cleanly; version read from package.json only | `main()` argv handling; `PKG_VERSION` reads `package.json` at startup (no second copy — `tests/release.test.js` asserts this). Live: `node index.js --version` → `2.0.0`, exit 0; `initialize` reports `serverInfo.version: "2.0.0"` | **Verified** |
| A16 | 2 MB `maxBuffer`, per-command timeouts (60–120 lint/configure/validate, 300 ctest, 600 build, 180 default) | `spawn()` sets `maxBuffer: 2*1024*1024`; timeouts match the table in every handler | **Verified** |
| A17 | Schema-level rejections are `isError` tool results | Zod rejections surface as JSON-RPC `-32602` protocol errors (SDK behaviour), **not** `isError` results. Live: `type:"ara"` → `MCP error -32602: … expected one of "clap"\|"vst3"\|"juce"\|"standalone"\|"lv2"`. Docs only promise `isError` for *handler* exceptions ("Tool handler exceptions become readable results"), which is accurate — but a model sees two different error shapes. | **Partial** (docs precise; UX nuance, not a doc contradiction) |

## B. Path containment — `assertWithinProject` (symlink-aware, no `..`)

| # | Claim | Evidence | Result |
|---|---|---|---|
| B1 | `..` segments rejected outright | lint handler: `hasDotDot(params.target)` → rejection before anything runs. Live: `target:"../victim-outside/Source"` → `Invalid target: ".." segments are not allowed` | **Verified** |
| B2 | Absolute targets outside the project rejected | live: `target:"/tmp/verify/victim-outside/Source"` → `Lint target escapes project root — rejected` | **Verified** |
| B3 | Symlinks inside the project pointing outside rejected | `assertWithinProject()` resolves nearest existing ancestor with `fs.realpathSync()` against real root. Live: symlinked dir target → `escapes project root via symlink — rejected`; clang-format never invoked | **Verified** |
| B4 | Non-existent leaf under a symlinked dir still checked (deepest-existing-ancestor walk) | the `while (!fs.existsSync(existing))` loop. Live: `pluginsDir:"plugs"` (symlink out) + `create` → `Plugin directory escapes project root via symlink`; victim dir untouched | **Verified** |
| B5 | Symlinked `status.json` refused, no external file read | `lstatSync().isSymbolicLink()` check + `assertWithinProject`. Live: symlinked status.json → `statusError: refusing to read symlinked status.json`, secret not leaked | **Verified** |
| B6 | Symlinked root `CMakeLists.txt` refused | create handler checks `lstatSync(rootCmakePath).isSymbolicLink()`; `tests/security.test.js` plants an external file and asserts it is unmodified | **Verified** |
| B7 | Guard used by lint, create (incl. root CMake guard), plugins, build, configure, test, validate | every handler resolves `buildDir`/`pluginsDir`/`target`/`statusPath` through `assertWithinProject()` | **Verified** |
| B8 | Directory walks skip symlinks entirely | `findFilesByExt()`: `entry.isSymbolicLink() → continue`. Live: whole-project lint with a symlink present linted only real files | **Verified** |
| B9 | **1.4.0 / 1.5.0 were genuinely vulnerable** (upgrade notice is truthful) | fetched real tag `v1.5.0`: lint `target` validated only against `SAFE_PATH = /^[a-zA-Z0-9_ \\/.\\-:@~]+$/` (permits `.` → `../victim` passes), and the lint handler joins + hands files to `clang-format -i` with **no** containment check; `findBinary()` ran `sh -c 'which …'` and returned `true` unconditionally. Both match the security.md/CHANGELOG description exactly | **Verified** |

## C. No shell injection

| # | Claim | Evidence | Result |
|---|---|---|---|
| C1 | `spawnSync()` with argument arrays only; no `exec`/`execSync` anywhere | grep over `index.js`: zero hits (only a comment describing the removed `sh -c`); `eslint.config.js` bans importing/using `exec`/`execSync` (`no-restricted-properties` + `no-restricted-syntax`) and `npm run lint` passes | **Verified** |
| C2 | User values become separate argv entries | `options` split on whitespace into separate args — live: `options:"-DMY_FLAG=ON -DMY_OTHER=hello"` produced two independent cache entries; metacharacter cases rejected at schema (`SAFE_TARGET`, `SAFE_GENERATOR`, `SAFE_OPTIONS`, `SAFE_REGEX`) and covered by 10 negative tests | **Verified** |
| C3 | Binary discovery without a subprocess | `binaryOnPath()` scans `PATH` with `fs.accessSync` (+ `PATHEXT` on win32) | **Verified** |
| C4 | Validator commands constrained to a bare binary name (no separators/whitespace) | `CONFIG_SCHEMA.validateCommand/clapValidatorCommand` use `SAFE_TARGET`. Live: `"/tmp/…/pluginval"` and `"evil name"` both rejected with a warning, degrading to defaults | **Verified** |
| C5 | Residual risk honestly documented (a config writer can name any PATH binary) | security.md residual-risk section matches the code exactly: separators/whitespace impossible, PATH-named binary reachable | **Verified** |
| C6 | Stdio-only, no network listener, no telemetry | `StdioServerTransport` only; no `net`/`http`/`fetch` usage in `index.js`; `openWorldHint: false` on all tools | **Verified** |

## D. Templates: configurable and buildable against real SDKs

| # | Claim | Evidence | Result |
|---|---|---|---|
| D1 | CLAP scaffold configures + builds against real free-audio/clap | **Reproduced live** (twice, incl. hostile metadata): real cmake 4.4.5 + `git clone`d clap → `Build succeeded`; artefact at `build/plugins/<Name>/<Name>_artefacts/<Config>/CLAP/<Name>.clap` (README's exact promised path) | **Verified** |
| D2 | LV2 scaffold builds a loadable bundle against real lv2 headers | **Reproduced live**: `.lv2/` bundle containing `<Name>.so` + `manifest.ttl` + `plugin.ttl`; `PREFIX ""` / `SUFFIX ".so"` pins the name `manifest.ttl` declares | **Verified** |
| D3 | JUCE / webview / standalone scaffolds build against real JUCE 9 | CI job `Scaffolded JUCE builds with real cmake` (run `43817093143`, steps "Install JUCE's Linux build dependencies" → "Clone JUCE 9" → "Build and verify every scaffolded JUCE plugin & standalone app", all `success`) on PR #35, whose merge commit `0ec788f` is this tree's base. Local full build blocked by sandbox (no ALSA/X11/freetype/pkg-config — environment, not code); the configure failure this produced was honestly reported | **Verified via CI** (local: environment-blocked) |
| D4 | JUCE CMake usage matches real JUCE 9.0.3 | static cross-check against the cloned `extras/Build/CMake/JUCEUtils.cmake`: every keyword the templates use (`VERSION PRODUCT_NAME DESCRIPTION COMPANY_* BUNDLE_ID PLUGIN_MANUFACTURER_CODE PLUGIN_CODE IS_SYNTH NEEDS_MIDI_* IS_MIDI_EFFECT EDITOR_WANTS_KEYBOARD_FOCUS NEEDS_WEB_BROWSER NEEDS_WEBVIEW2 NEEDS_CURL COPY_PLUGIN_AFTER_BUILD FORMATS`) exists in `_juce_initialise_target`; `JUCE_FORMATS` in index.js is byte-identical to `_juce_get_all_plugin_kinds` (`AU AUv3 AAX LV2 Standalone Unity VST VST3` — and `ARA` is absent, confirming the removal rationale); kind dir is `AU` (matching `ARTEFACT_LAYOUT`); `juce_add_binary_data` takes only `NAMESPACE HEADER_NAME SOURCES`; `juce_add_gui_app` / `juce_generate_juce_header` / `juce::juce_gui_extra` / `juce_recommended_*_flags` all exist | **Verified** |
| D5 | All scaffolded C/C++ compiles + links against **real** upstream headers | `APC_CLAP_INCLUDE=/tmp/sdk/clap/include APC_LV2_INCLUDE=/tmp/sdk/lv2/include npm test` → **221/221 pass, 0 skipped** (the 8 locally-skipped checks all ran for real, including `-Wall -Wextra` syntax checks and zero-unresolved-symbol links) | **Verified** |
| D6 | CLAP template uses the modern entry chain | `PluginEntry.cpp`: `clap_entry → get_factory(CLAP_PLUGIN_FACTORY_ID) → clap_plugin_factory_t → create_plugin()`, exported symbol `clap_entry`, full `clap_plugin_t` vtable, `frames_count`, `CLAP_PROCESS_CONTINUE` on 0-port calls — compiles clean against real headers; CI `audio_plugin_validate against real clap-validator` (clap-validator 0.4.1) passed on this tree | **Verified** |
| D7 | Validator invocations are the real CLIs | independently instrumented shims recorded argv: `pluginval --strictness-level 10 <artefact>` and `clap-validator validate <artefact>` — exactly as documented; failing validator (exit 1) → `FAIL` + stderr shown + `isError: true`; both CI jobs installing the **real** binaries from their releases are `success` on this tree | **Verified** |
| D8 | Lint failures reported honestly in both modes | `fix:true` → verified live: crashing clang-format → `## Lint could not apply fixes` + partial-reformat warning + stderr shown + `isError: true`. **Dry-run defect found:** a *timeout* (verified with a 90 s-sleeping shim against the 60 s batch timeout) or a *crash with unparseable output* lands in the "Lint found issues" branch, which reports `Files with problems: 0 of N` + `Run with fix=true to auto-format.` and **discards `r.stderr` entirely** — the timeout message written by `trySpawn()` never reaches the user, and "run fix=true" is the wrong advice for a hanging binary (it would hang again, in a destructive in-place mode). The build handler's `rawTail` fallback exists precisely for this case; the lint dry-run branch lacks it. `isError` is still `true`, so no false success — the claim "carries `isError: true` **and says why**" (tools.md) fails for this branch | **Partial — 1 real defect (Minor)** |
| D9 | Escaping per output grammar; non-ASCII accepted; control chars rejected | live: scaffolded CLAP with vendor `Café "ACME, Inc." \ Evil&Co <script>` and a quote/backslash-laden description → C++ literal correctly escaped (`\"`, `\\`), bundle ID sanitized (`com.CafACMEInc.EvilCoscript.EscTest`), **and the result compiles clean with `-Wall -Wextra` against real CLAP headers**; LV2 `doap:shortdesc` / `foaf:name` Turtle-escaped; single-pass `replaceTemplateVars()` prevents `{{KEY}}` cross-expansion; control-char rejection verified by SAFE_TEXT tests | **Verified** |
| D10 | LV2 URI identical across `plugin.c` / `manifest.ttl` / `plugin.ttl`; port indices/symbols match the C | `lv2Uri()` derived once; live TTL inspection + 14-test LV2 suite (index/symbol cross-check against `connect_port()`, contiguous 0..n-1, `rdfs:seeAlso` names an existing file, binary name matches CMake output) | **Verified** |
| D11 | Multi-plugin projects work; no target collisions; guarded `add_subdirectory(SDK)` | live: two plugins (CLAP + LV2) scaffolded into one root, built together successfully; `if(NOT TARGET juce::juce_audio_utils)` / `if(NOT TARGET clap)` guards in templates; literal target names (not `${PROJECT_NAME}`) | **Verified** |
| D12 | Deterministic 4-char codes; reserved names rejected | `fourCharCode()` from vendor/name; live: `name:"test"` → reserved-name rejection | **Verified** |
| D13 | `type:"ara"` removed (unbuildable scaffold) | live: schema rejects with the valid-enum list; templates contain no `FORMATS ARA` | **Verified** |
| D14 | `vst3` is a JUCE alias defaulting `FORMATS VST3`; `formats` validated at the boundary | live: unknown `BOGUS` rejected with the valid list; `formats:"VST3;AU"` accepted and emitted; `formats` rejected for `clap`/`lv2`/`standalone` with explanatory messages | **Verified** |
| D15 | Artefact discovery by suffix (FUNC-21 fixes) | `artefactsWithSuffix()` scans `*.vst3/*.clap/*.lv2`, `AU/*.component`, Standalone by platform shape (`.app` → `.exe` → executable-bit extension-less); `my_verb` → `PRODUCT_NAME "My Verb"` verified in scaffold; 13 planted-tree tests; CI builds verified artefacts on disk | **Verified** |
| D16 | `create` registers `add_subdirectory` once, creates root CMakeLists if missing | live: fresh project → `Created CMakeLists.txt with add_subdirectory(plugins/MyGain)`; second plugin appended once; already-wired detection in code (`alreadyWired` regex over uncommented lines) | **Verified** |
| D17 | WebView bridge contract (`window.updateState(...)`, `apc://callback?action=…&data=…`) | `WebViewEditor.cpp:135` pushes via `evaluateJavascript("window.updateState (…)")`; `:140` intercepts `apc://callback`; `app.js` calls back with `encodeURIComponent`; `Options{}.withResourceProvider()` + `goToURL(getResourceProviderRoot())` — the JUCE-9 pattern the changelog describes | **Verified** |

## E. 2.0.0 closed SEC-01, SEC-02, SEC-03

| # | Claim | Evidence | Result |
|---|---|---|---|
| E1 | **SEC-01** (lint traversal) closed | v1.5.0 tag source proves the hole (B9); 2.0.0 rejects every PoC live (B1–B4) | **Verified** |
| E2 | **SEC-03** (per-key config validation) closed | `CONFIG_SCHEMA` validates each key; live: absolute-path and whitespace validator commands rejected with a per-key warning and default fallback; malformed JSON → defaults; non-array `validateFormats` no longer crashes; `buildDir`/`pluginsDir` must be relative & `..`-free (negative tests + escaping-pluginsDir test) | **Verified** |
| E3 | **SEC-02** (dependency advisories) closed | `npm audit` → `found 0 vulnerabilities` (no `--audit-level`, no `overrides`); SDK at `^1.32.2`; CI runs the same plain gate (`npm run audit`) — verified in the workflow and the green CI run | **Verified** |
| E4 | Audit-history table (1.2.0 CodeQL/Dependabot, 1.5.0/1.4.0 vulnerable) | `.github/workflows/codeql.yml`, `dependabot.yml` exist; v1.5.0 vulnerability proven (B9) | **Verified** |

## F. Project-root detection, config precedence, artefact paths

| # | Claim | Evidence | Result |
|---|---|---|---|
| F1 | Walk-up from CWD, max 20 levels, markers `apc-mcp.json` or `CMakeLists.txt` | `findProjectRoot()` (`for (let i = 0; i < 20; i++)`); live: called with no `projectPath` from 2–3 directories deep → root correctly found, build succeeded | **Verified** |
| F2 | Root must exist, be a directory, carry a marker; no side-effect mkdir | `assertProjectRoot()`; security tests assert no directory is created for bogus paths. (Note: running from *inside* `plugins/<Name>` picks the plugin dir itself as root — its `CMakeLists.txt` is a marker. This matches the documented first-marker-wins algorithm; it is a documented-behaviour gotcha, not a defect.) | **Verified** |
| F3 | Precedence: tool arg → `apc-mcp.json` → default | live: `{config:"Release"}` in config + no arg → built Release (`CMAKE_BUILD_TYPE:STRING=Release`); explicit `config:"Debug"` → overrode to Debug | **Verified** |
| F4 | Single-config caches reconfigure on Debug↔Release; multi-config gets `--config` | `buildNeedsConfigure()` reads `CMAKE_CONFIGURATION_TYPES` / `CMAKE_BUILD_TYPE` from the cache; live: Release→Debug switch reconfigured the cache and both artefact dirs coexist | **Verified** |
| F5 | `-G` only issued on a fresh cache | live: configure #1 `Unix Makefiles`, configure #2 `generator:"Ninja"` on the existing cache → no generator-mismatch error, build still succeeds (Ninja deliberately not passed) | **Verified** |
| F6 | Auto-configure when cache missing | live: first-ever `audio_plugin_build` on a fresh project configured then built | **Verified** |
| F7 | `buildDir`/`pluginsDir` from config honoured (validate no longer hardcodes `build/plugins`) | `findPluginBinaries(config, buildDir, formats, cfg.pluginsDir)`; live with custom `pluginsDir:"plugs"` (in the containment test) and planted trees | **Verified** |
| F8 | README artefact path promise | live: `build/plugins/MyGain/MyGain_artefacts/Release/CLAP/MyGain.clap` exists after `create` + `build(config="Release")` | **Verified** |
| F9 | `validate` `config` must match the build | live: validating a Release build with default Debug → `No plugin binaries found` + `isError: true` (honest; docs say "must match the build you ran") | **Verified** |
| F10 | Missing-SDK configure failures are readable and actionable | live: JUCE plugin without JUCE → template's `FATAL_ERROR` surfaced verbatim with the `-DJUCE_DIR` remedy; LV2 equivalent likewise | **Verified** |
| F11 | Unparseable build failures surface raw output | `rawTail` in the build handler; live: half-configured tree → `### Output` with gmake's actual error; documented recovery (explicit `configure`) verified to work | **Verified** |

## G. `docs/project-status.md` verification baseline (dated 2026-11-16, Node v22.22.3 — this sandbox exactly)

| # | Claim | Reproduction | Result |
|---|---|---|---|
| G1 | `npm run lint` PASS | ran: exit 0 (ESLint + `node --check`) | **Verified** |
| G2 | `npm test`: 221 tests, 213 pass, 0 fail, 8 skipped; skips are the CLAP/LV2 header checks | ran: exactly `# tests 221 / pass 213 / fail 0 / skipped 8`; the 8 skips are precisely the `APC_CLAP_INCLUDE`/`APC_LV2_INCLUDE`-gated cases; with the env vars set: **221/221, 0 skipped** | **Verified** |
| G3 | `npm run smoke` PASS 10/10 | ran: `smoke-scaffold: PASS (10/10 scaffolded, 0 failures)`; with `--build` + real SDKs: CLAP and LV2 families configure/build/verify artefacts for real | **Verified** |
| G4 | `npm audit` 0 vulnerabilities, no threshold flag; CI runs the same command | ran: `found 0 vulnerabilities`; workflow step is `npm run audit` | **Verified** |
| G5 | `npm run licenses` — 163 packages | ran: `License gate — 163 packages from package-lock.json`, all allowed | **Verified** |
| G6 | `npm run check` exit 0 | all components ran green individually (lint, test, smoke, audit, licenses, docs:check) | **Verified** |
| G7 | CI run `43817093143` (PR #35): 11/11 verification jobs green; `publish` skipped | `gh run view 43817093143`: `success`; 11 jobs `success` (4× test matrix, License, compile-scaffold, scaffold-clap/lv2/juce, 2× validate-with-real-binaries) + `publish` `skipped`; PR #35 merge commit = `0ec788f` = this tree's base; action pins are 40-hex SHAs; no `continue-on-error` in the workflow | **Verified** |
| G8 | Latest tag `v1.5.0`; `@sgm-audio/apc-mcp` 404 on npm | `git ls-remote --tags origin` → newest is `v1.5.0`; `registry.npmjs.org/@sgm-audio%2Fapc-mcp` → `{"error":"Not found"}` | **Verified** |
| G9 | Honest limitations (Windows unverified; macOS CLAP CFBundle not CI-compiled; ARA absent) | workflow has no Windows runner and no macOS scaffold job; `ara` absent from the enum — the docs describe exactly what the workflow contains | **Verified** (as *statements about gaps*) |
| G10 | Two direct runtime deps; lockfile 163 packages | `package.json` deps: `@modelcontextprotocol/sdk`, `zod` only; lockfile count 163 | **Verified** |
| G11 | `files: ["index.js","templates/"]`, `engines.node >= 22`, Node badge 22+ | `package.json` as claimed | **Verified** |
| G12 | `npm run ship` refuses non-main branch / dirty tree / existing tag / wrong changelog heading | `node scripts/ship.mjs --dry-run` on this branch: refused with the specific reason ("you are on arena/…, not main"); 19 release tests cover the other guards | **Verified** |

## U. Unverifiable in this sandbox (environment-blocked)

| # | Claim | Blocker | Best available evidence |
|---|---|---|---|
| U1 | `npx -y github:sgm-audio/apc-mcp --version` install path (README quick start) | npm's codeload.github.com tarball fetch fails TLS verification in this sandbox (proxied environment) | `--version` works from a checkout; `bin`/`files` fields are standard; nothing repo-side can be at fault — but the *published install command itself* was not executed end-to-end here |
| U2 | Real `pluginval 1.0.4` / `clap-validator 0.4.1` runs **locally** | release assets redirect to `release-assets.githubusercontent.com` (blocked host) | CI jobs on this exact tree installed both from their releases, built real plugins, and the "Validate it with the real …" steps are `success`; `scripts/smoke-validate.mjs` provably exits non-zero on missing deps and requires a `PASS` (code-verified) |
| U3 | macOS / Windows behaviour (CFBundle packaging, PATHEXT resolution, VS generator default) | no macOS/Windows in sandbox | macOS covered by the 2×2 CI test matrix (green); Windows honestly documented as unverified — consistent with the workflow |
| U4 | Raw CI log text (the `PASS` lines inside the validate jobs) | logs are served from `actions-results…blob.core.windows.net` (blocked host) | job- and step-level conclusions via the GitHub API (all `success`), plus the scripts the steps run |

---

## Findings summary

1. **DEF-1 (Minor, the only code defect found): lint dry-run misdiagnoses timeout/crash.**
   `index.js`, `audio_plugin_lint`, the `if (!r.ok)` dry-run branch: when clang-format fails *without* parseable per-file diagnostics (timeout — reproduced with a 90 s shim against the 60 s batch timeout — or a crash whose stderr names no file), the tool reports `## Lint found issues / Files with problems: 0 of N` and `Run with fix=true to auto-format.`, discarding `r.stderr` where `trySpawn()` placed the timeout message. `isError` is `true` (the core invariant holds), but tools.md's "carries `isError: true` **and says why**" and security.md layer 5's blanket "a timeout is reported as a timeout" are not met for this one branch. The `fix:true` branch handles the same failure correctly ("Lint could not apply fixes" + stderr). Suggested fix: mirror the build handler's `rawTail` fallback when `badFiles.length === 0`.

2. **Observation (not a defect):** zod schema rejections arrive as JSON-RPC `-32602` protocol errors rather than `isError` tool results (standard MCP SDK behaviour; docs only promise `isError` for handler exceptions). A model still receives an actionable message.

3. **Observation (not a defect):** the CLAP descriptor `url` becomes a semantically odd URL for exotic vendors (`https://Café "ACME, Inc." \ Evil&Co <script>.com/…`). It is safely escaped for the C++ literal (no breakout; verified by compiling) and the plugin *id* uses the sanitized bundle vendor — cosmetic only.

4. **Observation (documented behaviour, mild gotcha):** project-root walk-up finds the *first* marker, so running the server from inside `plugins/<Name>` treats the plugin directory as the root. Matches the documented algorithm; `projectPath` or starting at the true root avoids it.

## Validation verdict (developer-fitness)

For a JUCE/CLAP/LV2 plugin developer, the tool genuinely delivers: the README quick start was executed verbatim (`create` → `build` → `validate`) and produced a real, loadable-shape CLAP binary at the promised path; scaffolds carry correct, current-API CMake (cross-checked against JUCE 9.0.3 and real CLAP/LV2 headers, with the historically hallucinated APIs — `juce_add_webview_ui`, `loadHTMLString`, `CLAP::clap`, pre-1.0 entry layout — all absent); the generated CLAP passes the real clap-validator and the generated VST3 passes real pluginval at strictness 10 in CI on this tree; error paths produce actionable, honest reports in every flow I could run. The main fitness gaps are the ones the docs already declare: no LV2/AU validator integration (with pointers to lv2lint/sord_validate), no host-load test, Windows unverified.
