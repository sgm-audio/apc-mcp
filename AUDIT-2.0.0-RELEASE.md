# apc-mcp 2.0.0 — Release Audit

**Date:** 2026-11-16 · **Tree:** `8bbff8c` (branch `arena/835c3bdf-apc-mcp`) · **Package version:** 2.0.0 (unreleased)
**Auditor stance:** adversarial. Every claim below is either reproduced here or explicitly marked unverified.

---

## 1. Verdict

> ## 🔴 NO-GO for tagging 2.0.0 — as of this commit.
>
> *(Historical verdict, kept unedited. See §1a for the remediation that followed, and §8 for the
> re-audit conclusion.)*
>
> Not because the code is bad. The security core is genuinely sound and I could not break it.
> It is a No-Go because **the declared release gate fails at HEAD**, one shipped tool has an
> internal contradiction that produces a permanent false failure for a documented configuration,
> and the validator integration — the whole reason two of the five external tools exist — has
> zero end-to-end verification while the CHANGELOG asserts it works.

**No Critical findings.** No path-containment regression. No command injection. No dishonest
`isError: false` on a failed command that I could produce.

Estimated effort to Go: **~1 day**, mostly CI and two small code changes (§7).

---

## 1a. Remediation status — re-audit, 2026-11-16 (same day)

The findings above were reproduced against `8bbff8c`. The work below was then done on the same
branch. Every "FIXED" claim in this table is backed by a command I re-ran on the tree, not by the
prose in the diff.

