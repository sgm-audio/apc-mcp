# Verification and validation matrix — apc-mcp 2.0.0

**Reviewed:** 2026-11-16, commit `ffdfad04ad9a64c34a1192eb5949aaa21e043f8c` (the base of this review branch). This is a review, not a remediation. Paths and line references refer to that commit. Claims are grouped where multiple documents repeat the same behavior; historical changelog entries are treated as dated history, not as promises about the current tree.

**Verdicts:** **Verified** = supported by implementation and/or a targeted observed test, within the stated scope; **Partial** = implemented for some cases but broader coverage or proof is missing; **Failed** = an observed counterexample or direct contradiction; **Unverifiable** = only asserted in prose, historical state was not independently established, or the necessary platform/host test was not performed. A green mock test is not evidence of real SDK/host compatibility. None of these results establishes absolute security.

## Executive findings (prioritized)

1. **High — containment is not a sandbox.** `docs/security.md:47` promises no arbitrary outside reads/writes. A real configure call with `options=-DCMAKE_PROJECT_INCLUDE=/tmp/.../outside/payload.cmake` executed an outside CMake script that wrote a marker outside the project. This is ordinary CMake capability, not shell-string injection. Even without that option, untrusted project CMake/build/test scripts and validators can execute code. Trust projects and toolchains; do not use this server as an isolation boundary. There is a separate direct artefact-symlink escape below. See F1.
2. **High — skipped CTest tests are reported as passed.** A real CTest test with `SKIP_RETURN_CODE` produced `***Skipped` and a zero exit; `audio_plugin_test` returned `isError: false` and `## Tests passed`. This contradicts `docs/tools.md:5` and the requested acceptance criterion. See F2.
3. **High — some compiler errors are missed on exit zero.** A synthetic `cmake` shim emitted `/tmp/My Project/File.cpp:1:2: error: synthetic diagnostic` on stderr and exited 0; the build returned `Build succeeded`, 0 errors. The parser's `\S+` path pattern excludes spaces. Normal nonzero compiler failures are still caught. See F3.
4. **Medium — validator discovery follows nested outside symlinks.** `findPluginBinaries()` checks only the build root, then follows e.g. `.../Debug/CLAP -> outside`; a probe passed an outside `.clap` to the validator and reported PASS from a test shim. This is not proof that a real validator accepts that file; it proves an outside path can be supplied to it. Config JSON is also read through a symlink. See F1.
5. **Medium — config parsing is not fully forward-compatible.** `apc-mcp.json` containing `{"constructor":"future-key"}` made `audio_plugin_plugins` fail with `validator.safeParse is not a function`; inherited object keys are mistaken for schemas. See F4.
6. **Medium — WebView's “Level” is not an audio meter.** The UI shows gain as level; C++ sends no `level` measurement. It is misleading for a developer using the template as a working meter. See F5.
7. **Medium — configure flag `..` filtering is incomplete.** Real CMake accepted `-DTEST=../outside` through the server, although the guard and regression-test name say traversal segments are blocked. `hasDotDot` is applied to the entire `-DNAME=value` token, so the first value segment is `-DTEST=..`, not `..`. See F6.

## Scope and evidence obtained

