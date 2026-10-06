# HANDOFF — apc-mcp completion guide

**For:** whoever picks this project up next (human or agent).
**Written:** 2026-10-05, on branch `arena/353ee88c-apc-mcp`.
**Read this first.** It contains the current state, the verified environment
limits, the exact remaining work with file:line references, and the traps that
cost the most time to discover. `AUDIT.md` has the full findings and evidence;
this file is the operating manual.

---

## 1. Where the project stands

`apc-mcp` is an MCP server (`index.js`, 902 lines, zero-dep beyond
`@modelcontextprotocol/sdk` + `zod`) exposing 7 tools for audio-plugin work:
`create`, `configure`, `build`, `test`, `lint`, `validate`, `plugins`. It ships
CMake/C++ scaffold templates under `templates/` for `clap`, `juce` and `vst3`,
each with `generic` or `webview` UI.

A full audit found **35 defects**. Phases 0–2 are **done, committed and pushed**:

| Commit | Phase | What it did |
|---|---|---|
| `0164482` | P0 | Unblocked release gates: deps `npm audit` 6 → 0, deleted broken `.gitlab-ci.yml`, added `.editorconfig`, wrote the license gate |
| `a52a869` | P1 | Security: closed the critical `audio_plugin_lint` path traversal (arbitrary out-of-project write), fixed `findBinary()` always returning true, dead `ENOENT`/timeout handling, unvalidated config loading, removed `type:'ara'`, event-driven test client (126s → 14s), 30 new negative tests |
| `2fb81da` | P2 | **Templates**: the scaffold output could not configure or compile at all. Rewrote all three CMakeLists and the whole `juce-webview` + `clap` C++ layer against verified JUCE 9 / CLAP APIs. 36 new tests |
| `d5e7dda` | P2 | Recorded that `scaffold-juce` has never had a green run |
| `7716749` | P3 | **Output correctness**: `config` from `apc-mcp.json` was dead (zod's `.default()` shadowed it), `lint(fix=true)` reported success when clang-format failed, both output parsers miscounted, build ignored its own `errorCount`, and `validate` aborted mid-loop on a missing optional validator. 22 new tests |
| *(latest)* | P4 | **Release engineering**: version had two sources of truth, `npm publish` had `continue-on-error: true`, both Node 18 *and* 20 are EOL, `ship` pushed `main` from any branch, and actions were on mutable tags. 19 new tests |

**Version is `2.0.0`** (both `package.json:3` and `index.js:460`) because
removing `type:'ara'` is a breaking input-schema change. It has **not been
published**.

**Phase 5 remains**, plus the unfinished feature scope in `TODO.md`.
Estimated ~1.5 h of focused work. Everything below is verified against the code
as of `d5e7dda`; line numbers are current.

---

## 2. Verification baseline — confirm this before changing anything

```bash
npm ci
npm run check      # must exit 0
```

Expected:

```
node --check index.js   → clean
npm test                → # tests 118  # pass 116  # fail 0  # skipped 2
npm run smoke           → smoke-scaffold: PASS (5/5 scaffolded, 0 failures)
npm audit               → ✅ No known vulnerabilities   (0 vulnerabilities)
npm run licenses        → ✅ All distributed dependencies are under an allowed license.
```

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
tests/helpers/mcp-client.mjs   shared MCP stdio client: rpc(), call(), listTools()
                               spawns index.js, does the full initialize handshake,
                               advances on responses (no fixed timers)
tests/server.test.js      11   original happy-path coverage
tests/tool-output.test.js 22   config precedence, failure reporting, and the
                               build/test output parsers (Phase 3)
tests/release.test.js     19   version single-sourcing, no continue-on-error,
                               SHA-pinned actions, no EOL Node, ship guards (Phase 4)
tests/security.test.js    30   NEGATIVE tests: traversal PoCs, metacharacter
                               rejection, missing-toolchain messages, bogus paths
tests/templates.test.js   30   structural checks over the *generated project*;
                               needs no cmake/JUCE/CLAP
tests/cpp-api.test.js      6   real g++/clang++ -fsyntax-only over generated C++
tests/fixtures/juce-api-stub/JuceHeader.h   the JUCE 9 API stub (test fixture,
                                            NOT shipped — package.json "files"
                                            is ["index.js","templates/"])
scripts/smoke-scaffold.mjs      npm run smoke / smoke:configure
scripts/ship.mjs                npm run ship — guarded tag + push
scripts/check-licenses.mjs      npm run licenses (zero-dep license gate)
```

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
**pre-fix** code in a throwaway worktree to prove it has teeth:

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

## 6. Phase 4 — DONE (release engineering); Phase 5 remains

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

### Phase 5 — hygiene (~1.5 h)

| ID | Location | Defect |
|---|---|---|
| **HYG-02** | `index.js:445` | `findPluginBinaries(projectPath, config, buildDir, formats)` — `projectPath` is never used in the body. |
| ✅ **HYG-03 done in P3** | `audio_plugin_validate` | `validateCommand` / `clapValidatorCommand` are now honoured. |
| **HYG-04** | — | No ESLint config. `npm run lint` is just `node --check`. |
| **HYG-07** | `tests/server.test.js` | Deep property access without optional chaining; a shape change throws instead of failing an assertion. |
| **HYG-10** | `SECURITY.md:23`–`25` | Predates the P1 fixes: claims "`validatePath()` rejects non-alphanumeric path components", which was never true (`SAFE_PATH` permits `.` — that *was* SEC-01) and omits the `assertWithinProject()` boundary check that actually closed it. Rewrite the defence-in-depth table against the current code. |
| **HYG-10b** | `README.md:16` CI badge | The Node badge was corrected to `22+` in P4. The **CI badge still points at `main`**, which is red for billing reasons (OPS-07), so it currently advertises a failure that is not the code's fault. Either leave it and rely on the status note, or point it at the branch once billing is cleared. |
| ✅ done | `README.md:22`, `TODO.md:7` | The stale "and ARA formats" claim and the reference to the non-existent `juce_add_webview_ui()` were corrected while writing this handoff. |
| ✅ **HYG-11 done in P4** | `index.js` | Now mode 755 with the executable bit recorded in git; `./index.js` answers an `initialize` request directly. |
| — | `.gitlab/merge_request_templates/Default.md` | Orphaned since `.gitlab-ci.yml` was deleted in P0. Delete the directory. |
| **HYG-05** | ✅ **done in P2** | `tests/fixtures/test-project/` is now gitignored. |

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

## 8. Unfinished product scope (`TODO.md`)

The audit fixed what exists; these features were never built. Stated order:

1. **Standalone** — smallest lift. `Standalone` is already a valid `FORMATS`
   value in JUCE 9 and the JUCE templates already emit it, so this is mostly a
   dedicated template/UX pass plus `audio_plugin_plugins` support for locating
   standalone binaries (which `findPluginBinaries` at `:361` does not know).
2. **ARA** — removed from the schema in P1 (FUNC-07) because it scaffolded
   `FORMATS ARA`, which `juce_add_plugin` rejects, from a plain
   `juce::AudioProcessor`. ARA is **not a format**: it is `IS_ARA_EFFECT TRUE`
   plus a real `juce::ARAAudioProcessor` / `ARA::Editor` implementation. Do not
   re-add the enum value until a genuine template exists.
3. **LV2** — pure C + a Turtle manifest, no JUCE involved. Largest lift; the
   `LV2` string the JUCE templates emit is JUCE's own LV2 support and is
   unrelated.

`audio_plugin_plugins` and `audio_plugin_validate` will both need extending for
whatever new artefact layouts these introduce — keep them consistent with what
`findPluginBinaries()` scans (this mismatch was FUNC-14).

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

1. ☐ Phases 3–5 complete, `npm run check` green, `npm test` green with
   `APC_CLAP_INCLUDE` set (0 skips).
2. ☐ **Billing resolved** and a PR opened so all six CI jobs get a real run.
3. ☐ `scaffold-juce` has had **one green run** → add it to `publish.needs`.
4. ☐ `scaffold-juce`'s apt packages re-checked against whatever
   `ubuntu-latest` is by then; pin to `ubuntu-24.04` if they moved.
5. ✅ `OPS-02` fixed — `continue-on-error` is gone and a test now asserts no
   workflow step reintroduces it.
6. ☐ `README.md` and `SECURITY.md` no longer claim ARA support or describe
   pre-P1 defences.
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
export APC_CLAP_INCLUDE=/tmp/clap/include APC_CLAP_DIR=/tmp/clap APC_JUCE_DIR=/tmp/JUCE

# then start Phase 5 at §6, red test first (§5 and §6 record what P3/P4 changed)
```
