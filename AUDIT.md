# apc-mcp — Full Build Audit, QA & Test Report

**Date:** 2026-10-06
**Target:** `sgm-audio/apc-mcp` @ `3e38426` (branch `arena/353ee88c-apc-mcp`)
**Version audited:** 1.5.0
**Environment:** Node v22.22.3, npm 10.9.8, Linux x64
**Native toolchain (cmake/ctest/clang-format/pluginval/clap-validator):** NOT installed — substituted with instrumented fake binaries on `PATH` to exercise real end-to-end code paths.

> ### Status (updated as remediation progresses)
>
> This report is the **audit as run** against `3e38426` / v1.5.0 and is kept as a
> record — the gate table in §1 and the findings below describe the state *at that
> commit*, not the current one. For what has since been fixed and what remains, read
> **[`HANDOFF.md`](HANDOFF.md)**; it is the live document. Phase status:
>
> | Phase | Scope | Status |
> |---|---|---|
> | 0 | Unblock release gates | ✅ complete — `0164482` |
> | 1 | Security | ✅ complete — `a52a869` |
> | 2 | Template correctness | ✅ complete — `2fb81da`, `d5e7dda` |
> | 3 | Parsing & failure reporting | ✅ complete — see §7 Phase 3 |
> | 4 | CI / release engineering | ✅ complete |
> | 5 | QA tooling & docs | ⬜ open (HYG-03/05/11 already closed early) |
> | — | Feature scope (`TODO.md`) | ⬜ open |
>
> Finding counts below are the original 34 plus **QA-07**, discovered while writing
> the Phase 3 tests. Fixed findings are annotated **[FIXED]** in place rather than
> deleted, so the evidence trail survives.

---

## 1. Executive summary

| Gate | Result |
|------|--------|
| `node --check index.js` | ✅ PASS |
| `npm test` (11 tests) | ✅ PASS — 11/11, 0 fail |
| `npm run quality` | ✅ PASS |
| `npm audit` | ❌ **FAIL — 6 vulns (1 critical, 2 high, 3 moderate)** |
| `npm run check` (release gate) | ❌ **FAIL (exit 1)** |
| `npm run security` | ❌ **FAIL (exit 1)** |
| `npm run ship` | ❌ **BLOCKED** (depends on `check`) |
| `npm pack` / tarball install / bin exec | ✅ PASS (npm chmods 644→755, `tools/list` responds) |
| MCP handshake + 7 tools register w/ schemas | ✅ PASS |
| `.editorconfig` compliance (LF, final newline, no tabs/trailing WS) | ✅ PASS |
| GitHub Actions refs (`checkout@v7`, `setup-node@v7`, `codeql-action@v4`) | ✅ all resolve |
| Git tree clean after test run | ✅ PASS |
| GitLab CI config | ❌ **BROKEN — see OPS-01** |
| Template correctness (scaffold output actually builds) | ❌ **BROKEN — see FUNC-01/02/03** |

**Headline:** the *test suite* is green, but the *product* is not. The 11 passing tests cover only 3 of 7 tools and assert almost nothing about correctness of generated output — which is why two release-blocking defects in the scaffold templates and one critical path-traversal vulnerability in `audio_plugin_lint` shipped in 1.4.0/1.5.0 undetected. Both release gates are red.

**34 findings:** 5 blockers, 6 high, 11 medium, 12 low/hygiene.

---

## 2. Findings — Blockers

### SEC-01 · CRITICAL · Path traversal in `audio_plugin_lint` → arbitrary out-of-project file write

`index.js` `SAFE_PATH = /^[a-zA-Z0-9_ \/.:@~-]+$/` permits `.`, so `..` passes. `validatePath()` only regex-checks + `path.resolve()`s — it performs **no boundary check**. The `target` param is joined onto the project root and handed straight to `clang-format -i` when `fix=true`.

**Proven exploit** (project root `/tmp/apc-audit/proj`, victim outside it):

```
call: audio_plugin_lint { projectPath: ".../proj", target: "../victim", fix: true }
→ clang-format INVOKED: -i /tmp/apc-audit/victim/Source/secret.cpp
→ isError: false, text: "No formatting issues in ../victim."
```

`target: '../../../home/user'` was likewise accepted. Any `.cpp/.cc/.cxx/.h/.hpp` file the user can write is reachable and **modifiable in place** by a single tool argument — the exact prompt-injection threat model `SECURITY.md` is written around.

`SECURITY.md` states: *"No residual risk of command execution or arbitrary file read."* and *"Path traversal protection … `checkPluginPath()` ensures writes stay within project boundary."* The boundary guard was added to `audio_plugin_create` in 1.4.0 but **never to `lint`, which is the other write path.** Both statements are currently false.

**Fix:**
```js
function assertWithinProject(root, candidate) {
  const r = path.resolve(root), c = path.resolve(candidate);
  if (c !== r && !c.startsWith(r + path.sep))
    throw new Error(`Path escapes project root — rejected: ${candidate}`);
  return c;
}
// in audio_plugin_lint:
const searchRoot = params.target
  ? assertWithinProject(proj, path.join(proj, params.target))
  : path.resolve(proj);
```
Plus reject `..` at the schema level: `.refine(p => !p.split(/[\\/]/).includes('..'), 'path may not contain ".."')`. Reuse the same guard for `checkPluginPath()`.

---

### FUNC-01 · CRITICAL · Default JUCE scaffold emits syntactically invalid CMake

`templates/juce/CMakeLists.txt` lines 42–47 still contain Mustache **section** tags:

```cmake
{{#WEBVIEW}}
juce_add_webview_ui(${PROJECT_NAME} ...)
{{/WEBVIEW}}
```

`replaceTemplateVars()` does literal `split/join` on the 7 known keys only — it has no concept of sections. `WEBVIEW` is not a supplied var, so the tags survive **verbatim** into the generated file.

**Proven:** scaffolding `type:'juce'` (i.e. `ui:'generic'`, **the default**) produced a `CMakeLists.txt` containing:

```
LEFTOVER PLACEHOLDERS: [ '{{#WEBVIEW}}', '{{/WEBVIEW}}' ]
contains juce_add_webview_ui? true
```

