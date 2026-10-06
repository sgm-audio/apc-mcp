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

**Version is `2.0.0`** (both `package.json:3` and `index.js:460`) because
removing `type:'ara'` is a breaking input-schema change. It has **not been
published**.

**Phases 3, 4 and 5 remain**, plus the unfinished feature scope in `TODO.md`.
Estimated ~4.5 h of focused work. Everything below is verified against the code
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
npm test                → # tests 77  # pass 75  # fail 0  # skipped 2
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
tests/security.test.js    30   NEGATIVE tests: traversal PoCs, metacharacter
                               rejection, missing-toolchain messages, bogus paths
tests/templates.test.js   30   structural checks over the *generated project*;
                               needs no cmake/JUCE/CLAP
tests/cpp-api.test.js      6   real g++/clang++ -fsyntax-only over generated C++
tests/fixtures/juce-api-stub/JuceHeader.h   the JUCE 9 API stub (test fixture,
                                            NOT shipped — package.json "files"
                                            is ["index.js","templates/"])
scripts/smoke-scaffold.mjs      npm run smoke / smoke:configure
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

## 5. Remaining work — Phase 3: output correctness

These are all in `index.js`, all locally testable with PATH shims (no cmake
needed — fake the tool and feed it canned output). **~1.5 h.**

| ID | Location | Defect | Fix |
|---|---|---|---|
| **FUNC-06** | `:487`, `:535`, `:569` (`config: z.enum([...]).default('Debug')`), defaults at `:187`, `CONFIG_SCHEMA` at `:210` | zod's `.default()` fires whenever the caller omits `config`, so `params.config` is *always* set and `cfg.config` from `apc-mcp.json` is dead. **Proven:** with `"config": "Release"` in the config file, cmake still received `-DCMAKE_BUILD_TYPE=Debug`. `generator` is *not* affected (it's `.optional()`). | Make the field `.optional()` and resolve `params.config ?? cfg.config ?? 'Debug'` at each of the three sites. Test: write a config file with `Release`, call with no `config`, assert the shimmed cmake saw `-DCMAKE_BUILD_TYPE=Release`. |
| **QA-01** | `:650`–`:668` | `trySpawn('clang-format', …)` result's exit status is never inspected; a failing clang-format still yields `"No formatting issues in …"` and `isError: false`. | If `r.status !== 0`, return `isError: true` with stderr. Test with a shim that exits 1. |
| **QA-02** | `:335`–`:340` `parseTestOutput` | Word-counts `/\bPassed\b/gi` and `/\bFailed\b/gi` over the whole output, so ctest's own summary prose inflates the numbers. Real ctest output of 3 passed / 0 failed / 3 total is reported as **4 / 1 / 5**. The `/^tests? (\d+)/im` total never matches ctest at all. | Parse ctest's actual summary (`100% tests passed, 0 tests failed out of 3`) and per-test lines (`Test #1: foo ... Passed`). Write the parser against real captured ctest text, not guesses. |
| **QA-03** | `:319` | Error regex is `': error:'` or `/: error\d*\s*\(/`. MSVC emits `Bar.cpp(17): error C2065: …` → unmatched, so 2 real errors report as `Errors: 1`. | Add an `error C\d+:` alternative. |
| **QA-04** | `:321` | `trimmed.match(/^.*warning:/)` is *equivalent* to `includes('warning:')`, so it counts summary prose ("0 warnings") as a warning. | Match compiler-shaped diagnostics only (`file:line:col: warning:` / MSVC `file(line): warning C\d+:`). |
| **QA-06** | `:743`–`:744` | `checkOptionalTool('pluginval')` / `('clap-validator')` return values are **discarded**, then `requireTool` throws *inside* the results loop — so a missing optional validator aborts the whole report after partial output. | Capture the booleans before the loop; report "pluginval not installed — skipped" as a line rather than throwing. |
| **HYG-12** | `:525` | Build sets `isError: !r.ok` and ignores the `parsed.errorCount` it just computed. cmake can exit 0 while the compiler emitted errors. | `isError: !r.ok || parsed.errorCount > 0`. |

---

## 6. Remaining work — Phases 4 and 5

### Phase 4 — release engineering (~1.5 h)

| ID | Location | Defect | Fix |
|---|---|---|---|
| **OPS-02** | `.github/workflows/publish.yml`, publish job | `npm publish --provenance` has **`continue-on-error: true`**. A failed publish reports the workflow green. | Remove it. |
| **OPS-03** | `package.json:3` + `index.js:460` | Version string duplicated; they can silently diverge. | Read it at runtime: `createRequire(import.meta.url)('./package.json').version`. Safe — npm always includes `package.json` in the tarball regardless of `files`. |
| **OPS-04** | `package.json` `engines`, CI matrix `[18,20,22]` | Node 18 went EOL in April 2025. | Drop to `>=20` and remove 18 from the matrix. |
| **OPS-05** | `package.json:23` | `ship` does `git push origin main` unconditionally. | Push the current branch, or require an explicit arg. |
| **OPS-06** | all workflows | Actions pinned to mutable tags. Verified SHAs: `actions/checkout@v7` = `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node@v7` = `820762786026740c76f36085b0efc47a31fe5020`, `github/codeql-action@v4` = `7999b86c43a865dc79d8923397f35af22de63401`. **Re-verify before pinning** — these were resolved in Oct 2026. | Dependabot already manages `github-actions`, so SHA pins stay updated. |
| — | `.github/workflows/publish.yml:133` | `publish.needs` deliberately **excludes** `scaffold-juce` because that job has never run. | Add it once it has one green run. |

### Phase 5 — hygiene (~1.5 h)

| ID | Location | Defect |
|---|---|---|
| **HYG-02** | `index.js:361` | `findPluginBinaries(projectPath, config, buildDir, formats)` — `projectPath` is never used in the body. |
| **HYG-03** | `index.js:191`–`192`, `:214`–`215` | `validateCommand` and `clapValidatorCommand` are accepted and regex-validated config keys that nothing ever reads; the binaries are hardcoded at `:743`–`744`. Either honour them or remove them from the schema. |
| **HYG-04** | — | No ESLint config. `npm run lint` is just `node --check`. |
| **HYG-07** | `tests/server.test.js` | Deep property access without optional chaining; a shape change throws instead of failing an assertion. |
| **HYG-10** | `SECURITY.md:23`–`25` | Predates the P1 fixes: claims "`validatePath()` rejects non-alphanumeric path components", which was never true (`SAFE_PATH` permits `.` — that *was* SEC-01) and omits the `assertWithinProject()` boundary check that actually closed it. Rewrite the defence-in-depth table against the current code. |
| **HYG-10b** | `README.md` badges, `package.json` `engines` | The CI badge points at `main`, which is red for billing reasons (OPS-07), and the Node badge says `18+` while OPS-04 wants `>=20`. Reconcile after OPS-04/OPS-07. |
| ✅ done | `README.md:22`, `TODO.md:7` | The stale "and ARA formats" claim and the reference to the non-existent `juce_add_webview_ui()` were corrected while writing this handoff. |
| **HYG-11** | `index.js` | Mode `644` despite a `#!/usr/bin/env node` shebang. npm chmods it 755 on publish so the `bin` works, but `./index.js` fails locally. `chmod +x`. |
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
5. ☐ `OPS-02` fixed — remove `continue-on-error: true` from `npm publish`.
6. ☐ `README.md` and `SECURITY.md` no longer claim ARA support or describe
   pre-P1 defences.
7. ☐ `CHANGELOG.md` `## [Unreleased] — 2.0.0` renamed to a dated heading.
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

# then start Phase 3 at §5, red test first
```
