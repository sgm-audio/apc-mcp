# HANDOFF — apc-mcp completion guide

**For:** whoever picks this project up next (human or agent).
**Written:** 2026-10-05, on branch `arena/353ee88c-apc-mcp`.
**Read this first.** It contains the current state, the verified environment
limits, the exact remaining work with file:line references, and the traps that
cost the most time to discover. `AUDIT.md` has the full findings and evidence;
this file is the operating manual.

---

## 1. Where the project stands

`apc-mcp` is an MCP server (`index.js`, 1063 lines, zero-dep beyond
`@modelcontextprotocol/sdk` + `zod`) exposing 7 tools for audio-plugin work:
`create`, `configure`, `build`, `test`, `lint`, `validate`, `plugins`. It ships
CMake/C++ scaffold templates under `templates/` for `clap`, `juce` and `vst3`,
each with `generic` or `webview` UI.

A full audit found **35 defects**, and one more (**FUNC-21**) turned up while building the first `TODO.md` feature. Phases 0–5 are **done, committed and pushed**:

| Commit | Phase | What it did |
|---|---|---|
| `0164482` | P0 | Unblocked release gates: deps `npm audit` 6 → 0, deleted broken `.gitlab-ci.yml`, added `.editorconfig`, wrote the license gate |
| `a52a869` | P1 | Security: closed the critical `audio_plugin_lint` path traversal (arbitrary out-of-project write), fixed `findBinary()` always returning true, dead `ENOENT`/timeout handling, unvalidated config loading, removed `type:'ara'`, event-driven test client (126s → 14s), 30 new negative tests |
| `2fb81da` | P2 | **Templates**: the scaffold output could not configure or compile at all. Rewrote all three CMakeLists and the whole `juce-webview` + `clap` C++ layer against verified JUCE 9 / CLAP APIs. 36 new tests |
| `d5e7dda` | P2 | Recorded that `scaffold-juce` has never had a green run |
| `7716749` | P3 | **Output correctness**: `config` from `apc-mcp.json` was dead (zod's `.default()` shadowed it), `lint(fix=true)` reported success when clang-format failed, both output parsers miscounted, build ignored its own `errorCount`, and `validate` aborted mid-loop on a missing optional validator. 22 new tests |
| `8e259a1` | P4 | **Release engineering**: version had two sources of truth, `npm publish` had `continue-on-error: true`, both Node 18 *and* 20 are EOL, `ship` pushed `main` from any branch, and actions were on mutable tags. 19 new tests |
| `f462446` | P5 | **QA tooling & docs**: added ESLint as the real linter (15 findings, all fixed), removed the dead `findPluginBinaries` param, rewrote the materially-false `SECURITY.md`, corrected `CONTRIBUTING.md`/`README.md`/the FAQ against the code, migrated the orphaned GitLab MR checklist to `.github/pull_request_template.md`, made `index.js` executable, added `npm run smoke` + `npm audit` to CI, and put `server.test.js` on the shared handshaking client. 119 tests |
| `d1a353b` | FUNC-21 | **Artefact discovery**: `validate` could not find any artefact whose `PRODUCT_NAME` differed from its directory name (4 of 6 plausible names), looked for Audio Units in an `AudioUnit/` dir JUCE never creates (it is `AU`), and returned Standalone/LV2 *directories* instead of artefacts. 13 new tests |
| `d1a353b` | feature | **`type="standalone"`**: a JUCE *application* template (`juce_add_gui_app`) with `AudioAppComponent`, built against the verified JUCE 9 API. 147 tests total |
| `728eb7a` | feature | **`type="lv2"`**: a native LV2 plugin — C against the real `lv2/core/lv2.h`, Turtle metadata, `MODULE` library emitted into the bundle layout `validate` scans. Compile-checked against **real** upstream headers in CI, not a stub. 163 tests total |

**Version is `2.0.0`** — `package.json:3` is the only source of truth;
`index.js:26` reads it at startup and `index.js:619` reports it in
`initialize` — because removing `type:'ara'` is a breaking input-schema change
and `engines.node >=22` drops two supported Node majors. It has **not been
published**. `index.js` is now 1142 lines.

**Phases 0–5 are done, and the first `TODO.md` feature (Standalone) is built.**
What remains is:

- **OPS-07** — a human must clear the GitHub billing lock before any CI job can
  validate this work (§7). Nothing above has been through a real CI run.
- **One green `scaffold-juce` run** before `publish` may depend on it (§6, §11).
- **ARA and LV2** from `TODO.md` (§8). ARA is blocked on an external SDK that CI
  would also need.

Everything below is verified against the current tree; line numbers are current
as of the Standalone commit.

---

## 2. Verification baseline — confirm this before changing anything

```bash
npm ci
npm run check      # must exit 0
```

Expected:

```
npm run lint            → eslint . && node --check index.js  → clean (0 problems)
npm test                → # tests 163  # pass 161  # fail 0  # skipped 2
npm run smoke           → smoke-scaffold: PASS (9/9 scaffolded, 0 failures)
npm audit               → ✅ No known vulnerabilities   (0 vulnerabilities)
npm run licenses        → ✅ All distributed dependencies are under an allowed license.
```

`npm run check` chains all five (`quality` = `lint && test`). If `npm test` shows
a different total than 163, a test file was added or removed — check
`git status` before believing any later instruction in this file.

The **2 skips** are the CLAP and LV2 compile checks. Set both env vars and they
become passes, giving **163 / 163 / 0 / 0**:

```bash
git clone --depth 1 https://github.com/free-audio/clap.git /tmp/clap
git clone --depth 1 https://github.com/lv2/lv2.git        /tmp/lv2
export APC_CLAP_INCLUDE=/tmp/clap/include APC_LV2_INCLUDE=/tmp/lv2/include
# and for `npm run smoke -- --configure` on those two families:
export APC_CLAP_DIR=/tmp/clap APC_LV2_DIR=/tmp/lv2/include
```

`tests/cpp-api.test.js` has a guard test per header set, so a silent skip cannot
read as a pass.

ESLint is a **hard gate** as of Phase 5. `npm run lint` returning non-zero means
`npm run check` fails, which means `scripts/ship.mjs` refuses to release.

The **2 skips** are the CLAP compile checks in `tests/cpp-api.test.js`, which
need real CLAP headers. To run them at full strength:

```bash
git clone --depth 1 https://github.com/free-audio/clap.git /tmp/clap
APC_CLAP_INCLUDE=/tmp/clap/include node --test tests/cpp-api.test.js
# expect: # tests 6  # pass 6  # fail 0  # skipped 0
```

If any of that is not green, stop and fix it before adding work — otherwise you
cannot tell your regressions from pre-existing ones.

---

## 3. Environment limits — verified, do not re-litigate

These cost hours to establish. **Do not retry the things marked ✗.**

| Tool | Status | Notes |
|---|---|---|
| `cmake` | ✗ **unobtainable** | `apt-get` is broken (`deb.debian.org` unreachable → "Unable to locate package"). `@xpack-dev-tools/cmake` on npm is a *metadata stub* — xpm downloads the real binary on demand from blocked hosts. `-linux-x64`/`-arm64` variants don't exist. `cmake-js`/`node-cmake`/`cmake-ts` all need a pre-installed cmake. GitHub release-asset redirects die with `curl: (35) SSL_ERROR_SYSCALL`. |
| `g++` / `gcc` | ✅ available | `/usr/bin/g++`. C++20. This is why `tests/cpp-api.test.js` can exist. |
| `git clone` | ✅ works | How JUCE and clap ground truth were obtained. |
| npm registry | ✅ works | `npm ci`, `npm audit`, `npx --yes js-yaml` all fine. |
| `clang-format`, `ctest`, `pluginval`, `clap-validator`, ESLint | ✗ absent | Tool-dependent tests use PATH shims (fake executables in `os.tmpdir()`). Follow that pattern. |
| `pyyaml` | ✗ absent | Validate workflow YAML with `npx --yes js-yaml .github/workflows/publish.yml` instead. |
| `file` | ✗ absent | Detect CRLF with `grep -cU $'\r' file`. |
| GitHub Actions | ✗ **locked for billing** | See §7 / OPS-07. **No CI job in this repo can start.** |

### `/tmp` is ephemeral

`/tmp/JUCE`, `/tmp/clap-probe` and `/tmp/juce-stub` were the ground truth during
the audit and **will not survive into your session**. Re-create them:

```bash
git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git /tmp/JUCE   # ~129 MB
git clone --depth 1 https://github.com/free-audio/clap.git /tmp/clap
```

Files worth knowing in the JUCE checkout:

- `extras/Build/CMake/JUCEUtils.cmake` — every `juce_add_*` keyword that actually exists
- `examples/CMake/AudioPlugin/CMakeLists.txt` — canonical plugin CMake
- `examples/Plugins/WebViewPluginDemo.h` — **the** model for a webview plugin editor
- `modules/juce_gui_extra/misc/juce_WebBrowserComponent.h` — `Resource`, `ResourceProvider`, `Options`
- `modules/juce_audio_processors_headless/` — note `AudioProcessor` / `AudioParameterFloat` moved here in JUCE 9

Two gotchas when grepping JUCE:

1. **Sources are CRLF.** Pipe through `tr -d '\r'` before comparing.
2. **JUCE style puts a space before `(`** (`float get () const noexcept`), so
   `grep "float get()"` gives a *false negative*. Use loose patterns or dump a
   line range with `sed -n 'A,Bp'`.

The committed stub `tests/fixtures/juce-api-stub/JuceHeader.h` already
transcribes the API surface the templates use, with each signature annotated by
source header. Extend it rather than re-deriving from scratch.

---

## 4. Test and script layout

```
tests/helpers/mcp-client.mjs   shared MCP stdio client: rpc(), call(), listTools(),
                               initializeInfo() — spawns index.js, does the full
                               initialize handshake, advances on responses (no fixed
                               timers). ALL THREE test files that talk to the server
                               use this; do not hand-roll another client.
tests/server.test.js      12   happy-path coverage. Was 11 with its own
                               hand-rolled client that SKIPPED the handshake;
                               moved onto the shared client in Phase 5
tests/artefacts.test.js   13   build-artefact discovery against JUCE's real
                               layout: PRODUCT_NAME != directory name, the AU
                               (not AudioUnit) directory, .app/.exe/extension-less
                               Standalone binaries, LV2 bundles (FUNC-21)
tests/tool-output.test.js 22   config precedence, failure reporting, and the
                               build/test output parsers (Phase 3)
tests/release.test.js     19   version single-sourcing, no continue-on-error,
                               SHA-pinned actions, no EOL Node, ship guards (Phase 4)
tests/security.test.js    30   NEGATIVE tests: traversal PoCs, metacharacter
                               rejection, missing-toolchain messages, bogus paths
tests/templates.test.js   58   structural checks over the *generated project*;
                               needs no cmake/JUCE/CLAP/LV2. Includes a 14-test
                               suite for the standalone app template and a
                               14-test suite for the native LV2 template.
tests/cpp-api.test.js      9   real gcc/g++/clang -fsyntax-only over generated C
                               and C++, driven by a per-family table (juce / clap
                               / lv2) with its own header guard test each
tests/fixtures/juce-api-stub/JuceHeader.h   the JUCE 9 API stub (test fixture,
                                            NOT shipped — package.json "files"
                                            is ["index.js","templates/"])
scripts/smoke-scaffold.mjs      npm run smoke / smoke:configure
scripts/ship.mjs                npm run ship — guarded tag + push
scripts/check-licenses.mjs      npm run licenses (zero-dep license gate)
eslint.config.js                npm run lint — flat config, explicit Node/browser
                                globals (no `globals` dep), and a ban on importing
                                exec/execSync
```

**Total: 163 tests** (12 server + 13 artefacts + 30 security + 58 templates +
9 cpp-api + 22 tool-output + 19 release).

Both `tests/templates.test.js` and `tests/artefacts.test.js` have a
comment-stripping helper (`cmakeCode()` / `cppCode()`). **Use them.** The templates
explain in comments which removed or inapplicable APIs they avoid —
`START_JUCE_APPLICATION`, `start()`, `stop()`, `juce_add_plugin`, `FORMATS`,
`loadHTMLString` — so a raw-text assertion cannot tell an explanation from a call.
Two separate assertions have already been wrong this way.

`npm test` is bare `node --test` (auto-discovery), so a new `tests/*.test.js`
file is picked up with no `package.json` edit. **Note `node --test tests/` fails
on Node 22** — it treats the arg as a module path. Use bare `node --test`.

### The methodology that works here

Every fix in P1/P2 was done **red → green**:

1. Write the test that encodes the defect. Run it. **Confirm it fails**, and
   confirm it fails for the reason you think.
2. Fix the code.
3. Re-run the whole suite.

Step 1 is not optional. The original suite passed 11/11 while the templates were
completely broken, because it only asserted that a tool's reply *mentioned* a
filename. A control with no negative test is not a control.

Where a whole class of bug was fixed, the test was also run against the
**pre-fix** code in a throwaway worktree to prove it has teeth. The red-phase
results actually observed, so you know what "has teeth" meant here:

| Suite | Red result at the pre-fix commit |
|---|---|
| `templates.test.js` | 25 of 30 failed (P2) |
| `tool-output.test.js` | 13 of 22 failed (P3) |
| `release.test.js` | 11 of 19 failed (P4) |
| `server.test.js` `statusError` test | 1 failed with `entry: {"name":"Broken"}` (P5) |

The pattern:

```bash
git worktree add /tmp/red HEAD~1
cp -r tests/helpers tests/templates.test.js /tmp/red/tests/   # mind the subdirectory!
ln -s "$PWD/node_modules" /tmp/red/node_modules
cd /tmp/red && node --test tests/templates.test.js            # 25 of 30 failed
```

Do the same for P3: the parser fixes should fail against today's code first.

---

## 5. Phase 3 — DONE (output correctness)

Kept here as a record of what changed and why, so the behaviour is not
"cleaned up" back into a bug by someone who did not see the original.

| ID | Where | What it did | What it does now |
|---|---|---|---|
| **FUNC-06** | `index.js` × 4 `config` schemas | zod `.default('Debug')` fired whenever the caller omitted `config`, so `params.config || cfg.config` never reached the project file — `config` in `apc-mcp.json` was dead. Proven: cmake got `-DCMAKE_BUILD_TYPE=Debug` with `"config": "Release"` on disk. | `.optional()`, resolved as `params.config ?? cfg.config ?? 'Debug'`; precedence documented in each `.describe()`. |
| **QA-01** | `audio_plugin_lint` | The `fix=true` path never inspected clang-format's exit status, so a failing formatter reported "No formatting issues" *after* being handed `-i`. | Explicit failure branch: `isError: true`, file count, and a warning that files may be partially reformatted. |
| **QA-02** | `parseTestOutput` | Word-counted `Passed`/`Failed`, so ctest's own summary line counted as an extra pass *and* fail: a clean 3/0/3 reported as **4/1/5**. The `/^tests? (\d+)/im` total never matched ctest at all. | Uses ctest's `N% tests passed, M tests failed out of T` summary; falls back to per-test result lines; returns `recognized: false` rather than inventing numbers, and the handler then prints `unknown` plus the raw tail. |
| **QA-03/04** | `parseBuildOutput` | Errors matched only `: error:` / `: error\d*\s*\(`, so MSVC's `error C2065:` was missed. The warning test `/^.*warning:/` was literally equivalent to `includes('warning:')`, counting any line with that substring — including source lines the compiler echoes under a diagnostic. | Four anchored shapes: clang/gcc `file:line[:col]: severity:`, MSVC `file(line): severity C####:`, `CMake Error\|Warning`, tool-prefixed `ld: error:`. `note`/`remark` are treated as context, not diagnostics. |
| **QA-07** *(new)* | build handler | `trySpawn` returns stdout as `output` and stderr separately, but only `r.output` was parsed. Compilers write diagnostics to **stderr**, so `### Errors` was empty precisely on failing builds. | Parses `output + stderr`. Found while writing these tests; not in the original 34. |
| **HYG-12** | build handler | Computed and printed `Errors: N`, then set `isError: !r.ok` and ignored it. | `isError: !r.ok || parsed.errorCount > 0`. |
| **QA-06** | `audio_plugin_validate` | Discarded `checkOptionalTool()`'s return, then called `requireTool()` *inside* the results loop — a missing optional validator threw away every result already computed. | Availability checked once up front; missing validators produce a `SKIPPED` entry with an install hint, and `isError` is true whenever validation is incomplete. |
| **HYG-03** | `audio_plugin_validate` | `validateCommand` / `clapValidatorCommand` were schema-validated and then ignored in favour of hardcoded names. | Now honoured — closed as a side effect of QA-06. |

**Note on testing these:** the parsers look like pure functions but are *not*
unit-testable in isolation, because importing `index.js` starts the MCP server.
Test them through the tool interface with PATH shims — which is better anyway,
since it also covers how the handlers *use* the parsed result (that is how QA-07
and HYG-12 surfaced).

**Shim trap that cost time:** a shim on a `PATH` containing only the fake bin dir
cannot run `cat`, so it silently produced no output and tests passed or failed for
the wrong reason. `tests/tool-output.test.js` appends a minimal `/usr/bin:/bin`,
deliberately *not* `process.env.PATH` — `pluginval` and `clap-validator` are exactly
what an audio developer has installed, and QA-06 depends on one being genuinely
absent.

## 6. Phases 4 and 5 — DONE (release engineering; QA tooling & docs)

19 tests in `tests/release.test.js`; 11 of them fail against the pre-Phase-4 repo.

| ID | What it did | What it does now |
|---|---|---|
| **OPS-02** | `npm publish --provenance` had `continue-on-error: true`, so a rejected or partial publish left CI green while the tag looked released. | Removed. A publish failure is a red run. |
| **OPS-03** | Version hardcoded in `package.json` *and* `index.js`; `CONTRIBUTING.md`'s checklist mentioned only the former, so drift was guaranteed. | `index.js` reads `package.json` at startup (npm always includes it in the tarball regardless of `files`), falling back to `0.0.0-unknown` if run detached. Verified live: `initialize` returns the file's version. |
| **OPS-04** | `engines: >=18` and a `[18, 20, 22]` matrix. | `engines: >=22`, matrix `[22, 24]`, single-version jobs on 24. **The audit's own advice was stale** — it said "drop 18", but Node 20 *also* hit EOL on 2026-04-30. Re-check the release schedule before trusting any EOL claim, including this one. |
| **OPS-05** | `ship` ran `git tag … && git push origin main --tags` from whatever branch you were on, tagging a commit `main` did not contain. | `scripts/ship.mjs`: runs `npm run check` itself, then refuses with a specific reason unless HEAD is `main`, the tree is clean, the tag is absent, and `CHANGELOG.md` has a `## [<version>]` heading rather than `[Unreleased]`. `--dry-run` exercises every guard without changing anything; `--branch=<name>` is the explicit escape hatch. |
| **OPS-06** | Actions on mutable `@v7` / `@v4` tags. | Pinned to 40-char commit SHAs, re-verified with `git ls-remote`. **Trap:** `github/codeql-action@v4` is an *annotated* tag — `7999b86c…` is the tag **object**, and GitHub resolves `uses:` to a commit, so the peeled `2892aa5e…` is the value that works. `checkout@v7` and `setup-node@v7` are lightweight tags, so their SHAs are already commits. Always check for a `^{}` peeled line before pinning. |
| **HYG-11** | `index.js` was mode 644 despite its shebang (npm chmods on publish, so the `bin` worked but `./index.js` did not). | Mode 755, executable bit recorded in git. |
| — | Nothing in CI gated on `npm audit`; the scaffold smoke test ran only locally. | `test` job now runs `npm run smoke` and `npm audit --audit-level=high`. |

### Phase 5 — hygiene — DONE

| ID | What it was | What it is now |
|---|---|---|
| **HYG-04** | No ESLint. `npm run lint` was `node --check index.js`, which only proves the file parses — so a dead parameter and a silent `catch` survived review. | `eslint@10` + `@eslint/js` (devDeps, both allowlisted licenses). Flat config in `eslint.config.js` with **explicit** Node/browser globals, so no `globals` package is needed. Rules: `no-unused-vars`, `no-useless-escape`, `no-empty` (empty catch **not** allowed), `eqeqeq`, `prefer-const`, `no-var`, plus `no-restricted-properties`/`no-restricted-syntax` banning `exec`/`execSync` — the shell-invoking APIs SECURITY.md exists to avoid. `spawn`/`spawnSync` stay allowed; they take argv arrays. `lint` = `eslint . && node --check index.js`; `quality` = `lint && test`, so `npm run check` and CI both lint. **First run: 15 errors, all fixed, re-run clean.** |
| **HYG-02** | `findPluginBinaries(projectPath, config, buildDir, formats)` — `projectPath` never used. | Param removed; the single call site updated. ESLint's `no-unused-vars` now prevents a recurrence. (The function was later rewritten for FUNC-21 and now lives at `index.js:524`, called from `:954`.) |
| **HYG-07** | `tests/server.test.js` did `result.result.content[0].text` throughout — a shape change threw a `TypeError` instead of failing an assertion. | Every access optional-chained, with the actual response in the assertion message. `JSON.parse` wrapped so a non-JSON reply fails with the payload shown. |
| **HYG-06** | The same file carried its own stdio client that **sent `tools/list` and `tools/call` with no `initialize` handshake** — it never exercised the path a real MCP client takes. | Rewritten onto `tests/helpers/mcp-client.mjs`, which handshakes. Fixtures moved to `os.tmpdir()`. 11 → **12 tests**, with more assertions than before. |
| **HYG-10** | `SECURITY.md` was **materially false** — see the list below. | Fully rewritten against the current code. |
| **HYG-10b** | README Node badge `18+`; FAQ quoted a shell-style `command not found: cmake` the server has not produced since P3; `type`/`ui` undocumented; structure tree missing `templates/juce-webview/`, all the scripts and all but one test file. | Badge `node-22+`. All three `type` values tabulated (incl. that `vst3` is a JUCE alias setting `FORMATS VST3`) and `ui="generic"\|"webview"` documented with the bridge contract. FAQ now quotes the **real** message, verified by running the server: `'cmake' not found on PATH (needed for build/configure).` + the install hint — and explains the 2.0.0 honest-failure change. Tree complete. **The CI badge still points at `main` and is red for billing reasons** — left deliberately; the README's status note explains it. Revisit once OPS-07 is cleared. |
| — | `.gitlab/merge_request_templates/Default.md`, orphaned since P0 deleted `.gitlab-ci.yml`. GitHub never reads it, so the checklist was invisible. | `git rm -r .gitlab`; its useful items migrated into a real `.github/pull_request_template.md`. |
| — | Neither `npm run smoke` nor `npm audit` ran in CI, so a scaffold regression or a vulnerable dependency could be published unnoticed. | Both added to `publish.yml`'s `test` job; YAML re-validated with `npx --yes js-yaml`. |
| — | `audio_plugin_plugins` silently swallowed a malformed `status.json` (`try { … } catch {}`), so the user saw a plugin with no type and no reason. | Reports `statusError` on that entry and still lists the plugin. **New test, proven red** against the pre-change code. |
| ✅ HYG-03 (P3) · HYG-05 (P2) · HYG-11 (P4) | | Already closed before Phase 5. |

**What ESLint actually caught in `index.js`** — worth knowing before you assume the
config is decorative:

- Two useless escapes inside `SAFE_OPTIONS` (`index.js:44`) and `SAFE_PATH`
  (`index.js:56`). **These are the security allowlists.** Before removing a
  backslash from a regex that gates shell metacharacters, both were compared to
  their cleaned forms over **65,536 probe strings** (every code point below U+2000,
  alone and embedded in a valid token): 0 behavioural differences. Do the same if
  you ever touch them — and if you do, `tests/security.test.js` has 10
  metacharacter-rejection cases that must stay green.
- The empty `catch` above (`index.js` ~:825).
- `stripAnsi`'s `\x1B` control character, flagged by `no-control-regex`. That one is
  **correct and intentional** — stripping ANSI SGR codes is the whole point — so it
  carries an `eslint-disable-next-line` with the reason rather than being "fixed".

**`SECURITY.md` was false in six separate ways.** If you inherit a security doc from
an earlier phase, assume nothing in it is current:

1. Called `0.1.0` the current version and described "17 tests, 6 findings" (reality at the time of the rewrite: 2.0.0, 119 tests, 35 findings — now 147 tests and 36 findings with FUNC-21).
2. Claimed layer 3 did `path.resolve()` + `realpathSync` checks — **neither call existed**. The real guard is `assertWithinProject` (`index.js:75`) with `hasDotDot` (`:66`) plus the zod regexes.
3. Claimed `validatePath()` "rejects non-alphanumeric path components" — never true; `SAFE_PATH` permits `.`, and that permissiveness *was* SEC-01.
4. Listed dependency versions that had all been superseded.
5. Asserted *"no residual risk of arbitrary file read/write"* — untrue. The guard allowlists paths **within** the project boundary, so everything inside it is writable by design. The doc now says so.
6. Recorded SEC-01 as "fixed in 0.3.0". The lint path traversal was closed in this cycle, so **1.4.0 and 1.5.0 as published on npm are still vulnerable** — the rewrite leads with an upgrade notice saying exactly that.


---

## 7. 🔴 OPS-07 — the blocker nobody can fix from code

**Every GitHub Actions job in this repo fails in 2–4 seconds** with:

> *The job was not started because your account is locked due to a billing issue.*

Evidence (`gh run view`): scheduled CodeQL run `37174821386` (2d) and Dependabot
PR CI run `36765350429` (5d) — all three matrix legs of `test` failed instantly
with that annotation and `publish` was skipped.

**This needs a human to resolve billing.** Until then:

- No CI claim in `AUDIT.md` or the `CHANGELOG.md` can be validated.
- The red X's on `main` are **not** a code regression. Don't chase them.
- `scaffold-juce` — the only job that can prove a scaffolded JUCE plugin really
  configures against real JUCE — has never run. Its apt package list
  (`libwebkit2gtk-4.1-dev` etc.) is JUCE's documented Linux deps for
  **ubuntu-24.04**, unverified.
- `CI` triggers only on `push` to `main`, on `v*` tags, and on `pull_request`
  targeting `main`. **Pushing a feature branch runs nothing** — validation
  requires opening a PR.
- ⚠️ **`ubuntu-latest` becomes Ubuntu 26 on 2026-10-19**
  ([runner-images#14748](https://github.com/actions/runner-images/issues/14748)).
  That may rename the apt packages `scaffold-juce` installs. On the first real
  run, check them and pin the job to `ubuntu-24.04` if needed.
- GitHub also reports **24 vulnerabilities on the default branch** (7 high /
  16 moderate / 1 low). That is `main`'s committed lockfile. SEC-02 fixed it on
  this branch, where `npm audit` reports 0. Different refs, not a regression.

---

## 8. Product scope (`TODO.md`) — Standalone ✅ and LV2 ✅ done; ARA is the last one

The audit fixed what existed; these features were never built. `TODO.md` carries
the detail and the verified CMake/C++ facts for each.

1. **Standalone — ✅ DONE.** Two separate pieces, both landed:
   - **A new `templates/standalone/`** for `type="standalone"`: a JUCE
     *application* via `juce_add_gui_app()` (one executable owning its audio
     device), not a plugin. `Source/Main.cpp` is a `JUCEApplication` +
     `DocumentWindow` with `START_JUCE_APPLICATION()`; `Source/MainComponent.{h,cpp}`
     is an `AudioAppComponent` sine generator with a level slider.
   - **Artefact discovery fixed (FUNC-21)** — `findPluginBinaries()` could not
     locate Standalone artefacts (it returned the format *directory*, not the
     executable), and could not locate *any* artefact whose `PRODUCT_NAME`
     differed from its directory name, nor Audio Units at all (JUCE's directory is
     `AU`, not `AudioUnit`). See AUDIT §4 and `tests/artefacts.test.js`.

   Two JUCE 9 facts the template encodes and that are easy to get wrong:
   `AudioAppComponent` has **no `start()`/`stop()`** (use `setAudioChannels()` /
   `shutdownAudio()`, the latter mandatory in the destructor or JUCE asserts), and
   `juce_add_gui_app()` accepts **no plugin keywords** — `FORMATS`, `PLUGIN_CODE`
   and `IS_SYNTH` would be silently dropped because there is no
   `UNPARSED_ARGUMENTS` check. `formats` is therefore *rejected* for this type
   rather than ignored.

2. **ARA — not started, and blocked on an external SDK.** Removed from the schema
   in P1 (FUNC-07) because it scaffolded `FORMATS ARA`, which `juce_add_plugin`
   rejects, from a plain `juce::AudioProcessor`. ARA is **not a format**: it is
   `IS_ARA_EFFECT TRUE` alongside a real `FORMATS` list. **There is no
   `juce::ARAAudioProcessor`** (this file and `TODO.md` both claimed there was;
   neither name exists) — the real API is `juce::AudioProcessorARAExtension` for
   the processor, `juce::AudioProcessorEditorARAExtension` for the editor, and an
   `ARADocumentControllerSpecialisation`, with `ARAPlaybackRenderer` /
   `ARAEditorRenderer` / `ARAEditorView` as the roles to implement. It also
   requires `juce_set_ara_sdk_path(<path>)` **before** `juce_add_plugin`, or JUCE
   raises a fatal error — so the template needs an SDK-discovery block like the
   `JUCE_DIR` one, and CI cannot validate it without fetching the SDK. Do not
   re-add the enum value until the template exists.

3. **LV2 — ✅ DONE.** `templates/lv2/` scaffolds a **native** LV2 plugin: pure C
   against `lv2/core/lv2.h`, Turtle metadata, and a `MODULE` library emitted into
   the same `<build>/plugins/<n>/<n>_artefacts/<config>/LV2/<n>.lv2/` bundle
   layout that `findPluginBinaries()` already scans, with the `.ttl` files copied
   in beside the binary. Unrelated to the `LV2` string the JUCE templates emit.

   Unlike the JUCE templates this one is verified against **real** upstream
   headers, not a stub: `tests/cpp-api.test.js` compiles `plugin.c` with a C
   compiler and `-std=c11` when `APC_LV2_INCLUDE` points at an `lv2/lv2`
   checkout's `include/`, and CI clones it. `templates.test.js` adds 14 structural
   tests. A new `scaffold-lv2` CI job configures it with real cmake.

   The invariants that matter, all now enforced: the plugin URI is derived once in
   `index.js` and written into all three files; every `lv2:index`/`lv2:symbol`
   pair in `plugin.ttl` is matched against the enum **and** the `connect_port()`
   switch in `plugin.c`; `rdfs:seeAlso` names a file that exists; `PREFIX ""` and
   `SUFFIX ".so"` pin the filename `manifest.ttl` refers to; the descriptor uses
   designated initialisers; and `description` is escaped for Turtle (`"` and `\`
   are both legal in `SAFE_DESCRIPTION` and either one truncates the literal).

   **The `rdfs:seeAlso` test earned its place immediately** — the first version of
   the template pointed at `<name>.ttl` while shipping `plugin.ttl`, which would
   have made hosts load the plugin with no metadata and report nothing wrong.

`audio_plugin_plugins` and `audio_plugin_validate` both consume
`findPluginBinaries()`. **ARA needs no new layout** — it is `IS_ARA_EFFECT TRUE` on
a normal `juce_add_plugin`, so it produces the usual VST3/AU artefacts and is
already discoverable. If any future template emits something new, add a row to
`ARTEFACT_LAYOUT` (`index.js`) rather than special-casing it in a handler; that
mismatch was FUNC-14, and the suffix-scanning rewrite is what makes it
maintainable now.

**Why LV2 went before ARA, against `TODO.md`'s order:** LV2 could be verified
end to end in this environment — its headers are small, public and header-only,
so `plugin.c` is compiled against the real thing and its CMakeLists is
configure-checked by a job with no apt surface. ARA cannot: its JUCE-side surface
(`ARADocumentControllerSpecialisation`, `ARAPlaybackRenderer`,
`ARAEditorRenderer`, `ARAEditorView`, the model objects) would need a large
extension to `tests/fixtures/juce-api-stub`, and its CMake side needs an external
ARA SDK that CI would also have to fetch. Shipping an unverifiable template is
exactly how this project's worst defects happened, so the verifiable one went
first.


---

## 9. Traps that already cost time

**Shell / Node**

- `node --test tests/` fails on Node 22 → use bare `node --test`.
- Inline `node -e "try{…}catch(e){…}"` hits `SyntaxError: Unexpected token 'catch'`
  under Node 22's TS-eval path → write a heredoc script file instead.
- `set -e` kills multi-case harnesses at the first *correct* non-zero exit → use `;` and capture `$?`.
- `cmd1 && cmd2` silently aborts when `grep -c` returns 0 matches → use `;`.
- `$?` after a pipe is the **last** command's status, not the first. Use `${PIPESTATUS[0]}`.
- Cannot `import index.js` to unit-test its helpers — importing starts the server. Test through stdio JSON-RPC.

**PATH shims**

- A shim whose `PATH` contains *only* the fake bin dir cannot run `cat`, `printf`
  etc., so it silently produces no output and tests then pass or fail for the wrong
  reason. Append a minimal `/usr/bin:/bin`.
- Do **not** append `process.env.PATH` for the validator shims: `pluginval` and
  `clap-validator` are exactly what an audio developer has installed, and the
  missing-validator tests depend on one being genuinely absent.
- `audio_plugin_build` auto-configures when `build/CMakeCache.txt` is missing and
  returns early if that fails, so a shim's non-zero exit code gets consumed by the
  *configure* step. Plant a stub cache when testing the `--build` invocation.

**Assertions**

- Don't put `..` rejection in the zod schema: schema failures surface as opaque
  protocol errors with empty text. Validate in the handler so the user gets a
  readable `isError`.
- Don't assert a *specific* error mode for escaping config values — the per-key
  validators **sanitize**. Assert the invariant (nothing written outside the root).
- Lint-rejection wording must contain one of `escape|outside|traversal|rejected|invalid` (existing tests depend on it).
- Placeholder sweeps must use `/\{\{[^}]*\}\}/g`. `{{[A-Z_]*}}` **missed
  `{{#WEBVIEW}}`** and produced a false negative during the audit.
- `findBinary` via `spawnSync('which', …)` would make missing-toolchain tests
  depend on `which` being present. Scan `PATH` in JS instead (that's what the fix does).
- Rejecting `..` in `projectPath` would break legitimate `../my-project` roots —
  the boundary check is what matters, not the literal segment.

**JUCE / CMake**

- `juce_add_plugin` has **no unparsed-argument check** — unknown keywords are
  silently dropped, never reported. That is how `COPYRIGHT` and `BINARY_DATA_ID`
  survived two releases. Check every keyword against `JUCEUtils.cmake`.
- `juce_add_plugin` defaults `PLUGIN_CODE` to a **random** four-char code.
  Anything relying on the default is non-reproducible.
- Valid `FORMATS`: `AU AUv3 AAX LV2 Standalone Unity VST VST3`. There is no `ARA`.
- `juce_add_binary_data` takes only `NAMESPACE`, `HEADER_NAME`, `SOURCES`.
  Symbol names are the filename with non-identifier chars → `_`
  (`Source/UI/index.html` → `<NS>::index_html` / `index_html_size`).
- JUCE 9 has **no** `WebBrowserComponent::loadHTMLString`, no `onPageAboutToLoad`
  member (`pageAboutToLoad()` is *virtual* — subclass it), and
  `XmlDocument::storeXmlAsString` does not exist anywhere in JUCE 9.
- free-audio/clap exports a plain INTERFACE target named `clap` via
  `clap-config.cmake` — **no `CLAP::` namespace**. And the entry is the symbol
  `clap_entry`, reached through `get_factory(CLAP_PLUGIN_FACTORY_ID)`.

---

**Docs & tooling** *(learned in Phase 5)*

- **Tool output is JSON-escaped, so backslash counts lie.** `sed`/`grep` output
  returned through the harness arrives as a JSON string, where one literal
  backslash is shown as two. `index.js:44` *looked* like `\\/` but was really
  `\/`. Before editing any regex — especially a security allowlist — print
  `JSON.stringify(line)` or count in Node, never by eye.
- **Never edit a security regex on the strength of a linter's opinion.** ESLint said
  the escape was useless; the proof was 65,536 probe strings showing 0 behavioural
  differences between the old and new forms. `no-useless-escape` is right about
  syntax, not about your threat model.
- **The empty `catch {}` blocks in `tests/helpers/mcp-client.mjs` and
  `scripts/smoke-scaffold.mjs` are deliberate.** ESLint's `no-empty` flags them;
  the fix is a comment saying why (`/* server gone */`), not deleting the `try`.
  Deleting it turns "the process already exited" into an unhandled rejection.
- **An inherited security/threat doc is a liability, not an asset.** `SECURITY.md`
  described defences that did not exist and version numbers three releases behind.
  If you touch it, re-derive every claim from source and cite file:line — that is
  what makes the next person able to check it.
- **`CHANGELOG.md` has two `### Added` sections** (Unreleased and 1.5.0), so a
  scripted `assert s.count(anchor)==1` fails. Split the file at `## [1.5.0]` and
  edit only the head, then assert the history marker is still present.
- **Line-number citations drift.** `AUDIT.md`, `HANDOFF.md` and `SECURITY.md` all
  cite `file:line`, and a single function rewrite moved three of `SECURITY.md`'s
  references by ~70 lines. Every citation pairs the line with a *symbol name*
  (`assertWithinProject()` — `index.js:75`) precisely so a stale number is still
  findable — but after any edit that changes file length, re-derive the numbers
  rather than trusting them. `node -e` over `fs.readFileSync(...).split('\n')` with
  a regex per symbol is the fast way.
- **`npm run lint` is now a release gate.** `scripts/ship.mjs` runs `npm run check`,
  which runs `quality` = `lint && test`. An ESLint error blocks the release, not
  just CI.


## 10. Verified correct — do not "fix" these

Checked during the audit and found sound:

- `audio_plugin_validate`'s behaviour on a project with no built artefacts
  (reports 2 expected artefacts, `0 passed, 2 failed`, `isError: true`) — correct.
- `configure`'s argv/options splitting: `-DFOO=ON -DBAR=OFF` becomes separate
  argv entries with no shell involvement — no injection.
- `tools/list` returns all 7 tools with full `describe()` text.
- Packaging: `npm pack` yields 19 files; no `tests/` or `scripts/` leak (the
  stub fixture is not shipped). npm chmods the bin 644 → 755 on publish.
- `checkPluginPath()` in `create`.
- The layer-1 zod metacharacter regexes (10/10 rejection cases pass).
- `.editorconfig` compliance across the repo.
- `LV2` as a default JUCE format — valid in JUCE 9.
- `templates/juce-webview/Source/UI/app.js`'s contract
  (`window.updateState(array)`, JS→C++ via `apc://callback?action=…`) — the
  rewritten C++ matches it exactly.
- `juce::ParameterID` implicitly converts from string-like types, so
  `AudioParameterFloat("gain", …)` compiles. Not a bug.

---

## 11. Shipping 2.0.0

Do not publish until:

1. ✅ **Phases 3–5 complete, plus the Standalone feature and FUNC-21.**
   `npm run check` exits 0: ESLint clean, 163 tests / 161 pass / 0 fail / 2 skip,
   smoke 9/9, `npm audit` 0 vulnerabilities, license gate PASS. With
   `APC_CLAP_INCLUDE` and `APC_LV2_INCLUDE` pointing at real checkouts the 2 skips
   become passes (163 / 163 / 0 skip). Re-verified after `npm ci` from an empty `node_modules`,
   and by installing the packed tarball into a clean prefix and scaffolding a
   standalone app through `node_modules/.bin/apc-mcp`.
2. ☐ **Billing resolved** and a PR opened so all six CI jobs get a real run.
3. ☐ `scaffold-juce` has had **one green run** → add it to `publish.needs`.
4. ☐ `scaffold-juce`'s apt packages re-checked against whatever
   `ubuntu-latest` is by then; pin to `ubuntu-24.04` if they moved.
5. ✅ `OPS-02` fixed — `continue-on-error` is gone and a test now asserts no
   workflow step reintroduces it.
6. ✅ `README.md` and `SECURITY.md` are accurate. The only ARA text left in the
   README is the deliberate "removed in 2.0.0" note explaining why; `SECURITY.md`
   was rewritten in Phase 5 and every claim in it cites file:line.
6b. ☐ **The `scaffold-*` CI jobs still have never run**, so `cmake -B build` on a
   generated project is unproven (AUDIT Phase 6, item 41). Until item 2 clears, that
   is the largest untested assumption in the release. The installed-tarball path *is*
   proven: `npm pack` → clean install → `node_modules/.bin/apc-mcp` answers
   `initialize` with version 2.0.0 and lists 7 tools, and a `type=juce ui=webview`
   scaffold from the *installed* package produced all 9 files with `FORMATS VST3;AU`,
   `NEEDS_WEB_BROWSER`, zero unsubstituted placeholders and the three UI assets.
7. ☐ `CHANGELOG.md` `## [Unreleased] — 2.0.0` renamed to a dated `## [2.0.0] — <date>`
   heading. **`scripts/ship.mjs` refuses to release until this is done** — that guard
   is the reason the step cannot be forgotten.
8. ☐ Tag `v2.0.0` (the workflow publishes on `v*` tags).

`AUDIT.md` is committed here deliberately. It documents a path-traversal
exploit against the *published* 1.5.0; that is acceptable because the same
detail is already public in the P1 commit message, the `CHANGELOG.md`, and the
runnable PoCs in `tests/security.test.js` — and 1.5.0's `index.js` is readable
by anyone via npm. If 2.0.0 is delayed significantly, revisit whether to keep
§2's PoC block public before the patched version is installable.

---

## 12. Quick start for the next session

```bash
cd /home/user/apc-mcp                 # or wherever the checkout lives
git status                            # should be clean except nothing
npm ci
npm run check                         # confirm the §2 baseline

# ground truth for any template work
git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git /tmp/JUCE
git clone --depth 1 https://github.com/free-audio/clap.git /tmp/clap
git clone --depth 1 https://github.com/lv2/lv2.git /tmp/lv2
export APC_CLAP_INCLUDE=/tmp/clap/include APC_LV2_INCLUDE=/tmp/lv2/include
export APC_CLAP_DIR=/tmp/clap APC_LV2_DIR=/tmp/lv2/include APC_JUCE_DIR=/tmp/JUCE

# Phases 3, 4 and 5 are DONE — §5 and §6 record what they changed.
# Next, in order:
#   §7  OPS-07 — a human must clear the GitHub billing lock; nothing validates
#                in CI until then
#   §11 the 2.0.0 release checklist (items 2, 3, 4, 6b, 7, 8 are still open)
#   §8  the unbuilt TODO.md feature scope: Standalone → ARA → LV2
# Whatever you pick: write the failing test first, and prove it fails against the
# pre-change code in a throwaway worktree (§4 has the command).
```