CMake fails to parse `{{#WEBVIEW}}` → **every default JUCE plugin this tool creates cannot be configured.** This is a vestige of the pre-1.5.0 design before `juce-webview` was split into its own template.

Compounding it: the block references `Source/UI/index.html`, which the generic template does not create.

**Fix:** delete lines 42–47 from `templates/juce/CMakeLists.txt` entirely. Add a regression test asserting `!/\{\{[^}]*\}\}/.test(generatedCMake)` for every scaffold permutation.

> Note: `ui:'webview'` uses the separate `juce-webview` template and has **zero** leftover placeholders — that path is clean. The earlier `grep -o '{{[A-Z_]*}}'` audit missed this because `#` and `/` are outside the character class; the correct scan is `{{[^}]*}}`.

---

### FUNC-02 · HIGH · `juce_add_webview_ui()` is not a real JUCE CMake function

Both `templates/juce/CMakeLists.txt:43` and `templates/juce-webview/CMakeLists.txt:39` call `juce_add_webview_ui(...)`. No template defines it, and JUCE does not provide it. The real JUCE API is `juce_add_binary_data()`, and a WebView2 plugin additionally needs `NEEDS_WEBVIEW2 TRUE` on `juce_add_plugin` plus `JUCE_WEB_BROWSER=1` (and `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1` on Windows).

So the **v1.5.0 headline feature** — the WebView UI template — cannot configure either.

**Fix:**
```cmake
juce_add_binary_data({{PLUGIN_ID}}_WebUI SOURCES
    Source/UI/index.html
    Source/UI/style.css
    Source/UI/app.js)

target_link_libraries({{PLUGIN_NAME}} PRIVATE
    {{PLUGIN_ID}}_WebUI
    juce::juce_gui_extra)

target_compile_definitions({{PLUGIN_NAME}} PRIVATE
    JUCE_WEB_BROWSER=1)
```
and add `NEEDS_WEBVIEW2 TRUE` to the `juce_add_plugin()` call.

---

### FUNC-03 · HIGH · JUCE templates use `${PROJECT_NAME}` with no `project()` call

`templates/clap/CMakeLists.txt:2` correctly has `project({{PLUGIN_NAME}} VERSION 1.0.0 LANGUAGES CXX)`.
`templates/juce/CMakeLists.txt` and `templates/juce-webview/CMakeLists.txt` have **no `project()` call** (verified: `grep -c '^project('` → 0) yet use `${PROJECT_NAME}` for the plugin target in 5–6 places each.

Consequence: the plugin target is named after the **parent** project, so (a) scaffolding two plugins into one repo produces a duplicate-target CMake error, and (b) `juce_generate_juce_header(${PROJECT_NAME})` binds to the wrong target. `{{PLUGIN_NAME}}` never appears in either JUCE template — the plugin's own name is absent from its build file.

**Fix:** replace `${PROJECT_NAME}` with `{{PLUGIN_NAME}}` throughout both JUCE templates (and their `target_*` calls), matching the CLAP template's intent.

---

### SEC-02 · HIGH · 6 npm vulnerabilities; both release gates red

```
proxy-addr        2.0.7    critical  ← express@5.2.1
ip-address       10.2.0    high      ← express-rate-limit@8.5.2
fast-uri          3.1.2    high      ← ajv@8.20.0
hono             4.12.25   moderate
@hono/node-server 1.19.14  moderate
qs                6.15.2   moderate  ← express@5.2.1
```

All 6 are **transitive via `@modelcontextprotocol/sdk@1.30.0`** (latest is 1.32.1). `npm run check` → exit 1; `npm run security` → exit 1; therefore `npm run ship` cannot run.

**Mitigating context (important for triage, not a reason to skip):** apc-mcp is **stdio-only** — `index.js` imports just `McpServer` and `StdioServerTransport`. Every vulnerable package lives in the SDK's HTTP/SSE transport surface, which this server never loads. Practical exploitability ≈ nil. Confirming this: `npm pack` + fresh install of the tarball reports **0 vulnerabilities** (no lockfile → npm resolves patched versions). The exposure is confined to this repo's committed `package-lock.json` and to `npm ci` in CI.

All fixes are semver-compatible — `npm audit fix`, no `--force` required.

**Fix:** `npm install @modelcontextprotocol/sdk@^1.32.1 && npm audit fix && npm test`, commit the regenerated lockfile.

---

### OPS-07 · BLOCKER · GitHub Actions cannot run at all — account locked for billing

Found 2026-10-05 while pushing the Phase 2 branch. Every CI job in this repo fails in 2–4 seconds with:

> The job was not started because your account is locked due to a billing issue.

**Evidence** — `gh run list` / `gh run view`:

| Run | Trigger | Age | Result |
|---|---|---|---|
| `37174821386` CodeQL | schedule, `main` | 2d | `analyze` failed in 2s, billing annotation |
| `36765350429` CI | Dependabot PR | 5d | `test (18/20/22)` each failed in 2s, billing annotation; `publish` skipped |
| `36765350404` CodeQL | Dependabot PR | 5d | failed in 3s, billing annotation |

**Why this is a blocker, not hygiene:** §7's remediation plan uses CI as the release gate. `publish` `needs: [test, license, compile-scaffold, scaffold-clap]`, and the Phase 2 `scaffold-juce` job is the *only* check that can prove a scaffolded JUCE plugin configures against real JUCE. None of it can execute. Phase 0–2 fixes are therefore verified **locally only**.

**Consequences:**
1. Nothing here has had a green CI run recently — do not read the failures on `main` as a code regression.
2. `CI` triggers only on `push` to `main`, on `v*` tags, and on `pull_request` targeting `main`. Pushing a feature branch does **not** run it, so validating the new jobs requires opening a PR.
3. GitHub separately reports **24 vulnerabilities on the default branch** (7 high / 16 moderate / 1 low). That is `main`'s committed lockfile; SEC-02 fixed it on this branch, where `npm audit` reports 0. The two numbers describe different refs, not a regression.