- Read all requested sources: `README.md`, `docs/tools.md`, `docs/security.md`, `docs/project-status.md`, and all of `CHANGELOG.md`; traced the seven handlers and helpers in `index.js`, the five template families, test fixtures and scripts. Matrix rows consolidate repeated claims and split materially different assertions.
- `npm ci && npm run check`: **pass**; Node v22.22.3; **230 tests, 222 pass, 8 skipped** because CLAP/LV2 include variables were unset; structural smoke 10/10; audit 0 vulnerabilities; license and docs checks passed. The separate run `APC_CLAP_INCLUDE=/tmp/apc-clap/include APC_LV2_INCLUDE=/tmp/apc-lv2/include npm test`: **230 pass, 0 skipped**. JUCE in these source-compile tests is a stub (`tests/fixtures/juce-api-stub`), not JUCE itself.
- Cloned upstream CLAP and LV2 into `/tmp`, used real CMake 4.4.5 and a Linux C/C++ compiler, and drove the actual MCP stdio server: created one native CLAP and one native LV2, configured and built both together, and discovered the LV2 bundle. Default `audio_plugin_test` correctly failed on no tests; a real skipped CTest case reproduced F2. No real `clang-format`, pluginval, or clap-validator was available locally. The validator symlink test used a shim and is explicitly labeled as such.
- Created JUCE generic VST3, JUCE WebView VST3, and standalone with upstream JUCE 9.0.5; configure failed honestly because this environment lacks `pkg-config`/JUCE system dependencies. No local JUCE compile or plugin-host run was established.
- GitHub run [43817093143](https://github.com/sgm-audio/apc-mcp/actions/runs/43817093143) is green for its 11 verification jobs at head `a22208fc…` (not the reviewed commit). `gh pr view 36` also reported green CLAP/LV2/JUCE build, real validator, Linux/macOS tests and CodeQL checks for PR #36 whose merge commit is the reviewed base; these CI results support tested cases but are not universal host/platform certification. `publish` was skipped. GitHub releases show latest tag `v1.5.0`; the npm registry returned 404 for this package at review time.
- Temporary SDK clones and probes were outside the repository. No product code was modified. No live DAW, Windows, real macOS CLAP packaging, real local validators, audio-quality, or long-running stress test was performed.

## Claim → evidence → result

### Server, project resolution and configuration

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| Seven configure/build/test/lint/plugins/validate/create tools; stdio MCP (`README:15`, `tools:3–15`, `status:8`, `CHANGELOG:670–675`) | Seven `registerTool` calls `index.js:905–1605`, titles/annotations `833–885`, `StdioServerTransport` `1623–24`; `tests/server.test.js` and stdio smoke. | **Verified** |
| Server wraps installed tools, does not ship/download SDKs or compilers (`README:17,38`) | `package.json:files`, `index.js:161–237`; templates discover local dependencies. Child CMake builds can themselves download or execute arbitrary project code, so the claim applies to apc-mcp's own implementation, not its subprocesses. | **Verified** (own implementation) |
| Optional `projectPath`; climb from CWD at most 20 levels to nearest marker; explicit root must exist and contain marker (`tools:3`, `CHANGELOG:109–112`) | `index.js:365–412`; `tests/server.test.js` project resolution; `tests/security.test.js:217–240`. | **Verified** |
| Caller config overrides project config, then `Debug`; default POSIX generator Unix Makefiles, Windows CMake default (`tools:27–32,44–49,60–64`, `CHANGELOG:196–201`) | `index.js:289–297,917–922,990–995,1038–1042,1300–1304`; `tests/tool-output.test.js:128–215`. Windows behavior not executed. | **Partial** |
| Project config per-key validation, invalid values use defaults and unknown keys are ignored (`security:9,34`, `CHANGELOG:38–43`) | `index.js:315–361`; ordinary bad values and unknown keys tested `tests/security.test.js:285–323`. F4 is a counterexample for inherited names. | **Failed** (universal claim) |
| CLI `--version`/`--help` exit; version comes from package.json (`CHANGELOG:19,91–99,245–250`) | `index.js:27–35,1608–1625`; `tests/server.test.js` and `tests/release.test.js`. | **Verified** |
| 2.0.0 is unreleased; Node >=22; two direct runtime dependencies (`README:34,38,74`, `status:7–8`, `CHANGELOG:9–24`) | `package.json`, observed GitHub releases and npm 404. Publication state is time-sensitive. | **Verified** at review time |
| `any CMake-based C/C++ project` works (`tools:17`) | Configure/build/test are wrappers, but layout and config assumptions exist, configure options are split on whitespace and restricted (`index.js:995–1020`); `validate` only scans prescribed artefact layout. No evidence for every CMake project. | **Partial** |
| Only the default generator is omitted on existing cache (`CHANGELOG:661–665`, `tools:34` says only pass `-G` on a fresh cache) | `index.js:995–1005`: an explicitly supplied generator is passed even if cache exists; test `tests/tool-output.test.js:582` requires that. | **Failed** as written; default suppression works |

### Configure → build → lint → test

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| Configure calls CMake with selected config, generator and discrete option argv; error on failure (`tools:19–34`) | `index.js:978–1025`; real CLAP/LV2 configure succeeded; real JUCE configure with missing pkg-config returned `isError: true`. | **Verified** for exercised cases |
| Arbitrary `-DNAME=VALUE`/paths and common CMake workflows can be configured (`tools:24,32`) | `SAFE_OPTIONS` and token allowlist `index.js:45–47,987–1020`: no quoting or whitespace in values, no arbitrary CMake switches, `-U` glob not supported despite the error saying `<GLOB>`. | **Partial** |
| Build auto-configures, uses `--config`, `--parallel`, optional target/clean, and reconfigures changed single-config caches (`tools:36–51`, `CHANGELOG:91–99`) | `index.js:889–901,905–950`; tests `tests/tool-output.test.js:128–215,504–531`; real combined CLAP/LV2 build succeeded. | **Verified** for exercised generators |
| Build returns count and first 20 errors/warnings and treats any compiler error as failure (`tools:5,51`, `security:38`, `CHANGELOG:213–226`) | `index.js:434–486,950–973`; common GCC/MSVC/CMake patterns tested. F3 demonstrates a diagnostic with a space in its path silently missed on exit 0; parsers cannot identify every compiler's format. | **Failed** (universal claim); nonzero exits covered |
| Failed subprocesses, missing binaries, timeout, output limit, signals are not successful (`tools:5`, `CHANGELOG:100–116`) | `trySpawn` `index.js:230–283`; handlers consult `r.ok`; `tests/security.test.js:185–215`, `tests/tool-output.test.js:219–231,389–423,425–476`; real no-tests/configure-fail probes. No exhaustive simulation of every OS error or every external command. | **Partial**; sampled failed underlying commands were not reported successful |
| lint defaults dry-run; `fix` writes; files/dirs, C/C++ extensions, batches, skip build/_tools/node_modules/CMakeFiles/_deps (`tools:68–82`, `CHANGELOG:91–99`) | `index.js:532–552,1089–1220`; `tests/tool-output.test.js:478–581`. Walk intentionally skips symlinks and dot entries; `readdirSync` errors silently return at `538`, so an unreadable subtree can be missed. No local real clang-format executable. | **Partial** |
| lint tool failures return `isError`, with useful explanation (`tools:5`, `CHANGELOG:202–205`) | `index.js:1161–1215` reports failed batches. For dry-run, a non-formatting execution error is reduced to “Lint found issues … Run with fix=true”; underlying stderr may be omitted. | **Partial** |
| Test selected configuration and regex, report counts, no-tests failure (`tools:53–66`, `CHANGELOG:206–212,666–669`) | `index.js:500–529,1027–1085`; real no-tests path returned `isError: true`. Tests cover summaries, failure/timeout and unrecognized output. F2 demonstrates skipped tests. | **Partial** |
| Every skipped build/test step is `isError: true` (`tools:5`) | F2: real `ctest` skipped case, zero exit → `isError: false`, `Tests passed`. `parseTestOutput` `index.js:503–529` has no skipped case and success depends on `r.ok || parsed.failed`. | **Failed** |
| Output caps 2 MB and command-specific timeouts (`security:36`) | `index.js:230–235` uses **16 MB**, not 2 MB; timeouts at individual handlers, `trySpawn` distinguishes ENOBUFS and timeout. `CHANGELOG:711` is a dated 1.4.0 historical value, not current. | **Failed** for current 2 MB claim; timeouts **Verified** in code |

### Discovery and validation

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| List plugin subdirectories with CMakeLists, JSON/text, metadata; reject symlink status (`tools:84–91`) | `index.js:1225–1286`, `tests/server.test.js`, `tests/security.test.js:355–373`. Invalid status produces warning while overall result stays non-error. If pluginsDir is absent `format=json` returns prose rather than JSON. | **Partial** |
| VST3/CLAP validators use correct commands; configured missing validators and validator failures return error (`tools:109–120`, `CHANGELOG:74–80,227–238`) | `index.js:1306–1409`; shim tests `tests/tool-output.test.js:425–476`; green real-validator PR #36 CI checks. No local real validators. | **Verified** for tested CI cases, not all hosts/plugins |
| LV2/AU/Standalone not validated, reported NOT CHECKABLE, no `isError` (`tools:113–125`, `status:44`) | `index.js:1306–1409`; real LV2 build/discovery probe got `0 passed, 0 failed, 1 not checkable` and `isError: false`. This **contradicts the user's requested rule that skipped validation be an error** even though it matches the more qualified documented policy. Code also says “binary was found and is fine” without checking it. | **Failed** against requested acceptance criterion; **Verified** for documented return flag; “is fine” is an overclaim |
| “No validator exists” for LV2/AU/Standalone (`tools:113,121,123`, `status:44`) | Only no integration exists in this server (`index.js:308`); `tools:123` itself names external LV2 tools. | **Failed** as a claim about the wider ecosystem; correct wording is “no validator integrated here” |
| Format `all` uses configured list; explicit all five formats accepted (`tools:101–125`, `CHANGELOG:637–643`) | `index.js:299–308,1297–1306`, discovery `627–652`, tests `tests/artefacts.test.js`. If one requested format is absent but another yields a pass, no missing-format result is emitted. | **Partial** — absence does not prove an artefact should exist, but coverage is not made explicit |
| Artefacts found under configured buildDir/pluginsDir, suffix-scanned not guessed; AU maps to `AU`, standalone shapes, LV2 bundle (`tools:107`, `CHANGELOG:282–315`) | `index.js:578–652`, `tests/artefacts.test.js`; real LV2 discovery. `tools:107` hardcodes `/plugins/`, omitting custom `pluginsDir`; arbitrary external CMake output layouts are not discovered. | **Partial** |
| README's `MyGain` CLAP Release output path (`README:40–56`) | `templates/clap/CMakeLists.txt` `CLAP_ARTEFACTS_DIR`; real CLAP build demonstrated Debug analogue. Release exact example not run here; see CI build cases. | **Partial** |
| Only attempted validation is called PASS, missing validator never lost (`tools:115–123`) | Status classification `index.js:1344–1409`; check missing validators per found binary. A zero-exit validator shim yields PASS even for invalid content, as expected for a wrapper; correctness depends on validator. | **Verified** for discovered artefacts, subject to F1 and the misleading NOT CHECKABLE wording |

### Security and trust boundaries

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| SEC-01: direct lint `..`, outside absolute paths, symlink escapes blocked (`security:11–15,33`, `CHANGELOG:30–37,54–58`) | `index.js:103–157,1104–1126`; `tests/security.test.js:55–120,242–271,399–425` cover literal, absolute, symlink and dangling links. This is not a filesystem sandbox and checks can race concurrent symlink replacement. | **Verified** for tested direct lint cases; broader guarantee **Failed** (F1) |
| SEC-02: known dependency advisories resolved (`security:53`, `CHANGELOG:47–70,617–623`) | `npm ci`, plain `npm audit`: 0 vulnerabilities at review time; lockfile and `package.json` define the dependency tree. This is a dated advisory result, not proof of zero vulnerabilities in all code. | **Verified** at review time |
| SEC-03: config per-key validation prevents malformed types/traversing buildDir and pluginsDir (`security:34,53`) | `index.js:315–361`; `tests/security.test.js:133–158,285–323`; F4 shows unknown-key exception; config symlink and the CMake subprocess boundary remain outside this guard. | **Partial** |
| No shell-string interpolation by server (`security:32,35,37`, `CHANGELOG:44–46,705,709`) | `spawnSync` argv arrays with no shell `index.js:230–237`; PATH scanning `178–195`; ESLint policies. Does **not** prevent child CMake/build/test scripts from invoking a shell or running arbitrary programs; configured validator names are another stated exception. | **Verified** for direct server invocation only; “all shell injection”/arbitrary execution protection is **Failed** as a system-wide guarantee |
| All paths traversed/read/written remain in project (`security:33,47`) | `assertWithinProject` `index.js:124–157` protects paths where actually called; `loadProjectConfig` `333–340` reads unguarded symlink; `findPluginBinaries` `627–652` follows nested symlinks; external CMake/ctest/validators are not sandboxed. F1 proves both external CMake write and validator path escape. | **Failed** |
| `..` in configure options rejected (`index.js:1007–1017`, `tests/security.test.js:427` describes this) | F6: `-DTEST=../outside` succeeded with real CMake; whole token is split rather than extracting value. Absolute `-D` paths are allowed by design. | **Failed** |
| Path checks are race-proof and protect against malicious concurrent local writers | `realpath` check and subsequent file I/O occur separately, `index.js:124–157,1525–1578`. No directory-fd/no-follow or OS sandbox enforcement. | **Unverifiable** as an absolute guarantee; there is a check/use race in the design |
| Vendor/description context escaping, allowed non-control Unicode, single-pass template substitution (`tools:143–146`, `security:31`, `CHANGELOG:59–64,652–660`) | `index.js:80,655–660,736–765,1500–1523`; `tests/templates.test.js:930–1031`. Tests establish examples, not all Unicode/CMake generator-expression combinations or target-platform toolchains. | **Partial** |
| Zero network listener/telemetry in server (`security:5`) | stdio transport `index.js:1623–24` and direct server code; downstream build scripts/validators can use network; all seven `openWorldHint:false` at `index.js:832–860` does not constrain those children. | **Verified** for server itself; **Failed** if interpreted to include invoked toolchains |
| Changelog's old 1.4/1.5 vulnerabilities and historical remediation are factual | `docs/archive/AUDIT.md` and old changelog entries are assertions; current tests establish current behavior, not all historical behavior. Did not execute historic releases or reproduce the old exploit. | **Unverifiable** as independent historical fact |

### Scaffold and developer validation

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| Five template families; create supports CLAP, JUCE/VST3 generic/WebView, native LV2 and standalone; `ara` removed (`tools:127–170`, `status:37,43`, `CHANGELOG:20–25,373–420,473–477`) | Type/UI mapping `index.js:663–713,1415–1495`; `templates/`; 10-case structural smoke; `tests/templates.test.js`; PR #36 green SDK build jobs. | **Verified** for scaffold selection/creation |
| Scaffolded CMake registers project, creates root when needed, detects SDKs, supports multiple plugins (`tools:149–170`, `CHANGELOG:126–153,161–175`) | `index.js:1538–1578`; template SDK checks and `if(NOT TARGET ...)`; local two-plugin CLAP+LV2 CMake build succeeded; CI builds sample JUCE templates. Arbitrary CMake parent structures/SDK installations not all covered. | **Partial** |
| All templates are configurable/buildable against real JUCE/CLAP/LV2 (`status:37`, `CHANGELOG:118–188`) | Local native CLAP/LV2 build succeeded using upstream SDKs; reviewed PR #36 has green real CMake build checks including JUCE; local JUCE configure failed honestly for missing pkg-config. CI uses particular SDK versions/platforms and configurations, not every host or format. | **Partial** |
| CLAP stereo audio ports, correct entry/factory and Linux/Windows `.clap` / macOS CFBundle (`tools:153`, `CHANGELOG:81–85,161–175`) | `templates/clap/Source/PluginEntry.cpp`, `PluginProcessor.cpp:10–53,130–183`, `templates/clap/CMakeLists.txt`; Linux real build and PR real clap-validator CI. Windows and macOS packaging not verified here; status itself flags them. | **Partial** |
| CLAP scaffold is a host-configurable gain plugin | `templates/clap/Source/PluginProcessor.h:55–58` has `m_gain=1`; `PluginProcessor.cpp:175–180` exposes only audio ports, no params/state extension, UI, or events handling. A valid passthrough skeleton is not a host-automatable gain plugin. | **Failed** if “configurable” means a developer/host can adjust gain; **Partial** as a compile-time code-editable skeleton |
| Native LV2 is C11, gain control, stereo I/O, coherent TTL and bundle/installation (`tools:156`, `CHANGELOG:272–280,375–398`) | `templates/lv2/Source/plugin.c`, `plugin.ttl`, `manifest.ttl`, `templates/lv2/CMakeLists.txt`; real Linux configure/build and bundle discovery. No independent LV2 validator or DAW load here. | **Partial** |
| JUCE generic, WebView UI, standalone use JUCE APIs; gain state/gesture bridge (`CHANGELOG:126–188,399–420,693–696`) | `templates/juce*/CMakeLists.txt`, `templates/juce-webview/Source/WebViewEditor.cpp:108–169`, `UI/app.js`, `templates/standalone/Source`; compile stubs and real JUCE CI build. No WebView interaction, automation, UI lifecycle, audio-device, host state restore or DAW run in this review. | **Partial** |
| WebView “Level”/meter reflects audio (`CHANGELOG:696` describes meter visualization; UI label) | F5: HTML labels it “Level”; `UI/app.js:19–32,49–52` uses gain as fallback; `WebViewEditor.cpp:123–131` sends gain but no level. | **Failed** as an audio-level meter; visual bar exists |
| Metadata identity is stable and distinct (`CHANGELOG:154–160`, `tools:143`) | `fourCharCode` `index.js:780–808` deterministic; fixed four-character space is finite and hashes collide; sanitized identifiers/URNs may collide too. Tests cover selected distinct examples only. | **Partial** — deterministic, not guaranteed unique; users must choose stable globally unique IDs before release |
| JUCE format validation prevents invalid format names (`tools:147–155`, `CHANGELOG:158–160`) | `index.js:811,1467–1495`; supported list validated; actual build depends on OS and external SDKs. For native CLAP `formats="CLAP"` is accepted even though `tools:147` says formats rejected for CLAP. | **Partial**; documentation mismatch |
| Default UI ignored outside JUCE; name patterns/reserved identifiers and formats constraints (`tools:137–147`) | `index.js:49–74,663–713,1415–1495`; tests cover rejected CMake/C++ keywords. `formats` CLAP exception above; vendor/description length limited to 128/512 despite “any single line.” | **Partial** |
| `ARA` not implemented (`status:43`, `CHANGELOG:468–477`) | `index.js:1422` excludes ARA; tests `tests/security.test.js:325–352`. | **Verified** |
| A developer can use a generated plugin in a DAW on every supported platform; real-time audio behavior and correctness | No host-load, latency, automation, restoration, accessibility, sample-accurate events, installation or performance test here. `status:45–47` explicitly disclaims host testing and Windows/macOS CLAP verification. | **Unverifiable** |

### CI, QA, releases and historical changelog

| Claim (source) | Evidence (file + logic) | Result |
|---|---|---|
| CI builds/tests and validators, Linux/macOS Node matrix, license gate, docs/ESLint/CodeQL (`status:20–32,39`, `CHANGELOG:316–371,422–465,624–636,683–688`) | `.github/workflows/publish.yml`, `.github/workflows/codeql.yml`; GitHub run and PR #36 checks observed green. CI tests specific revisions, SDKs and environments only. | **Verified** for observed runs |
| `security:76` CI runs `npm audit --audit-level=high` | `.github/workflows/publish.yml:43–47` runs `npm run audit`, which runs plain `npm audit`; `status:27` and `CHANGELOG:617–623` say this correctly. | **Failed** (stale documentation) |
| `npm run check` always compiles/links real SDKs and runs real validators | `package.json:scripts`; default check uses test + structural smoke; 8 SDK source tests skip without environment, JUCE sources use a stub, validators are separate CI jobs. No such guarantee is established by a passing local check. | **Failed** if inferred; status correctly qualifies it |
| npm packaging excludes tests/scripts/docs (`security:68`) | `package.json:files` limits files to index and templates; npm always includes certain standard files such as README and LICENSE, so blanket “docs do not ship” is too broad. | **Partial** |
| Release guards, version single-source, immutable action pins and publish gated on tests (`status:39`, `CHANGELOG:239–270,456–465`) | `scripts/ship.mjs`, `package.json`, `.github/workflows/publish.yml`, `tests/release.test.js`; no real release or publishing was performed. | **Partial** |
| Test counts and dated results recorded during 2.0.0 work (`status:20–32`, `CHANGELOG:487–596`) | These are dated snapshots, not present test totals. Current observed totals are 230, not the older 221/163/147/etc.; no attempt was made to reconstruct every historical intermediate state. | **Unverifiable** as independent historical measurements; current results above |
| Historical 1.5 WebView, 1.4 security, 1.3 discovery, 1.2 CI, 1.1 tools/config and 1.0 initial tools (`CHANGELOG:690–774`) | Some current descendants are verified in prior rows; version-specific claims require checking and executing each historic revision. Later removals/refactors mean old `find | xargs`, Node matrix, maxBuffer and schema descriptions must not be read as current promises. | **Unverifiable** for historical execution |
| JUCE formerly removed `start()`/`stop()` (`CHANGELOG:406–410`) | Same changelog `677–682` says the history was fabricated; present standalone comments no longer make that claim. | **Failed** as factual JUCE history; contradictory historical text should be corrected |
| CI/Node Windows support, macOS CLAP packaging, real DAW loading (`status:45–48`) | CI only Linux/macOS server tests, scaffold build Linux; no Windows or real DAW in this review. These are appropriately documented limitations, not proofs that support works. | **Unverifiable** for working behavior |

## Reproduction details and implications

### F1 — unsafe trust-boundary claims

1. Put a benign CMake script outside the project containing `file(WRITE "/tmp/<outside>/marker" "wrote outside")`. Make an otherwise normal project containing `project(Probe LANGUAGES C)`.
2. Call `audio_plugin_configure` with `options: "-DCMAKE_PROJECT_INCLUDE=/tmp/<outside>/payload.cmake"`. In this review the call succeeded and the outside marker was created. This requires that the script exists and can be read; an attacker controlling only a tool argument cannot necessarily create it. However, no shell is required: `CMAKE_PROJECT_INCLUDE` is an executable CMake hook. The same class exists with untrusted project CMakeLists, generated build files, tests and validators. This does not refute the narrower statement that Node itself uses argv arrays rather than shell interpolation.
3. Separately, under `build/plugins/X/X_artefacts/Debug/`, symlink `CLAP` to a directory outside the root containing `Probe.clap`. `audio_plugin_validate(format="CLAP")` enumerated it and passed the symlink path to a shim validator; its realpath was outside. Only `buildDir` was checked (`index.js:1304,1326`), not each discovered path (`627–652`). A real validator may read/load the target.
4. `loadProjectConfig` also opens `apc-mcp.json` via `existsSync/readFileSync` without a symlink check (`333–340`). A malicious local project writer can redirect this read. Existing status/root CMake protections do not cover it.

**Recommended:** describe the tools as executing trusted project/toolchain code with the caller's permissions; require isolation for untrusted projects. Recheck artefact and config containment at the points of use, reject or carefully resolve symlinks, and acknowledge TOCTOU limits. Restrict sensitive CMake hooks if untrusted tool arguments are in scope, but do not present an allowlist alone as a sandbox.

### F2 — skipped CTest is success

After `enable_testing()`, register a command returning 1 and `set_tests_properties(SkipMe PROPERTIES SKIP_RETURN_CODE 1)`. Real CTest 4.4.5 output `***Skipped` and “The following tests did not run”; server output `## Tests passed`, unknown counts, `isError: false`. `index.js:519` has no `Skipped` case. Detect skipped/not-run results and fail or explicitly return incomplete, per the requested rule; test all-skipped and mixed pass/skipped summaries. Also decide whether all `NOT CHECKABLE` validations should return error/incomplete to meet the requested policy (`docs/tools.md` intentionally chooses the opposite today).

### F3 — diagnostic parsing false negative

With a pre-existing Debug cache, a test shim `cmake` writes `/tmp/My Project/File.cpp:1:2: error: synthetic diagnostic` to stderr and exits 0. The actual tool returned success and zero diagnostics. `index.js:436` and `:439` exclude whitespace in filenames; nonzero exits remain errors. Fix path parsing, add this and other compiler-format fixtures, and qualify any remaining guarantee: it is impossible for heuristic text parsing to recognize every possible compiler diagnostic.

### F4 — inherited configuration keys

An otherwise valid `apc-mcp.json` containing `{"constructor":"future-key"}` makes `CONFIG_SCHEMA[key]` at `index.js:351` resolve `Object.prototype.constructor`; `.safeParse` fails. Use own-property checking or a null-prototype map and test `constructor`, `toString`, and `__proto__` keys. This is an honest tool error, but contradicts unknown-key tolerance and enables a project-config denial of service.

### F5 — level visualization

The “Level” bar is set from the gain setting (`templates/juce-webview/Source/UI/app.js:19–27,49–52`) and the editor's state contains no audio level (`WebViewEditor.cpp:123–131`). Rename it to gain or implement measured audio metering with safe audio/message-thread handoff, and validate in a host.

### F6 — `..` in first CMake value segment

`audio_plugin_configure(options="-DTEST=../outside")` succeeded against real CMake; `-DTEST=/tmp/../outside` was rejected. Split the flag into name/type and value before checking path components if the policy is retained. Consider legitimate relative paths and that other CMake cache variables can cause execution independently of path traversal (F1).

## Recommended acceptance tests

1. Real CTest: all skipped, mixed skipped/passed, empty suite, timeout, failed test, unknown output; assert status and incomplete count.
2. Build shim with exit 0 and diagnostics for paths containing spaces, GCC/Clang/MSVC/linkers; nonzero/signal/timeout/ENOBUFS for each command wrapper.
3. Untrusted config prototype keys, symlinked `apc-mcp.json`, nested artefact symlinks and a concurrent-symlink threat-model review. Document that external tools are not confined.
4. SDK-backed configure/build with default and nested/space-containing `pluginsDir`, custom `buildDir`, names, vendor/description escaping, Debug/Release and multi-config; actual LV2 tooling, pluginval and clap-validator; malformed and missing artefacts.
5. DAW/host lifecycle: load, process audio, automate and restore state, UI handshake, repeated open/close, channel layouts, offline processing, metering and real-time behavior. Repeat on supported Windows/macOS/Linux combinations before claiming platform-wide support.


## Remediation log — 2026-11-18 (round 2)

Branch `arena/9ffb859f-apc-mcp` from `95e3a49`. Every fix below ships with a
regression test proven red against `95e3a49` (template tests were run with the
pre-fix templates restored via `git stash`; handler tests with pre-fix
`index.js`), and the CLAP template compiles+links `-Wall -Wextra -Werror`
against real free-audio/clap headers.

| Matrix row / finding | Disposition | Evidence |
|---|---|---|
| F5 — WebView "Level" is not an audio meter | **Closed** | `PluginProcessor::processBlock` measures post-gain output peak into `std::atomic<float> m_outputPeak`; `WebViewEditor::timerCallback` decays and sends `level`; app.js meter driven only by `state.level`. Tests: `templates.test.js` "F5 · the WebView meter shows measured audio level, not the gain knob" (2 tests, red on pre-fix). |
| CLAP scaffold not host-configurable (no params/state) | **Closed** | `clap.params` (1 automatable Gain, 0…1, default 0.75, value_to_text/text_to_value, flush shares `applyParameterEvents()` with process) + `clap.state` (versioned save/load). Tests: `templates.test.js` "clap.params and clap.state…" (3 tests, red on pre-fix); real-header compile+link green. Real clap-validator in PR #45 CI then failed `param-set-wrong-namespace` and `state-reproducibility-*`; fixed by checking `header->space_id == CLAP_CORE_EVENT_SPACE_ID`, requesting `CLAP_PARAM_RESCAN_VALUES` after a state load that changes values, and looped short-read/short-write-tolerant stream I/O — covered by test "ignores foreign-namespace events and announces state-loaded values to the host" (red on the first attempt). |
| `formats="CLAP"` silently accepted for clap | **Closed** | `index.js` rejects any `formats` for clap; zod describe names clap. Tests: `server.test.js` "rejects formats=\"CLAP\"…" + "documents the formats rejection…" (red on pre-fix). |
| json + missing pluginsDir returns prose | **Closed** | JSON mode returns `[]`; prose only in text mode. Test: `server.test.js` "returns parseable JSON when format=json and the plugins directory is absent" (red on pre-fix). |
| "found and is fine" overclaim (`:1909`) | **Closed** | Wording now "was not checked … 'found' is not a correctness claim". Test: `artefacts.test.js` "does not claim an unchecked format is 'fine'" (red on pre-fix). |
| Format `all` omits absent requested formats (row: Partial) | **Closed** | Report gains `**No artefact found** for: …` line. Test: `artefacts.test.js` "names requested formats that produced no artefact…" (red on pre-fix; also asserts the line is absent when all requested formats exist). |
| `-U<GLOB>` vs name-only grammar | **Closed** | Message says `-U<NAME>`. Test: `security.test.js` "says -U<NAME>, not -U<GLOB>" (red on pre-fix). |
| `security:76` audit-level claim (row 108) | **Closed** | Doc now says plain `npm audit` via `npm run audit`, matching `publish.yml`. Doc-only. |
| "any single line" vs 128/512 caps (row 99) | **Closed** | `security.md` states the caps. Doc-only. |
| "No validator exists" wording (row 64) | **Closed** | `tools.md` now says "none integrated in this server". Doc-only. |
| `tools:107` hardcoded `/plugins/` (row 66) | **Closed** | Scan path now names configurable `pluginsDir`. Doc-only. |
| `tools:34/39` `-G` guidance vs NODE-02 (row 40) | **Closed** | Paragraph rewritten: explicit generator always forwarded; only the default is suppressed on an existing cache. Doc-only. |
| CHANGELOG start()/stop() contradiction | **Closed** | Standalone-template bullet and stub-teeth sentence corrected in place; the fabricated-removal claim now references the existing correction entry. |
| lint `readdirSync` silent skip (row 51) | **Already closed** in the 2026-11-17 round | `findFilesByExt` returns `skipped`; lint appends "N director(y|ies) were unreadable and not linted". Row's line refs predate #44. |
| NOT CHECKABLE should be `isError` (row 63) | **Kept as documented** | Deliberate, documented, tested policy: nothing the user could install would change it; refusing to validate an artefact *does* fail the run. |
| DAW lifecycle / Windows / real macOS CLAP packaging | **Out of scope** | Unverifiable in this environment, as the matrix already records. |