| # | Finding | Status | Evidence |
|---|---|---|---|
| H-1 | Declared gate does not pass | **FIXED** | `npm audit fix` → **0 vulnerabilities** (2 moderate `hono` advisories gone; no `overrides`, no threshold flag). `npm run check` → **exit 0**: 221 tests, 213 pass, 0 fail, 8 skipped; lint, smoke, licenses, docs all PASS. CI's `npm audit --audit-level=high` replaced with `npm run audit`, so CI and the documented gate are now the same command. |
| H-2 | Validate never run against real validators | **FIXED and now proven by a real run** | New `scripts/smoke-validate.mjs` (scaffold → real cmake build → real validate → require `PASS`, fail on `SKIPPED`/`NOT CHECKABLE`/`MISSING-VALIDATOR`) in two jobs that install `clap-validator` 0.4.1 and `pluginval` v1.0.4 from their releases; both in `publish.needs`. **CI run `43817093143` on `a22208f` (PR #35): both jobs `success`.** Getting there took three real failures, each of which is the point of the exercise: (1) the *old* inline stdio smoke step used `timeout`, absent on macOS, so the new macOS matrix was red on arrival; (2) the clap-validator archive layout did not match the guessed path, while the identical pluginval install worked; (3) the script built outside `projectPath`, and `audio_plugin_validate` correctly reported "build directory not found — run audio_plugin_build first". None of these were discoverable from the shims. Verdict on the claim itself: a scaffolded CLAP plugin passes `clap-validator 0.4.1` and a scaffolded VST3 passes `pluginval 1.0.4` at `--strictness-level 10`, well inside the tool's 120 s budget. |
| M-1 | `NOT CHECKABLE` formats fail the run with impossible advice | **FIXED** | `validate` reports `pass \| fail \| missing-validator \| not-checkable`; only the first two of the failure classes touch `isError`; `format` accepts all five artefact values. Old behaviour reproduced before the fix (`1 passed, 0 failed, 1 skipped` + `isError: true` for `LV2`), gone after. QA-06's contract is preserved: a *missing* `clap-validator` still yields `isError: true`. |
| M-2 | Legitimate paths rejected with a false "shell metacharacters" diagnosis | **FIXED** | `validatePath()` and lint `target` reject only non-string/empty/NUL; `SAFE_PATH` is retained solely for the two config values interpolated into CMake source, and its comment now says so. Containment is unchanged (`assertWithinProject()`). |
| M-3 | ASCII-only metadata + raw regex in the error | **FIXED** | `SAFE_VENDOR`/`SAFE_DESCRIPTION` replaced by `SAFE_TEXT` (any single line, control characters rejected with a sentence). `vendor` gained per-grammar escaping: `VENDOR_CXX` / `VENDOR_CMAKE` / `VENDOR_TTL` / `VENDOR_HTML`, plus an `htmlEscape()` for the WebView text node; the bare `{{VENDOR}}` placeholder is gone, so a missed template fails the smoke test instead of shipping a literal. New test scaffolds `ACME, Inc. & "Sons"` and asserts the byte-level escaping in all four grammars. |
| M-4 | No annotations / no title | **FIXED** | `TOOL_META` (title + 4 hints per tool) + `server.registerTool()`; registration throws if metadata is missing. `tools/list` verified: 7 tools, each with `title` and `annotations`. New test asserts the hints are not just present but *truthful* (only `plugins` is read-only; create/configure/build/lint are destructive; nothing that executes a command claims `readOnlyHint`). |
| M-5 | Only Linux paths ever built | **PARTIAL — deliberately** | `test` is now a matrix over `ubuntu-latest` **and** `macos-latest` (2 Node versions × 2 OSes), because the server branches on `process.platform`. Windows is **not** in the matrix and is documented as unverified in `docs/project-status.md`: the security tests drive POSIX shebang shims, so a Windows job would report on the fixtures rather than the server — a green tick that means nothing, which is worse than an honest gap. No Windows *scaffold* job exists either; that remains the largest untouched gap. |
| M-6 | `-G` always passed, second configure can fail | **FIXED** | `-G` is only passed when `CMakeCache.txt` is absent; empty-stderr failures now say what failed instead of printing a blank. |
| M-7 | ctest exit 8 reported as a test failure | **FIXED** | Exit 8 / `No tests were found` is diagnosed separately and returns `isError: true` with a dedicated report, instead of `0 failed`. |
| M-8 | Fabricated JUCE-9 history in comments and a test name | **FIXED** | Three comments corrected (`templates/standalone/Source/MainComponent.{h,cpp}`, `templates/juce-webview/Source/PluginProcessor.cpp`) and the test renamed. Both symbols verified absent from JUCE 6.1.6 / 7.0.12 / 8.0.15 / 9.0.5. |

**Low findings:** L-11 fixed (`docs/project-status.md` now says "two *direct* runtime dependencies"
and names the 163-package lockfile, which is where H-1's advisories lived). L-1 fixed the way this
report recommended rather than by pinning the override: `eslint` `^10.12.0 → ^10.15.0` (its range is
`minimatch@^11.0.5`), `overrides` deleted, lockfile tree now clean (`npm ls minimatch` → 11.0.8,
no `invalid`), `npm audit` still 0, 163 packages unchanged. **L-2 … L-10 and L-12 … L-13 remain open**, unchanged, and are still a fair description of
the tree: they were Low before the remediation and none of them was made worse.

**Low items intentionally left:** L-2 (CLAP has no params/state extension, so the gain is dead
state), L-4 (WebView JS bridge uses a URL-scheme interception idiom rather than
`withNativeFunction`, unexercised at runtime), L-5 (leading-dash `target`/`testName` values),
L-6 (`~` is accepted but never expanded), L-7–L-9 (smoke assertion looseness, partial directory on
`copyDir` failure, `plugins` message when only `build/plugins` exists), L-10 (redundant
`JUCE_VST3_CAN_REPLACE_VST2=0`), L-12 (workflow named `CI` also publishes), L-13 (Dependabot's
`codeql-action` PRs are red upstream of this repo).

---

## 2. Scope and method

**Read:** `index.js` (1419 lines, all), all five template trees (C/C++/CMake), `package.json`,
`eslint.config.js`, all 7 test files, 3 scripts, both workflows, `README.md`, `docs/*.md`,
`CHANGELOG.md`, `docs/archive/AUDIT.md`, `docs/archive/HANDOFF.md`.

**Executed in this sandbox** (Node 22.22.3, npm 10.9.8, Linux):

| Action | Result |
|---|---|
| `npm ci` | ok |
| `npm test` | **215 tests / 207 pass / 0 fail / 8 skipped** (61 s) |
| `npm run lint`, `npm run smoke`, `npm run licenses`, `npm run docs:check` | pass (21 md, 138 paths, 44 anchors) |
| `npm run check` | **exit 1** — fails at `npm audit` |
| `npm audit` | **2 moderate** (`hono` ≤4.13.15, `@hono/node-server` 2.0.0–2.1.5) |
| Adversarial MCP probes with fake `cmake`/`ctest`/`clang-format`/`pluginval` (§4) | see findings |
| GitHub Actions history (`gh run list/view`) | run `42405075376` (2026-11-07): all 7 jobs **success**, incl. 3 real CMake build jobs |

**Upstream verification performed against real sources** (not memory): JUCE **9.0.5** and **9.0.3**
`JUCEUtils.cmake`, `juce_AudioAppComponent.h`, `juce_WebBrowserComponent.h`, `FindWebView2.cmake`;
JUCE 6.1.6 / 7.0.12 / 8.0.15 headers; `free-audio/clap` `plugin.h`, `entry.h`, `process.h`,
`ext/audio-ports.h`, `plugin-features.h`; `lv2/lv2` `lv2core.ttl` + `lv2core.meta.ttl`;
`Tracktion/pluginval` and `free-audio/clap-validator` READMEs.

**Not reproducible here (declared):** no `cmake`, no JUCE/CLAP/LV2 checkout, no `pluginval`/
`clap-validator`, no Windows or macOS runner. Claims that depend on those are marked
*unverified* and are not counted as passes.

---

## 3. Risk map

| Area | Rating | One-line state |
|---|---|---|
| Path containment | 🟢 **Solid** | SEC-01 genuinely fixed; 7 evasion vectors refused; symlink-aware; no regression found |
| Dishonest results (`isError:false` on failure) | 🟡 **Mostly honest** | Failed commands, emitted errors, failed tests all set `isError` correctly (verified with fakes). Residual: "incomplete" is conflated with "failed" |
| Template correctness vs real JUCE 9 / CLAP / LV2 | 🟡 **Good code, invented justifications** | Structs, constants, CMake keywords, artefact layout all check out against upstream source. Two comments/tests encode **fabricated version history** |
| MCP schema completeness | 🟡 **Minimal** | `name` + `inputSchema` only; no annotations, no `outputSchema`/`structuredContent`; destructive tools unmarked |
| Supply chain | 🟡 **Good hygiene, stale lockfile** | SHA-pinned actions, provenance publish, real license gate, real versions — but 2 live advisories break the gate |
| Real-time safety of generated C++ | 🟢 **Good** | `ScopedNoDenormals`, no allocation/locking in `processBlock`/`run()`/`process()`, `std::atomic` across threads, correct in-place-safe gain loop |
| Verification substantiation | 🔴 **Weakest area** | Validators never run in CI; Windows/macOS never built; release gate red |
| AI-failure-mode residue | 🟡 | No hallucinated APIs found in shipped code. But confident, specific, **false** migration narratives remain in comments and one test name |

---

## 4. Findings

### HIGH

#### H-1 · The documented release gate does not pass on this commit

`docs/project-status.md:11-30` presents this as the reproducible baseline and claims:

- `:27` — `npm audit` → **PASS — 0 vulnerabilities**
- `:29` — `npm run check` → **PASS (exit 0)**
- `docs/security.md:53` — "SEC-02 (dependency advisories)" closed
- `CHANGELOG.md:47-52,66` — "`npm audit` went from 6 … to **0**"

Reproduced today:

```
$ npm run check ; echo $?
...
2 moderate severity vulnerabilities
npm run check EXIT=1
```

`npm run check` (`package.json:21`) chains `npm run audit`, which is plain `npm audit`
(`package.json:16`). `npm audit` exits 1 for any advisory → the gate stops there. Meanwhile CI runs
`npm audit --audit-level=high` (`.github/workflows/publish.yml:37`), which **passes**. So **CI green
≠ documented gate green**, and the README's "verification baseline" is not reproducible by a
contributor today.

The two advisories are in `hono` and `@hono/node-server`, both transitive via
`@modelcontextprotocol/sdk`'s HTTP transport — which this stdio-only server never imports, so
practical risk is low. But `npm run ship` calls `npm run check` (`scripts/ship.mjs:79`), so
**shipping is currently blocked by the project's own guard**.

**Remediation (15 min):** `npm audit fix` (both are patch-level and inside the SDK's declared ranges
`hono ^4.11.4`, `@hono/node-server ^2.0.5`, so no override is needed), commit the lockfile, then
re-run `npm run check` before tagging. Also make the local and CI thresholds identical —
either use `npm audit --audit-level=high` in both, or plain `npm audit` in both.

---

#### H-2 · `audio_plugin_validate` is not verified against the real validators, yet 2.0.0 claims it works

`audio_plugin_validate` is one of seven tools and the sole reason `pluginval` and `clap-validator`
are prerequisites. Evidence of the gap:

- No workflow installs either binary. Jobs are `test`, `compile-scaffold`, `scaffold-clap`,
  `scaffold-lv2`, `scaffold-juce`, `license` (`.github/workflows/publish.yml:13-169`). None invokes
  `pluginval` or `clap-validator`.
- Every validate test uses a **fake** binary (`tests/tool-output.test.js:425-477`), which proves the
  argv shape and the skip logic — not that the real tool accepts the invocation.
- `CHANGELOG.md` asserts behaviour that only the real tool can confirm: "returns
  `CLAP_PROCESS_CONTINUE` on 0-port transport calls **so `clap-validator` transport tests pass**".
  Nothing in CI substantiates that sentence.

I *did* verify the CLI shapes against upstream docs, and they are correct:

- `pluginval --strictness-level 10 <path>` — matches `Tracktion/pluginval` README ("`./pluginval --strictness-level 5 <path_to_plugin>`").
- `clap-validator validate <path>` — matches `free-audio/clap-validator` README ("`clap-validator validate /path/to/the/plugin.clap`").

But correctness of argv ≠ a passing validation. A freshly scaffolded CLAP plugin implements **only**
`CLAP_EXT_AUDIO_PORTS` (`templates/clap/Source/PluginProcessor.cpp:174-180`) — no
`CLAP_EXT_PARAMS`, no `CLAP_EXT_STATE`. clap-validator "runs all tests by default, including pedantic
ones" (its README). Whether a scaffold passes out of the box is **unknown**, and that is exactly the
kind of thing this project has been burned by before.

**Remediation:** add one CI job per validator —
`clap-validator` (no display needed) against the scaffolded `.clap`, and
`pluginval --strictness-level 5 --skip-gui-tests` under `xvfb-run` against the scaffolded VST3.
Then either (a) make the scaffold pass, (b) document the expected baseline failures, or (c) reduce
strictness. Until then, drop the "transport tests pass" sentence from the CHANGELOG.

---

### MEDIUM

#### M-1 · Validation is "incomplete" ⇒ `isError: true`, with remediation that is impossible to follow

`index.js:1216` — `isError: failed > 0 || skipped > 0`. `index.js:1145` only maps validators for
`VST3` and `CLAP`, so any other format is always `skipped` (`:1171`), and the text then says
(`:1177`) `installHint(bin)` — but **`bin` is `undefined` for LV2/AudioUnit/Standalone** and no such
validator exists anywhere in the server.

Reproduced:

```
--- validate all, config=[VST3], pluginval present
    isError=false   ## Validation results — 1 passed, 0 failed
--- validate all, config=[VST3,LV2]
    isError=true    ## Validation results — 1 passed, 0 failed, 1 skipped
                    ### MyGain [LV2] — SKIPPED ... _No validator is configured for LV2._
                    Validation is **incomplete** — install the missing validator(s) above and re-run.
```

Compounding it: `KNOWN_FORMATS` accepts all five (`index.js:241`, used by config at `:258`), but the
tool's own enum only accepts `VST3 | CLAP | all` (`index.js:1127`), so you cannot even ask for `LV2`
directly:

```
format="LV2" → MCP error -32602: Input validation error: Invalid option: expected one of "VST3"|"CLAP"|"all"
```

So a correctly configured JUCE project (default `FORMATS VST3;LV2;Standalone`) that sets
`validateFormats` to include LV2 gets a **permanent red** on a passing validation, an agent will
retry in a loop, and the advice it is given cannot be satisfied. Note this also contradicts
`docs/tools.md:105` and `docs/project-status.md:44`, which describe LV2 as merely "skipped".

**Remediation:** either (a) reject unsupported formats in `CONFIG_SCHEMA` (best: don't accept a
`validateFormats` value you can never validate), or (b) report stored results with
`isError: false` and a prominent `status: incomplete` marker instead of conflating with failure, and
drop the "install the missing validator" advice when none exists. Keep the honest signal, lose the
false one.

---

#### M-2 · Legitimate project paths are rejected with a false diagnosis

`index.js:62` — `SAFE_PATH = /^[a-zA-Z0-9_ /\\.\-:@~]+$/`, applied to `projectPath` via
`validatePath()` (`index.js:64-68`). Any path containing `(`, `)`, `'`, `+`, `,`, `&`, `#`, `!` is
rejected:

```
create: project path containing parentheses
  isError=true  "Invalid path: contains shell metacharacters"
```

`/Users/o'brien/src/My Plugins (2026)/` is not an exotic path; neither is `C:\Users\X\iZotope, Inc\`.
The message is also **factually wrong**: this file's security model is "there is no shell anywhere"
(`index.js:6-9`, enforced by `eslint.config.js:74-90`), so no shell metacharacters can matter for a
path handed to `path.resolve()` and then to `spawnSync` as a discrete argv entry.

**Remediation:** split the schema. Filesystem paths (`projectPath`, lint `target`) need
`path.resolve` + `assertWithinProject`, not a charset allowlist. Keep charset restriction only for
values interpolated into CMake/C++ source. At minimum, fix the message.

---

#### M-3 · Non-ASCII metadata is impossible, and schema failures are surfaced as raw regexes

`SAFE_VENDOR` (`index.js:53`) and `SAFE_DESCRIPTION` (`index.js:57`) are ASCII-only, so a German or
French vendor name cannot be embedded in `COMPANY_NAME`, the CLAP descriptor, or the LV2 `doap:name`
— even though all three formats are UTF-8 and the templates already escape correctly for each
grammar (`juceDescriptionEscape`, `cxxStringEscape`, `turtleEscape`).

```
description="Café plugin" → MCP error -32602: ... Invalid string: must match pattern /^[\x20-\x7E]+$/ at description
```

The *behaviour* is honest; the *message* is a regex, which is poor input for a model. `SAFE_GENERATOR`
and `SAFE_OPTIONS` (`index.js:43-47`) do have human messages; `SAFE_TARGET`, `SAFE_PLUGIN_NAME`,
`SAFE_VENDOR`, `SAFE_DESCRIPTION`, `SAFE_FORMATS` do not.

**Remediation:** allow UTF-8 in `vendor`/`description` (escaping is already correct and tested), and
add a message as the second argument to every `.regex()`.

---

#### M-4 · MCP surface is minimal: no annotations, no structured output

`tools/list` for all seven tools returns exactly `["execution","inputSchema","name"]` — no `title`,
no `annotations`, no `outputSchema`. Verified by dumping the live `tools/list` response.

Consequences: `audio_plugin_create` (writes files, appends to `CMakeLists.txt`),
`audio_plugin_lint(fix=true)` (rewrites files in place) and `audio_plugin_build` (writes a build tree)
advertise **no** `destructiveHint`/`readOnlyHint`, so a client cannot gate or confirm them;
`audio_plugin_plugins(format="json")` returns a JSON document **stringified into a text block**
(`index.js:1105`), so clients cannot consume it structurally.

**Remediation:** add MCP `annotations` per tool (`readOnlyHint: true` for `plugins`; 
`destructiveHint: true` for `lint` and `create`), and return `structuredContent` + `outputSchema` for
`plugins`. Low effort, high client-compat payoff.

---

#### M-5 · Only Linux template paths are ever built

`scaffold-juce` builds with real CMake on `ubuntu-latest` only
(`.github/workflows/publish.yml:128-156`). Never exercised anywhere:

- Windows: `NEEDS_WEBVIEW2 TRUE` + `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1`
  (`templates/juce-webview/CMakeLists.txt:43-44,81`) → requires `find_package(WebView2 REQUIRED)`
  and `WebView2LoaderStatic.lib`. I verified the mechanism is consistent (`JUCEUtils.cmake` links
  `juce::juce_webview2`; `FindWebView2.cmake` supplies `WebView2LoaderStatic.lib` from NuGet), so
  the template is *probably* right — but "probably" is the best available answer.
- macOS: CLAP `.clap` CFBundle (`templates/clap/CMakeLists.txt:54-62`) and AU `.component`
  discovery (`index.js` `ARTEFACT_LAYOUT.AudioUnit`). Neither is built or scanned in CI.

This is disclosed (`docs/project-status.md:44-46`), which is honest — but a "production-viable for
real plugin developers" claim rests on macOS in particular.

**Remediation:** add a `macos-latest` job for `scaffold-juce` (+AU/CLAP artefact assertions) and a
`windows-latest` job for at least configure + build of the webview template. Even configure-only
catches the whole class.

---

#### M-6 · `audio_plugin_configure` always passes `-G`, so a second configure can fail

`index.js:856-862` emits `-G <generator>` unconditionally. Against an existing `CMakeCache.txt`
created by a different generator, CMake aborts with a generator-mismatch error. `audio_plugin_build`
handles exactly this case correctly (`index.js:794-797`: "Only pass `-G` when creating a fresh
cache") — so the two tools disagree about the same problem. Also, this handler returns raw
`stderr` as the entire message with no header (`index.js:869`), unlike every other tool.

**Remediation:** apply the same `cacheExists` guard as `build`, and prefix with `## Configure failed`.

---

#### M-7 · ctest exit 8 ("no tests were found") is reported as a test *failure*

`trySpawn` gives `status`; `parseTestOutput` (`index.js:433-463`) returns `recognized:false` for
ctest's "No tests were found!!!", and the handler then prints `## Tests failed` + "Passed: unknown"
(`index.js:900-910`). Reproduced:

```
## Tests failed
Passed: unknown, Failed: unknown, Total: unknown _(ctest output was not in a recognized format)_
### Details
No tests were found!!!
'ctest' exited with code 8
```

Honest about non-success, but the diagnosis is wrong: exit 8 has a documented meaning (no tests), and
"run the tests, they didn't fail, there are none" is a *build/registration* problem — usually "wrong
build dir" or "tests never added". The model is told the wrong thing.

**Remediation:** special-case `status === 8` / `No tests were found` with the real cause and the
`buildDir` it looked in.

---

#### M-8 · Two commits' worth of fabricated version history survive in comments and one test name

This is the exact failure mode `docs/project-status.md:53` says the project learned to avoid
("plausible-sounding APIs that do not exist"). The *code* is right; the *justification* is invented:

- `templates/standalone/Source/MainComponent.h:12-18`: "⚠️ JUCE 9 API CHANGE — there is no `start()`
  and no `stop()` any more… Older tutorials… will not compile against JUCE 9."
  **False.** `AudioAppComponent` has never had `start()`/`stop()`: verified 0 occurrences in JUCE
  **6.1.6, 7.0.12, 8.0.15, 9.0.5**. `setAudioChannels()`/`shutdownAudio()` is the only API that ever
  existed.
- `templates/juce-webview/Source/PluginProcessor.cpp:60-61`: "`XmlDocument::storeXmlAsString` does
  not exist in JUCE 9". **Also false as stated** — it never existed in 6.1.6 / 7.0.12 / 9.0.5
  either. (The *advice*, `copyXmlToBinary`, is correct.)
- `tests/templates.test.js:641` enshrines it: `it('does not call start() or stop(), which JUCE 9
  removed from AudioAppComponent')`. A green test now certifies a false statement, and a future
  reader will trust it.

Harmless to the build, corrosive to trust: when one confident API claim is invented, every other
claim in the same file has to be re-verified. (I did; the rest held up — §6.)

**Remediation:** delete the "JUCE 9 removed…" framing from both comments and rename the test to
"never calls start()/stop() — AudioAppComponent has only setAudioChannels/shutdownAudio". Keep the
instruction, drop the false history.

---

### LOW

| # | Finding | Evidence / location |
|---|---|---|
| L-1 | `overrides.minimatch: ^11.0.5` forces v11 under eslint 10.14.0, which declares `^10.2.6` | `package.json:59-61`; `npm ls minimatch` shows `minimatch@11.0.5 overridden`. ESLint 10.15.0 itself wants `^11.0.5`, so the clean fix is bumping eslint — not an override that pins a major across a declared range. |
| L-2 | CLAP scaffold: no `params`/`state` extensions, so `m_gain` is dead state reset to 1.0 (a "gain" plugin with no gain control); `in_place_pair = 0` is set on **input** ports too, though CLAP defines it for outputs only | `templates/clap/Source/PluginProcessor.cpp:29-49,57,122-125`; `clap/ext/audio-ports.h` comment "in-place processing … if not supported set to CLAP_INVALID_ID" |
| L-3 | LV2 metadata mis-classifies a stereo gain as `lv2:UtilityPlugin` ("not a typical audio effect or generator"); audio ports carry no `lv2:designation lv2:left/right` | `templates/lv2/Source/plugin.ttl:23`; `lv2core.ttl:427-432` vs `lv2core.ttl:597` (`lv2:AmplifierPlugin` — "primarily changes the volume of its input"). `hardRTCapable` as `optionalFeature` is **correct** (matches drumkv1, rust-lv2, gx_redeye) — I checked |
| L-4 | WebView JS→C++ bridge uses `window.location.href = 'apc://…'` + `pageAboutToLoad` interception; JUCE's idiom is `withNativeFunction`/`withEventListener`. No runtime test exists (build-only in CI) | `templates/juce-webview/Source/UI/app.js:37`; `Source/WebViewEditor.h:22-30` |
| L-5 | `target`/`testName` accept leading-dash values (`--target`, `--tests-regex` take the next argv entry regardless) | `index.js:41,810`; `SAFE_TARGET` permits `-x` |
| L-6 | `~` is in `SAFE_PATH` but never expanded, so `~/proj` silently resolves under CWD | `index.js:62,67` |
| L-7 | Smoke test's standalone assertion accepts *any* file in the config dir (doesn't check executability or platform shape) | `scripts/smoke-scaffold.mjs:214-224` vs `index.js:543-556` (`standaloneArtefacts` is stricter) |
| L-8 | A failure inside `copyDir` leaves a partial plugin dir; the retry then reports "Already exists" with no cleanup | `index.js:1320-1335,1265-1267` |
| L-9 | `audio_plugin_plugins` says "No plugins/ directory found" even when `build/plugins/` is full of artefacts | reproduced; `index.js:1069-1071` |
| L-10 | `JUCE_VST3_CAN_REPLACE_VST2=0` is redundant — JUCE sets it itself | template `CMakeLists.txt:66`; `JUCEUtils.cmake:2465` |
| L-11 | "one-file server with two runtime dependencies" understates a **163-package** tree incl. express/cors/jose/ajv/hono — which is precisely where H-1's advisories live | `docs/project-status.md:8`; `npm run licenses` → 163 lockfile packages |
| L-12 | Workflow file `publish.yml` is named `CI` and does the publishing; `publish` job is skipped on branches | `.github/workflows/publish.yml:1,171-173` |
| L-13 | Dependabot PRs bumping `github/codeql-action` are currently red (4 days), so automated action maintenance is broken | `gh run list`: runs `43086816180`, `43086822858` = failure |

---

### INFO — what I verified and found genuinely correct

Because a cynical audit must also say what held up (all checked against upstream source, not memory):

- **JUCE artefact layout is right.** `_juce_get_plugin_kind_name` maps `AU→"AU"` and the *output dir*
  is `…/<target>_artefacts/$<CONFIG>/<Kind>/` with `Kind` = `VST3 | AU | LV2 | Standalone`; LV2 is
  `<Product Name>.lv2/` and VST3 output is `<Product Name>.vst3` via `PRODUCT_NAME`
  (`JUCEUtils.cmake`). `index.js:505-516` scanning **by suffix instead of constructing filenames** is
  the correct response to the `displayName()`/`PRODUCT_NAME` mismatch. This is a real bug class,
  correctly handled — and it is *not* the usual AI answer.
- **CLAP surface matches the real headers exactly**: `clap_plugin_descriptor_t` field order,
  `clap_process_t` field names (`frames_count`, not `frames`), `CLAP_PROCESS_*` values,
  `clap_plugin_factory_t` order, `CLAP_EXPORT`/`CLAP_ABI`, `CLAP_PORT_STEREO`,
  `CLAP_AUDIO_PORT_IS_MAIN`, `CLAP_PLUGIN_FEATURE_AUDIO_EFFECT/STEREO`, and the post-1.0
  entry→factory indirection.
- **JUCE CMake keywords all exist**: every keyword used in `templates/*/CMakeLists.txt` is in
  `_juce_initialise_target`'s `one_value_args`/`multi_value_args`; `juce_add_binary_data` really takes
  only `NAMESPACE | HEADER_NAME | SOURCES`; JUCE 9 really performs no `UNPARSED_ARGUMENTS` check
  (confirmed: no such check in `_juce_initialise_target`), so the templates' caution is warranted.
  `juce_add_webview_ui` and `BINARY_DATA_ID` are absent, as the tests claim.
- **WebBrowserComponent API is correct**: `Options::withResourceProvider`, `Options::withBackend`,
  `Backend::webview2`, `getResourceProviderRoot()` (static), `pageAboutToLoad()` (virtual, returns
  bool), `evaluateJavascript()`, and `Resource{ std::vector<std::byte> data; String mimeType; }`.
- **`AudioAppComponent` usage** (`setAudioChannels` in ctor, `shutdownAudio` in dtor, three pure
  virtuals) is correct for JUCE 9 — only the *narrative* around it is invented (M-8).
- **SEC-01 is genuinely fixed.** Independent probe with an argv-recording `clang-format -i`:
  `../outside`, `Source/../../outside`, `./../outside`, `..\outside`, absolute-outside, symlinked dir,
  symlinked file → **all refused, 0 argv invocations, 0 escaped paths**; legit subdir and whole
  project still work. `create` through a symlinked `plugins/` dir refused, nothing written outside.
- **Honest build reporting** works where it used to lie: fake `cmake` exiting 0 while printing
  `error:` → `## Build failed / Errors: 1`, `isError=true`. Fake `clang-format` failing with
  `fix=true` → `## Lint could not apply fixes`, `isError=true`.
- **No shell**: no `exec`/`execSync`/`sh -c` in `index.js` or scripts; binary discovery is
  `fs.accessSync` PATH scanning, no subprocess; ESLint bans the shell APIs
  (`eslint.config.js:74-90`).
- **CI really did build the templates**: run `42405075376` (2026-11-07) — `Scaffolded C/C++ compiles`,
  `Scaffolded CLAP`, `Scaffolded LV2`, `Scaffolded JUCE` all **success**, JUCE pinned to 9.0.3
  against real Linux deps. This is far above the usual bar for an AI-assisted repo.
- **Release engineering** is real: single-source version (`index.js:26-36`), SHA-pinned actions,
  `publish` gated on all verification jobs, `--provenance --access public`, `ship.mjs` refuses wrong
  branch/dirty tree/existing tag, license gate parses full SPDX with `WITH`/`AND`/`OR`.
- Dependency versions are **real and current** (`@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7,
  `eslint` 10.15.0 all exist on the registry).

---

## 5. Claim substantiation matrix

| Claim | Source | Verdict |
|---|---|---|
| "215 tests, 207 pass, 8 skipped" | `docs/project-status.md:25` | ✅ true |
| "`npm audit` PASS — 0 vulnerabilities" | `docs/project-status.md:27` | ❌ **false today** (2 moderate) |
| "`npm run check` PASS (exit 0)" | `docs/project-status.md:29` | ❌ **false today** (exit 1) |
| "163 lockfile packages checked" | `docs/project-status.md:28` | ✅ true |
| "seven tools, five scaffolds, stdio-only" | `docs/project-status.md:8` | ✅ true |
| "path traversal closed in 2.0.0" | `SECURITY.md`, `docs/security.md:11-23` | ✅ true (7 vectors re-tested) |
| "no residual risk of shell injection" | `docs/security.md:47` | ✅ true |
| "templates verified against JUCE 9 / CLAP / LV2" | `docs/project-status.md:37` | ✅ structurally true; ❌ two fabricated version claims (M-8) |
| "validators receive correct CLI" | `CHANGELOG.md` | ✅ argv correct vs upstream README; ❌ "transport tests pass" unsubstantiated (H-2) |
| "isError true whenever a command failed" | `docs/security.md:38` | ✅ true for failures; ⚠️ also true for *skips* (M-1) |
| "`npm run ship` guards branch/tree/tag/changelog" | `docs/project-status.md:39` | ✅ true — but it currently can't pass H-1 |
| "CI compiles + links CLAP/LV2/JUCE" | `docs/project-status.md:32` | ✅ true, Linux only (M-5) |

---

## 6. Verification gaps that would otherwise be invisible

1. **The C++ is compile-verified but never *load*-verified.** No host loads a plugin; `pluginval`/
   `clap-validator` never run. A plugin that compiles and links can still fail instantiation,
   descriptor validation, or audio-port queries. (JUCE's API fixture is explicitly a stub —
   `tests/fixtures/juce-api-stub/JuceHeader.h:25-26` — and the real-header build in CI is the only
   thing preventing false confidence there. That mitigation is good and should stay.)
2. **The webview JS↔C++ bridge has no runtime test.** It builds; nobody has proven a parameter change
   round-trips through `apc://callback`.
3. **`pluginval --strictness-level 10` with a 120 s timeout** (`index.js:1190`) will kill legitimate
   slow plugins at the highest strictness level, which is then reported as a validation failure.
   Consider strictness 5 (pluginval's own documented floor for host compatibility) as the default and
   let users raise it.
4. **Local `npm test` skips the 8 most valuable assertions** (CLAP/LV2 compile+link) unless
   `APC_CLAP_INCLUDE`/`APC_LV2_INCLUDE` are set — correctly disclosed, correctly guarded by two
   "headers were available" tests, but the headline "215 tests" over-reads.

---

## 7. Remediation plan to reach Go

**Blocking (must fix before tag):**

1. `npm audit fix` + commit lockfile; re-run `npm run check` to a genuine exit 0. Align the audit
   threshold between `package.json` and CI. *(H-1, 15 min)*
2. Fix M-1: stop accepting config formats with no validator, and/or stop mapping "skipped" to
   `isError`. Remove the unsatisfiable install advice. *(~1 h)*
3. Add the two validator CI jobs (clap-validator on the scaffolded CLAP plugin; pluginval
   `--skip-gui-tests` under xvfb on the VST3), and either make them pass or document the expected
   baseline. Correct the CHANGELOG sentence regardless. *(H-2, ~2 h)*

**Strongly recommended before "production-viable" is claimed:**

4. Fix M-2 (path charset) and M-3 (UTF-8 metadata + regex messages). *(~1 h)*
5. Add MCP `annotations` (M-4). *(~30 min)*
6. Delete/repair the fabricated JUCE-9 history in the two comments and the test name (M-8). *(10 min)*
7. Apply the `cacheExists` guard to `audio_plugin_configure` (M-6) and special-case ctest exit 8
   (M-7). *(~30 min)*
8. Add macOS (and Windows configure-only) scaffold jobs (M-5). *(half a day, mostly CI plumbing)*

**Then:** tag `v2.0.0`, and update `docs/project-status.md`'s dated table by *re-running* the commands
— the current table is evidence of a past run, not of this tree.

---

## 8. Bottom line

This is not the usual AI-generated wreck. The security work is real and I could not defeat it; the
JUCE/CLAP/LV2 API surface was checked against upstream source and mostly survives; the tests are
behavioural rather than decorative; CI actually compiles the generated C++ against real JUCE 9.

What is left is the residue of the *same process* that produced the earlier defects: confident prose
that nobody re-derived (two invented "removed in JUCE 9" claims, one of them frozen into a test
name), a documented gate nobody re-ran (it fails today), and a tool (`validate`) whose headline
behaviour is asserted in the changelog but never executed by a machine. Those are cheap to fix and
expensive to leave.

**Do not tag 2.0.0 at this commit.** Fix H-1, H-2 and M-1, and it becomes a legitimate release.

---

### 8a. Re-audit conclusion (later on 2026-11-16)

All three blocking findings are closed, along with five of the eight Mediums; M-5 is closed for
macOS and deliberately left open for Windows. The gate that failed when this audit started now runs
green on the machine that wrote the audit:

```text
npm run check  → exit 0
  lint        PASS
  test        221 tests · 213 pass · 0 fail · 8 skipped
  smoke       PASS (10/10)
  audit       0 vulnerabilities   (no --audit-level, no overrides)
  licenses    163 packages, all allowed
  docs        22 files · 139 paths · 46 anchors
```

> ## 🟡 GO for tagging 2.0.0 — with one condition and two caveats.
>
> **Condition:** met. H-2's evidence is CI run `43817093143` on PR #35 — **11/11 verification jobs
> green**, including `scaffold-clap-validate` and `scaffold-juce-validate`, the macOS matrix, and
> the four pre-existing scaffold/compile jobs (`publish` skipped, as it only runs on a `v*` tag).
> The two validator jobs pass only when a validator genuinely ran and returned PASS, so the
> changelog's original claim is now measured rather than asserted. The earlier worry that
> pluginval's strictness-10 run might blow the tool's 120 s spawn budget did not materialise.
>
> **Caveat 1 — Windows remains unverified.** Nothing in the tree has ever executed a Windows code
> path; `docs/project-status.md` now says so plainly instead of leaving the reader to assume
> otherwise.
>
> **Caveat 2 — the Low findings are still there.** L-2 … L-10 and L-12 live in the shipped
> templates and tools; none is a false success report, and none was made worse by this work.

The pattern worth remembering is the one this audit found twice: a claim that was *true when
someone typed it* and never re-derived — a green CI badge measuring a laxer threshold than the
documented gate, and a changelog sentence about validator tests that no machine had ever run.
Both are now measured by something that fails when it is wrong.