**Also flagged on every run:** `ubuntu-latest` migrates to **Ubuntu 26 on 2026-10-19** ([runner-images#14748](https://github.com/actions/runner-images/issues/14748)). The Phase 2 `scaffold-juce` job installs `libwebkit2gtk-4.1-dev` and other packages *by name*; those names must be re-checked on the first real run, and the job pinned to `ubuntu-24.04` if the migration breaks them.

**Action:** resolve billing, then open a PR from `arena/353ee88c-apc-mcp` to get the first green run of all six jobs. Until then every CI-dependent claim in this audit is unverified.

## 3. Findings — High

### FUNC-04 · Prerequisite detection is entirely non-functional

```js
function findBinary(bin) {
  try {
    spawnSync('sh', ['-c', `which "${bin}" ...`], {...});
    _prereqCache.set(bin, true);
    return true;          // ← always reached
  } catch { ... return false; }
}
```

`spawnSync` **does not throw** when the binary is missing — it returns `{ error, status }`. The `catch` is unreachable, so `findBinary()` returns `true` for *every* name, `requireTool()` never throws, and `checkOptionalTool()` always reports "found".

This silently kills the entire 1.3.0 "Prerequisite checking" feature, the `REQUIREMENTS` install-hint table, and the README FAQ.

**Proven:** with `PATH` pointing at an empty directory (no cmake at all), `audio_plugin_build` did **not** report a missing tool — see FUNC-05.

**Fix** (no shell, consistent with the file's stated invariant):
```js
function findBinary(bin) {
  if (_prereqCache.has(bin)) return _prereqCache.get(bin);
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [bin], { encoding: 'utf-8', stdio: 'pipe', timeout: 10_000 });
  const found = !r.error && r.status === 0;
  _prereqCache.set(bin, found);
  return found;
}
```

### FUNC-05 · `trySpawn` ENOENT / timeout handling is dead code → "exit code null"

Same root cause: the `catch (e) { if (e.code === 'ENOENT') ... }` branch never runs, and `result.error` / `result.signal` are **never inspected**.

**Proven** — cmake absent from PATH:
```
audio_plugin_build → isError: true
text: "Configure failed:\nexit code null"
```
Instead of the intended `'cmake' not found.\n  Install: brew install cmake / ...`. A 180s timeout (SIGTERM) degrades to the same "exit code null". This is the single worst UX failure in the tool: every missing-dependency and every timeout becomes an unparseable message for both humans and the calling LLM.

**Fix:**
```js
function trySpawn(cmd, args, opts = {}) {
  const result = spawn(cmd, args, opts);
  if (result.error) {
    if (result.error.code === 'ENOENT') { /* existing REQUIREMENTS install hint */ }
    if (result.error.code === 'ETIMEDOUT' || result.signal === 'SIGTERM')
      return { ok: false, output: result.stdout || '',
               stderr: `'${cmd}' timed out after ${opts.timeout ?? 180}s.` };
    return { ok: false, output: '', stderr: result.error.message };
  }
  const output = result.stdout || '';
  if (result.status === 0) return { ok: true, output };
  return { ok: false, output, stderr: result.stderr || `exit code ${result.status}` };
}
```
(Then remove the now-unneeded `try/catch`.)

### FUNC-06 · `config` from `apc-mcp.json` is dead — zod `.default()` shadows it

Every tool does `const config = params.config || cfg.config`, but the schema declares `config: z.enum([...]).default('Debug')`. The SDK applies the default, so `params.config` is **always** truthy and `cfg.config` is **unreachable** in `build`, `configure`, `test`, and `validate`.

**Proven:** with `apc-mcp.json` = `{"generator":"Ninja","config":"Release",...}`:
```
cmake saw: -B .../build -G Ninja -DCMAKE_BUILD_TYPE=Debug -DFOO=ON -DBAR=OFF
                          ^^^^^^^ generator honoured ✓   ^^^^^ Debug ✗ (config says Release)
```
README documents `"config": "Release"` as a supported per-project key. It has no effect.

**Fix:** change the four schemas to `z.enum(['Debug','Release']).optional()` (drop `.default()`), keeping `params.config ?? cfg.config` in the handler. Do **not** keep both a default and a fallback.

### QA-01 · `audio_plugin_lint(fix=true)` reports success when clang-format fails

The failure branch is guarded by `if (!r.ok && !params.fix)`. With `fix=true` and a non-zero exit, control falls through to the success return.

**Proven:** clang-format exiting 1 →
```
dry-run mode: isError: true  "## Lint found issues …" ✓
fix=true mode: isError: false "No formatting issues found across project." ✗
```
An agent-facing false negative: the LLM is told formatting succeeded when it did not.

**Fix:**
```js
if (!r.ok) {
  if (params.fix) return { content: [{ type: 'text',
      text: `## Lint fix failed\n${r.stderr || r.output}` }], isError: true };
  /* existing dry-run report */
}
```

### QA-02 · ctest parser reports phantom failures and inflated counts

`parseTestOutput()` counts case-insensitive occurrences of the *words* "Passed"/"Failed" anywhere in the output — including inside **test names** and the summary line. The `total` regex `/^tests? (\d+)/im` never matches real ctest output.

**Proven** — realistic ctest run, 3 tests, all passing, one named `FailedThingTest`:

| | passed | failed | total |
|---|---|---|---|
| **ground truth** | 3 | 0 | 3 |
| **reported** | **4** | **1** | **5** |

Because `failed > 0`, the tool also dumps a `### Details` section for a fully green run. An agent reading this will go "fix" a test that never failed.

**Fix:** parse the authoritative summary line, fall back to per-test result lines:
```js
function parseTestOutput(text) {
  const clean = stripAnsi(text);
  const m = clean.match(/(\d+)% tests passed, (\d+) tests failed out of (\d+)/);
  if (m) return { total: +m[3], failed: +m[2], passed: +m[3] - +m[2] };
  const rows = clean.split('\n').filter(l => /^\s*\d+\/\d+ Test #\d+:/.test(l));
  const failed = rows.filter(l => /\*\*\*(Failed|Timeout|Exception|Not Run)/.test(l)).length;
  return { total: rows.length, failed, passed: rows.length - failed };
}
```

### FUNC-07 · `type:'ara'` silently scaffolds an unbuildable plugin

**Proven:** `audio_plugin_create(type:'ara')` returns `isError:false`, `"## Created ara plugin: AraPlugin"`, and emits `FORMATS ARA`. But `ARA` is not a valid `juce_add_plugin` `FORMATS` value, the template used is plain `juce`, and the sources derive from `juce::AudioProcessor`, not `juce::ARAAudioProcessor`. `TODO.md` explicitly lists the ARA template as **not implemented**.

The schema advertises an enum value that always produces a broken project and reports success.

**Fix (choose one):** remove `'ara'` from the `z.enum` until the template exists (a schema change → minor/major bump per the project's semver policy), or implement it properly with `IS_ARA_EFFECT TRUE` and an `ARAAudioProcessor` base.

---

## 4. Findings — Medium

| ID | Finding |
|----|---------|
| **QA-03** | **MSVC errors not counted.** `parseBuildOutput` matches `: error:` and `: error\d*\s*\(`. MSVC emits `Bar.cpp(17): error C2065: ...` — paren *before* `error` — matching neither. **Proven:** fake cmake emitting 1 GCC error + 1 MSVC error reported `Errors: 1`. Windows/MSVC is a primary JUCE/VST3 target, so builds can report "0 errors" while failing. |
| **QA-04** | **Warning regex is a no-op tautology.** `trimmed.match(/^.*warning:/)` ≡ `includes('warning:')` — matches any line containing that substring (status messages, notes, `0 warnings:`), inflating counts. |
| **SEC-03** | **`loadProjectConfig` performs no validation.** `JSON.parse` output is spread blindly over defaults. A non-array `validateFormats` breaks `formats.join()`; an object `buildDir` makes `path.join` throw uncaught; `generator` sourced from config **bypasses the `SAFE_GENERATOR` regex** applied to the parameter (spawnSync limits this to argument confusion, not injection). Add a zod schema for the config file. |
| **QA-05** | **`build` accepts a non-existent `projectPath` and creates directories.** **Proven:** `projectPath: '/tmp/apc-audit/does-not-exist-<ts>'` → `isError:false`, and the harness confirmed the path *and* `<path>/build` were created. `requireProjectPath` resolves but never checks existence. Validate that the path exists and contains `CMakeLists.txt` before `mkdirSync`. |
| **QA-06** | **`validate` checks prerequisites in the wrong place.** `checkOptionalTool()`'s return value is discarded, then `requireTool()` is called *inside* the per-binary results loop — once FUNC-04 is fixed, a missing validator would throw mid-loop after partial work. Hoist all prereq checks to the top. |
| **QA-07** | *(new — found while writing the Phase 3 tests)* **Compiler diagnostics on stderr are never parsed.** `trySpawn` returns stdout as `output` and stderr separately, but the build handler called `parseBuildOutput(r.output)` only. Compilers write diagnostics to **stderr**, so on a failing build the report read `## Build failed` / `Errors: 0` with an empty `### Errors` section — the errors were missing precisely when they mattered. **Proven:** shim cmake exiting 2 with `error: use of undeclared identifier` on stderr reported `Errors: 0`. Fixed by parsing `output + stderr`. |
| **OPS-01** | **GitLab CI is broken.** (a) `test` declares `artifacts:reports:junit: junit.xml` but nothing generates it — `node --test` emits TAP; verified no `junit.xml`. (b) `coverage: '/^ℹ tests\s+(\d+)/'` never matches: verified **0** matches, because non-TTY output is `# tests 11`, not `ℹ tests 11`. (c) `license_scanning` runs `npm ci` inside `image: docker:27-cli`, which has no npm. (d) `secret_detection` ends with `\|\| true` — a security scan that can never fail. (e) Ultimate scanners are hand-rolled as `docker run` invocations instead of `include: - template: …`. (f) No `node --check` and no `npm audit` step, so GitLab's gates diverge from GitHub's. |
| **OPS-02** | **`npm publish` uses `continue-on-error: true`.** A failed publish leaves CI green while the tag looks released. Remove it and rely on `NPM_TOKEN` being present, or gate on an explicit `if: github.event_name == 'push' && startsWith(github.ref,'refs/tags/v')` with a real failure. |
| **OPS-03** | **Version is duplicated.** `package.json:3` and `index.js:304` both hardcode `1.5.0`. CONTRIBUTING's release checklist mentions only `package.json` → guaranteed drift, and `initialize` would report a stale server version. Read it instead: `JSON.parse(fs.readFileSync(path.join(PKG_DIR,'package.json'),'utf8')).version`. |
| **OPS-04** | **Node 18 is EOL** (2025-04-30, ~17 months ago) yet is in `engines.node` and the CI matrix. `@hono/node-server` already requires `>=18.14.1`. Move to `>=20` and matrix `[20, 22, 24]`. |
| **OPS-05** | **`npm run ship` pushes straight to `main`** (`git push origin main --tags`), bypassing PR review — inconsistent with CONTRIBUTING's tag-only flow and with branch protection norms. |
| **OPS-06** | **Actions pinned to mutable major tags** (`@v7`, `@v4`). All three refs verified to exist and resolve, so nothing is broken today; pinning to commit SHAs is the OpenSSF Scorecard recommendation for supply-chain integrity. Dependabot already manages `github-actions`, so it will keep SHA pins updated. |

---

## 5. Findings — Low / hygiene

| ID | Finding |
|----|---------|
| **HYG-01** | `findBinary()` spawns `sh -c` — contradicting the file header's *"No user input reaches a shell interpreter"* and SECURITY.md Layer 2. Input is from the hardcoded `REQUIREMENTS` list so it is not exploitable, but the documented invariant is untrue in code. The FUNC-04 fix removes it. |
| **HYG-02** | `findPluginBinaries(projectPath, …)` — first parameter is never used (`buildDir` is already absolute). Dead signature. |
| **HYG-03** | `validateCommand` and `clapValidatorCommand` are declared in `defaultConfig` and documented in README, but **never read** — the validator binaries are hardcoded in the `validate` handler. Dead config keys; either wire them up or remove from docs. |
| **HYG-04** | No ESLint/Prettier/Biome. `npm run lint` is `node --check` — syntax only. No unused-variable, dead-code, or style checking on a 679-line file. HYG-02/03 and QA-04 would all be caught by a basic `eslint` config. |
| **HYG-05** | `tests/fixtures/` is **not gitignored** (verified `git check-ignore` → NOT IGNORED). Fixtures are cleaned per-run and the tree is clean today, but a mid-test crash leaves committable litter. Add `tests/fixtures/` to `.gitignore` (or write to `os.tmpdir()`). |
| **HYG-06** | The test harness sends `tools/list` / `tools/call` **without the MCP `initialize` handshake**. It works today because the SDK tolerates it; if the SDK starts enforcing the lifecycle, all 11 tests break at once. |
| **HYG-07** | Tests index `result.result.content[0].text` without optional chaining in several places → a protocol error surfaces as a `TypeError` instead of a readable assertion failure. |
| **HYG-08** | `SECURITY.md` is stale: says *"v1.4.0 (current)"* (actual 1.5.0), *"npm audit: 0 vulnerabilities"* (actual 6), and *"sdk v1.29.0, zod v3.25.76"* (actual 1.30.0 / **zod 4.6.5** — a major-version jump). Its audit history never mentions the 1.5.0 webview feature. |
| **HYG-09** | `CONTRIBUTING.md` tells contributors to *"Use `tryRun()` … `run()` when failure is fatal"* — neither function exists (replaced by `trySpawn`/`spawn` in 1.4.0). Verified: 0 matches in `index.js`. |
| **HYG-10** | README drift: project-structure tree omits `templates/juce-webview/`; the `ui` parameter (the v1.5.0 headline feature) is undocumented in the Scaffold section; `type='vst3'`/`'ara'` are accepted but undocumented; the FAQ promises a *"command not found: cmake"* message that (per FUNC-04/05) the server never emits. |
| **HYG-11** | `index.js` is mode **644** despite its `#!/usr/bin/env node` shebang and `bin` entry. npm chmods it to 755 on install (verified working), so this is cosmetic — but committing 755 is correct for a shebang'd bin. |
| **HYG-12** | `isError` is driven solely by exit code, so a build that exits 0 while the log contains parsed errors reports *"Build succeeded"* alongside `Errors: N`. Consider `isError = !r.ok \|\| parsed.errorCount > 0`. |

---

## 6. Test coverage gaps

**Tool coverage — 4 of 7 tools have zero tests:**

| Tool | Tests |
|------|-------|
| `audio_plugin_plugins` | 5 |
| `audio_plugin_create` | 3 |
| `tools/list` | 2 |
| `audio_plugin_build` | 1 (failure path only) |
| `audio_plugin_configure` | **0** |
| `audio_plugin_test` | **0** |
| `audio_plugin_lint` | **0** ← contains SEC-01 |
| `audio_plugin_validate` | **0** |

**Parameter coverage — every one of these is untested (verified 0 matches):**
`ui:'webview'` (the v1.5.0 headline feature), `type:'vst3'`, `type:'ara'`, `fix:true`, `clean:true`, `generator`, `options`, `testName`, `target`.

**Not tested at all:**
- The entire 1.4.0 security hardening — no test asserts that any `SAFE_*` regex *rejects* a malicious input, and none asserts the `checkPluginPath` boundary holds. A security control with zero negative tests is how SEC-01 shipped.
- `parseBuildOutput` / `parseTestOutput` — pure functions, trivially unit-testable, and both are wrong (QA-02/03/04).
- `loadProjectConfig` merge/precedence — would have caught FUNC-06 immediately.
- Generated-template validity — no test asserts the absence of leftover `{{…}}`, which is exactly FUNC-01.

---

## 7. Remediation plan

### Phase 0 — Unblock the release gates *(~15 min)*
1. `npm install @modelcontextprotocol/sdk@^1.32.1 && npm audit fix`
2. `npm test` → confirm 11/11 still green
3. `npm run check` → must exit 0
4. Commit `package.json` + `package-lock.json`. *(Resolves SEC-02.)*

### Phase 1 — Security fixes *(~1 h)*
5. Add `assertWithinProject()`; apply to `audio_plugin_lint` `target` and refactor `checkPluginPath()` to use it. *(SEC-01.)*
6. Add `.refine()` rejecting `..` path segments on `target` and `projectPath`.
7. Rewrite `findBinary()` to use `which`/`where` via `spawnSync` with no shell. *(FUNC-04, HYG-01.)*
8. Rewrite `trySpawn()` to inspect `result.error` / `result.signal`; add a distinct timeout message. *(FUNC-05.)*
9. Add a zod schema for `apc-mcp.json` in `loadProjectConfig`; validate `validateFormats` is an array of known formats and `generator` against `SAFE_GENERATOR`. *(SEC-03.)*
10. Validate `projectPath` exists and contains `CMakeLists.txt` before any `mkdirSync`. *(QA-05.)*

**Write the negative tests first** (TDD, so the fix is provable): assert `target:'../victim'` is rejected; assert a shell-metacharacter `target` is rejected; assert `projectPath:'../../etc'` is rejected.

### Phase 2 — Template correctness *(~2 h)*
11. Delete the `{{#WEBVIEW}}…{{/WEBVIEW}}` block from `templates/juce/CMakeLists.txt`. *(FUNC-01.)*
12. Replace `juce_add_webview_ui()` with `juce_add_binary_data()` + `target_link_libraries` + `JUCE_WEB_BROWSER=1` + `NEEDS_WEBVIEW2 TRUE` in `templates/juce-webview/CMakeLists.txt`. *(FUNC-02.)*
13. Replace `${PROJECT_NAME}` with `{{PLUGIN_NAME}}` across both JUCE templates. *(FUNC-03.)*
14. Remove `'ara'` from the `type` enum (or implement it). *(FUNC-07.)*
15. **Add the missing regression test:** scaffold every `type × ui` permutation and assert (a) no `{{…}}` remains in any generated file, (b) `CMakeLists.txt` names the plugin target after the plugin, (c) webview output references only files that exist.
16. **Highest-value new check:** install cmake (`apt install cmake`) in CI and actually run `cmake -B build` against a scaffolded CLAP plugin. This is the only way to prove the scaffold works — it would have caught FUNC-01/02/03 on day one. Gate on configure success.

### Phase 3 — Correctness of parsing & failure reporting ✅ COMPLETE

22 tests in `tests/tool-output.test.js`; **13 of them fail against the pre-Phase-3
code** in a throwaway worktree, all 22 pass after. Driven end to end through the MCP
interface with PATH shims emitting canned output and chosen exit codes.

17. ✅ `parseTestOutput()` rewritten around ctest's summary line, falling back to
    per-test result lines. *(QA-02.)*
18. ✅ `parseBuildOutput()` now classifies via four anchored diagnostic shapes
    (clang/gcc `file:line[:col]: severity:`, MSVC `file(line): severity C####:`,
    `CMake Error|Warning`, and tool-prefixed `ld: error:`) and counts `note`/`remark`
    as context rather than diagnostics. *(QA-03, QA-04.)*
19. ✅ `audio_plugin_lint` has an explicit `fix=true` failure branch that reports
    `isError: true`, names the file count, and warns that files may be partially
    reformatted. *(QA-01.)*
20. ✅ `.default('Debug')` dropped from all four `config` schemas → `.optional()`,
    resolved as `params.config ?? cfg.config ?? 'Debug'`; precedence documented in
    each `.describe()`. *(FUNC-06.)*
21. ✅ Validator availability hoisted above the results loop; missing validators now
    produce a `SKIPPED` entry with an install hint instead of throwing mid-loop, and
    `isError` is true whenever validation is incomplete. This also closed **HYG-03** —
    `cfg.validateCommand` / `cfg.clapValidatorCommand` are now actually honoured
    instead of being validated and ignored. *(QA-06.)*
22. ✅ **Correction to this plan:** the parsers are *not* unit-testable as pure
    functions, because importing `index.js` starts the MCP server. They are tested
    through the tool interface with shims, which has the advantage of also covering
    the handlers' use of the parsed result — that is how **QA-07** and **HYG-12**
    (build ignoring its own `errorCount`) were caught.
23. ✅ Build now parses `output + stderr` *(QA-07)* and sets
    `isError: !r.ok || parsed.errorCount > 0` *(HYG-12)*.

### Phase 4 — CI / release engineering ✅ COMPLETE

19 tests in `tests/release.test.js`; **11 of them fail against the pre-Phase-4 repo**.

23. ✅ **GitHub Actions:** `npm audit --audit-level=high` added to the `test` job
    (nothing gated on advisories before), plus an `npm run smoke` step; matrix is
    `[22, 24]`; `continue-on-error` removed from `npm publish`; the
    cmake-install + scaffold-configure jobs from step 16 landed in Phase 2 as
    `compile-scaffold` / `scaffold-clap` / `scaffold-juce`. *(OPS-02, OPS-04.)*
    **Correction to this plan:** it says "drop 18" — Node **20** also reached EOL on
    2026-04-30, so `engines.node` is `>=22`, not `>=20`. The plan was written from
    an older release schedule.
24. ✅ Pinned to commit SHAs, re-verified with `git ls-remote` at pin time.
    **Correction:** `github/codeql-action@v4` is an **annotated** tag —
    `7999b86c…` is the *tag object* and GitHub resolves `uses:` to a commit, so the
    peeled `2892aa5e…` is what must be pinned. `actions/checkout@v7` and
    `actions/setup-node@v7` are lightweight tags, so their listed SHAs are commits.
    *(OPS-06.)*
25. **GitLab CI — decide first: keep or delete?** The repo is hosted on GitHub and README badges point at GitHub Actions; `.gitlab-ci.yml` references a different org (`gitlab.com/sgmstudios`) and is broken in six places (OPS-01). *Recommendation: delete it* unless GitLab mirroring is genuinely in use. If keeping: replace hand-rolled docker scanner jobs with `include: - template:`, drop the bogus `junit.xml` report or generate one, fix the coverage regex to `/^# tests\s+(\d+)/` (or force the spec reporter), move `npm ci` out of the `docker:27-cli` image, and remove `|| true` from secret detection.
26. ✅ `index.js` reads the version from `package.json` at startup; verified live —
    `initialize` returns `serverInfo.version` matching the file. *(OPS-03.)*
27. ✅ Replaced by `scripts/ship.mjs`, which runs the checks itself and refuses —
    with a specific reason — unless HEAD is `main`, the tree is clean, the tag does
    not exist, and `CHANGELOG.md` has a `## [<version>]` heading. `--dry-run`
    exercises every guard. Tag-only pushing would not have caught tagging from the
    wrong branch. *(OPS-05.)*
28. ✅ Done in Phase 2 — `.gitignore` has `tests/fixtures/test-project/`, which is the
    only path under it that tests generate. The sibling `juce-api-stub/` is a
    committed fixture and must stay tracked. *(HYG-05.)*
29. ✅ `index.js` is mode 755 and the executable bit is recorded in git; `./index.js`
    now answers an `initialize` request directly. *(HYG-11.)*

### Phase 5 — QA tooling & docs ✅ COMPLETE
30. Add ESLint (`eslint:recommended` + `no-unused-vars`, `no-useless-escape`) as the real `npm run lint`; keep `node --check` in `quality`. Catches HYG-02, HYG-03, QA-04. *(HYG-04.)*
31. Remove dead code: `findPluginBinaries`' unused param; wire up or delete `validateCommand`/`clapValidatorCommand`. *(HYG-02, HYG-03.)*
32. Add the MCP `initialize` handshake to the test harness; use optional chaining + descriptive assertion messages. *(HYG-06, HYG-07.)*
33. **Rewrite `SECURITY.md`** — correct the version, the audit counts, the dependency versions; document SEC-01 as a fixed vulnerability in the audit history; retract the *"no residual risk of arbitrary file read/write"* claim and replace it with an honest residual-risk section (filesystem write within the project boundary; DoS via long builds). *(HYG-08.)*
34. **Update `CONTRIBUTING.md`** — replace `tryRun()`/`run()` with `trySpawn()`/`spawn()`; add "update the version in `index.js`" (or note it's now derived). *(HYG-09.)*
35. **Update `README.md`** — add `templates/juce-webview/` to the structure tree; document the `ui` parameter with a webview example; document all `type` values; fix the FAQ to match the real error messages produced after FUNC-05. *(HYG-10.)*
36. Add `CHANGELOG.md` entries under a `1.5.1` (fixes) / `1.6.0` heading. Note that removing `'ara'` from the enum is a **breaking schema change** per the project's own semver policy → that alone argues for `2.0.0`.

**Phase 5 outcome — what changed and how it was verified**

| # | Item | What was done | Verification |
|---|---|---|---|
| 30 | ESLint *(HYG-04)* | `eslint@10` + `@eslint/js`, both under allowlisted licenses. Flat config in `eslint.config.js` with explicit Node and browser globals (no extra `globals` dependency), `no-unused-vars`, `no-useless-escape`, `no-empty`, `eqeqeq`, `prefer-const` — plus a project-specific ban on `exec`/`execSync`, the shell-invoking APIs the entire security model exists to avoid. `npm run lint` = `eslint . && node --check index.js`, and `npm run quality` now runs it, so both `npm run check` and CI lint the repo. | First run found **15 real problems**; all 15 fixed; re-run clean |
| 31 | Dead code *(HYG-02/03)* | Unused `projectPath` param removed from `findPluginBinaries` (its single call site updated). The unreachable catch was already fixed in P3; `no-empty` now catches that class of bug going forward. | `node --check`, full suite |
| 32 | Handshake + optional chaining *(HYG-06/07)* | `tests/server.test.js` rewritten onto `tests/helpers/mcp-client.mjs`, which performs a real `initialize` handshake. The old in-file client duplicated the other two suites **and skipped the handshake entirely**, so it never exercised the path a real MCP client takes. All deep property access is optional-chained with descriptive assertion messages. Fixtures moved to `os.tmpdir()`, so a test run leaves nothing in the repo. | 11 → **12 tests**, all pass, with better coverage (added: no unsubstituted placeholders, requested `FORMATS` actually emitted, no directories created on a rejected call, malformed `status.json` surfaced) |
| 33 | `SECURITY.md` *(HYG-08/10)* | Full rewrite — see below | Every claim re-checked against source |
| 34 | `CONTRIBUTING.md` *(HYG-09)* | `tryRun()`/`run()` → `trySpawn()`/`spawn()`; `server.tool()` → the `registerTool()` wrapper, with the reason; the stale "bump the version in `index.js`" advice removed; added the red-phase-first requirement, the `isError` rule, and which test file to use for which kind of change | No stale references remain |
| 35 | `README.md` *(HYG-10)* | Documented all three `type` values in a table (including that `vst3` is a JUCE alias that sets `FORMATS VST3`), documented `ui="generic"\|"webview"` with the bridge contract, added `templates/juce-webview/` plus every test and script file to the structure tree, corrected the test count, Node badge → `node-22+` | Each claim checked against `index.js:960`, `index.js:508` and the templates |
| 36 | `CHANGELOG.md` | Phase 5 entries added under the existing `## [Unreleased] — 2.0.0` heading. The `1.5.1`/`1.6.0` split this plan proposed was superseded by the 2.0.0 decision — removing `'ara'` and raising `engines` are both breaking. | `scripts/ship.mjs` guard 4 |

**`SECURITY.md` was materially false, and is now corrected.** It claimed the
*"current version"* was `0.1.0` and described *"17 tests, 6 findings"* while 104+
tests and 35 findings existed; its layer-3 description claimed `path.resolve()` and
`realpathSync` checks that **do not exist in the code** — the real guard is
`assertWithinProject` plus the zod regexes; it listed dependency versions that had
all been superseded; it asserted *"no residual risk of arbitrary file read/write"*,
which is untrue, since the guard is an allowlist *within* the project boundary and
everything inside that boundary is writable by design; and it recorded SEC-01 as
*"fixed in 0.3.0"* when the lint path traversal was only closed in `dbf4c85`, so
**1.4.0 and 1.5.0 as published on npm are still vulnerable** and anyone upgrading
needs to be told to move to ≥ 2.0.0. The replacement states the threat model, eight
defence layers each citing its source (including the one deliberate exception where
the command whitelist is bypassed after an explicit `validateCommand` check), the
honest residual risks, and an accurate audit history.

Also in Phase 5: the orphaned `.gitlab/merge_request_templates/Default.md` — a
leftover from before the repo moved to GitHub, which GitHub never reads — was
deleted, with its genuinely useful checklist items migrated into a real
`.github/pull_request_template.md`; `index.js` gained the executable bit to match
its shebang and `./index.js` was confirmed to answer `initialize`; `publish.yml`'s
`test` job gained `npm run smoke` and `npm audit --audit-level=high` steps, neither
of which ran in CI before; and `BlueOak-1.0.0` was allowlisted (a permissive
license in ESLint's dev tree).

**One behaviour change came out of linting.** `audio_plugin_plugins` silently
swallowed a malformed `status.json`, so the user saw a plugin with no type and no
explanation. It now reports `statusError` on that entry while still listing the
plugin — covered by a new test that fails against the pre-change code with
`entry: {"name":"Broken"}`.

**Regex edits in a security allowlist were proven equivalent before being applied.**
ESLint flagged `\/` inside the `SAFE_OPTIONS` and `SAFE_PATH` character classes as
a useless escape. Rather than assume, both regexes were compared to their cleaned
forms over 65,536 probe strings (every code point below U+2000, alone and embedded
in a valid token): **0 behavioural differences**, so the escapes were removed.


### Phase 6 — Verification — partially complete *(2 items blocked by OPS-07)*
**Phase 6 status** — recorded at `2.0.0` readiness, not aspirationally:

| # | Check | Status |
|---|---|---|
| 37 | `npm run check` → exit 0 | ✅ **Done.** 119 tests / 117 pass / 0 fail / 2 skip, ESLint clean, smoke 5/5, `npm audit` 0 vulnerabilities, license gate PASS. |
| 38 | Full suite green, covering all 7 tools | ✅ **Substantially done — but not "every parameter".** All 7 tools are exercised. Before Phase 3, four of them (`configure`, `test`, `lint`, `validate`) had **zero** tests. Still untested: `clean`, `generator`, `options`, `testName`, and the success paths of `audio_plugin_create`/`plugins` beyond what `server.test.js` covers. Treat that as known residual gap, not as complete coverage. |
| 39 | Re-run the SEC-01 exploit PoC → rejected | ✅ **Done.** `tests/security.test.js` drives the real server over stdio with the traversal payloads; the lint path traversal is rejected, and 1.4.0/1.5.0 are documented as vulnerable in `SECURITY.md`. |
| 40 | Re-run fake-toolchain scenarios (FUNC-04/05/06, QA-01/02/03) | ✅ **Done.** `tests/tool-output.test.js` builds PATH shims and asserts exit codes, diagnostic counts, skipped-step reporting and `isError` flags. |
| 41 | `cmake -B build` on a scaffolded CLAP **and** JUCE-webview plugin | ⛔ **BLOCKED — not proven.** No CMake binary is obtainable in this environment (see HANDOFF §3). What *is* proven: the generated CLAP sources compile clean under `g++ -Wall -Wextra` against **real** free-audio/clap headers; the generated JUCE sources pass `g++ -std=c++20 -fsyntax-only` against a **transcribed stub** of the JUCE 9 API, not real JUCE. Configure/build of a generated project has never been executed anywhere, because the `scaffold-*` CI jobs have never run (OPS-07). **This is the single largest unverified assumption in the project.** |
| 42 | `npm pack` → install tarball → responds to `tools/list` | ✅ **Done, and extended.** 19 files packed, no leaks. Installed into a clean prefix, then run through `node_modules/.bin/apc-mcp`: `initialize` reports `serverInfo.version: "2.0.0"` (read from the installed `package.json`), all 7 tools listed, `index.js` retains mode 755. A follow-up `audio_plugin_create(type=juce, ui=webview)` against the *installed* package produced all 9 files with `FORMATS VST3;AU`, `NEEDS_WEB_BROWSER`, zero unsubstituted placeholders and the three UI assets — proving `templates/` resolves relative to the install directory, not the dev cwd. |
| 43 | CodeQL clean on the PR | ⛔ **BLOCKED by OPS-07.** GitHub Actions cannot run at all: the account is locked over a billing issue, so every job dies in 2–4 s. No workflow change made in Phase 4 or 5 — SHA pinning, the `[22,24]` matrix, the new smoke and audit steps — has been validated by a real run. They were validated by parsing, by `tests/release.test.js`, and by `npx js-yaml`. |

37. `npm run check` → exit 0.
38. Full suite green, with new tests covering all 7 tools and every parameter.
39. Re-run the exploit PoC for SEC-01 → must be **rejected**.
40. Re-run the fake-toolchain scenarios for FUNC-04/05/06, QA-01/02/03 → all must produce correct messages/counts.
41. `cmake -B build` on a freshly scaffolded CLAP plugin **and** a JUCE-webview plugin → both configure.
42. `npm pack` → install tarball → `apc-mcp` responds to `tools/list`.
43. CodeQL clean on the PR.

---

## 8. Verification method & reproducibility

All runtime findings were confirmed empirically, not by inspection alone. The harness (`/tmp/apc-audit/`) consists of:

- **`mcp.mjs`** — a conformant MCP stdio client: spawns `index.js`, performs the full `initialize` → `notifications/initialized` → `tools/call` sequence, parses newline-delimited JSON-RPC, and returns `{isError, text}`.
- **`bin/`** — instrumented fake `cmake`, `ctest`, `clang-format`, `pluginval`, `clap-validator` that append their received `argv` to a log file and emit realistic compiler/ctest/validator output (GCC errors, MSVC errors, a 3-test ctest run including a test named `FailedThingTest`, a validation failure).
- **`proj/`** — a fixture project with `CMakeLists.txt` and `apc-mcp.json` (`generator: Ninja`, `config: Release`) plus a planted `plugins/Foo/Source/Foo.cpp`.
- **`victim/`** — a directory deliberately **outside** `proj/`, used to prove SEC-01.

Running the server against a `PATH` that omits the real toolchain is what exposed FUNC-04/FUNC-05; logging `argv` is what proved SEC-01 (the `-i` write to an out-of-tree file) and FUNC-06 (`-DCMAKE_BUILD_TYPE=Debug` despite `config: Release`).

The harness lives in `/tmp` and is not part of the repo — **no audit artifacts were committed and the working tree is clean.**

---

## 9. What is genuinely in good shape

- **No shell injection.** `spawnSync` with argument arrays is used consistently; verified that `options: '-DFOO=ON -DBAR=OFF'` is split into discrete `argv` entries rather than passed to a shell. The 1.4.0 hardening here is real and effective.
- **`audio_plugin_validate` works correctly** — detected both a VST3 and a CLAP binary, ran the right validator on each, reported `0 passed, 2 failed` with per-plugin detail and `isError: true`.
- **Packaging is sound** — `npm pack` produces a 17.9 kB / 19-file tarball with correct `files` allowlist; install creates the `apc-mcp` bin symlink; npm sets the exec bit; the binary answers `tools/list`.
- **All 7 tools register** with complete `inputSchema.properties`, and every parameter carries a `describe()` — good LLM ergonomics.
- **Template variable substitution is complete** for the 7 supplied keys across all 3 templates (no unresolved `{{PLUGIN_*}}`/`{{VENDOR}}`); the `juce-webview` template has zero leftover placeholders.
- **Code style is uniform** and fully `.editorconfig`-compliant: LF everywhere, final newlines present, no tabs, no trailing whitespace.
- **Dependabot, CodeQL, and issue/MR templates** are all configured and active; CI action refs all resolve.
- **Test suite is fast and dependency-free** (3.7 s, `node:test` only) and genuinely exercises the server over stdio rather than mocking internals.

---

## 10. Bottom line

`apc-mcp` has good bones — clean single-file architecture, a real (and working) anti-injection design, sound packaging, and an honest docs set. But **v1.5.0 is not shippable**: the release gates are red on a critical transitive CVE, the default scaffold path produces CMake that cannot be parsed, the headline WebView template calls a JUCE function that does not exist, and a documented security control has a hole that permits out-of-project file writes.

The common root cause across FUNC-01/02/03, QA-01/02/03 and SEC-01 is that **the test suite verifies the server responds, not that its output is correct.** Four of seven tools have no tests at all, no test asserts a security control *rejects* anything, and nothing ever checks that a scaffolded project can actually be configured by cmake. Phase 2 step 16 — installing cmake in CI and configuring a scaffolded plugin — is the single highest-leverage change in this plan.
