# Substantiation Log — apc-mcp 2.0.0

**Evidence officer review:** 2026-11-16 · **Tree under test:** `6c23658` (this branch's base = main at review start; `index.js`/`scripts/` verified byte-identical to current main tip `fdbb0ce`, which additionally carries PR #38's template fix and PR #40's `VERIFICATION-MATRIX.md`).

**Rubric.** *Strong* = implementing code + automated test with a **proven red phase** (I ran the current tests against the pre-fix code and counted the failures) **and/or** a green CI run on the exact tree, **plus my own independent live reproduction**. *Moderate* = code + test but red phase unproven, or code + my repro with **no in-repo test**. *Weak* = code only. *None* = narrative only. Anything marked ⚠ is a finding of this review, reproduced by me unless noted.

**Method note.** Sandbox rebuilt from scratch: CMake 4.4.5, clang-format 23.1.5, g++ 12, upstream `free-audio/clap` + `lv2/lv2` clones, real MCP stdio driving, git worktrees at `v1.5.0`, `0412255` (pre-FUNC-21-fix), and `0ec788f` (pre-PR-#36) for red-phase runs. CI verified via the GitHub API.

---

## 1. Red-phase teeth — the changelog's "N tests fail against the pre-fix code" claims

The changelog makes specific teeth claims. I measured them by running **current test files against pre-fix worktrees** (each with its own `npm ci`):

| Suite | Pre-fix ref | My measurement | Changelog claim | Verdict |
|---|---|---|---|---|
| `tests/security.test.js` (49) | `v1.5.0` | **31/49 fail** | "30 negative tests" | **Teeth proven** |
| `tests/tool-output.test.js` (35) | `v1.5.0` | **27/35 fail** | "13 of them fail against the pre-fix code" (22 then) | **Teeth proven** (suite grew) |
| `tests/artefacts.test.js` (15) | `v1.5.0` | **11/15 fail** | "9 of 13 failed before the FUNC-21 fix" | **Teeth proven** — but note: at `0412255` (parent of the commit the claim names) all 15 pass; the fix actually landed in PR #28, so the claim's commit attribution is off while the substance holds |
| `tests/templates.test.js` (69) | `v1.5.0` | fixture `before()` fails; all 69 cancelled | "25 of these 30 fail" | **Coarse red** (suite cannot even scaffold against old code) |
| `tests/release.test.js` | `v1.5.0` | module-load failure (`check-licenses.mjs` absent) → 1 fail | "11 of these fail" | **Coarse red** |
| **PR #36's new tests** (9 groups) | `0ec788f` | **9/9 fail** — `SEC-NEW-01/02/04`, `NODE-02/03/04`, `CPP-01/02/UI-01`, `CPP-03/04`, `CMAKE-01/02` | none (PR body only) | **Teeth proven** — the newest, least-reviewed code has full red phase |

**Conclusion:** the tests are not theatre. Every suite that can load against old code fails there in volume; the newest hardening (PR #36) is fully red-proven at its exact pre-fix commit.

---

## 2. Archived AUDIT.md findings — closure evidence

| Finding | Closing evidence | Level | Sufficient? |
|---|---|---|---|
| **SEC-01** lint traversal (CRITICAL) | `hasDotDot()` + `assertWithinProject()` in `index.js`; 4 test refs; red phase (above); v1.5.0 tag source inspected by me — the old `SAFE_PATH` regex and missing containment are exactly as documented; my 5 live PoCs (`../`, absolute, symlinked dir, symlinked `plugins/`, dangling symlink) all rejected, victim files untouched | **Strong** | ✅ |
| **SEC-02** 6 npm vulns, gates red | `npm audit` → 0 (ran, no `overrides`, no threshold flag); CI runs the same plain command; SDK `^1.32.2` | **Strong** | ✅ |
| **SEC-03** unvalidated config | `CONFIG_SCHEMA` per-key zod; live: bad `validateCommand`/`clapValidatorCommand` rejected with per-key fallback, malformed JSON → defaults, non-array `validateFormats` no crash; 2 test refs + red phase. ⚠ **F4 (reproduced):** `{"constructor":"x"}` → `validator.safeParse is not a function` — `CONFIG_SCHEMA[key]` walks the prototype chain, so the documented "unknown keys are ignored" is falsified for inherited names. One-line fix (`Object.hasOwn`). | **Moderate** (universal claim broken) | ⚠ near — fix F4 + add test |
| **FUNC-01/02/03** template CMake breakage | templates rewritten; scaffold builds against real SDKs (live, below); smoke asserts no placeholders | **Strong** | ✅ |
| **FUNC-04/05** findBinary / "exit code null" | `binaryOnPath()` PATH scan; `trySpawn()` ENOENT/ETIMEDOUT/ENOBUFS branches; live: missing cmake → install hint; hanging cmake → `'cmake' timed out after 120s` | **Strong** | ✅ |
| **FUNC-06** dead `config` | `.optional()` + `params.config ?? cfg.config ?? 'Debug'`; live: apc-mcp.json `Release` honoured, explicit `Debug` overrides; red phase | **Strong** | ✅ |
| **FUNC-07** `ara` | removed from enum; live rejection + test | **Strong** | ✅ |
| **QA-01** lint fix success-on-failure | fix=true failure path live: `Lint could not apply fixes` + partial-reformat warning + stderr shown. ⚠ **DEF-1 (reproduced, still open):** the **dry-run** branch reports `Lint found issues / Files with problems: 0 of N / Run with fix=true` for a *timeout or crash*, discarding `trySpawn`'s message — including the new ENOBUFS text. `isError` stays `true` (no false success) but "says why" fails for this branch. | **Moderate** | ⚠ fix DEF-1 |
| **QA-02** phantom ctest counts | summary-line parser; live 1/0/1 on a real suite; red phase | **Strong** | ✅ |
| **QA-03/04** MSVC/warning parsing | 4-pattern `DIAGNOSTIC_PATTERNS`; tests. ⚠ **F3 (reproduced):** a diagnostic whose *path contains a space* with cmake exiting 0 → `Build succeeded, Errors: 0`, `isError:false` (`\S+` and `[^\s(]+` cannot span the space; project dirs like "My Plugins" are the documented norm). Narrow but real. | **Moderate** | ⚠ fix F3 |
| **QA-05** bogus projectPath mkdir | `assertProjectRoot()`; live + tests (no side effects) | **Strong** | ✅ |
| **QA-06** validate prereq placement | hoisted `checkOptionalTool`; live MISSING-VALIDATOR → SKIPPED + isError true | **Strong** | ✅ |
| **QA-07** stderr never parsed | `combinedOutput`; live failing build lists both gcc errors | **Strong** | ✅ |
| **HYG-01..12** hygiene | eslint ban on `exec` (verified: zero hits, lint green); HYG-03 validator-config wiring: **code works (my live shim proved a custom `clapValidatorCommand` is invoked)** but ⚠ **no test exists anywhere** — grep for `validateCommand|clapValidatorCommand` in `tests/` → 0 hits; HYG-11 `index.js` mode `100755` in git (verified) | **Strong / Moderate (HYG-03)** | ⚠ add the missing test |
| **OPS-02..06** CI/release | `publish.needs` all 8 jobs; SHA pins (verified in workflow + API); no `continue-on-error` (release test); `ship.mjs --dry-run` refused my branch with the specific reason | **Strong** | ✅ |
| **FUP-01..11** follow-ups | symlink containment (live), `--config`/reconfigure (live), escaping (live compile), CLAP `.clap` binary (live + CI), FUP-07 cleanup-on-failed-create (code + `createdPluginDir` rollback — reviewed, not separately re-run) | **Strong/Moderate** | ✅ |

---

## 3. Substantiation Log — major claim areas

### A. Security hardening

| Claim | Level | Basis | Required next evidence | Sufficient to tag? |
|---|---|---|---|---|
| No shell injection; argv arrays only | **Strong** | zero `exec`/`execSync`/`sh -c` in `index.js`; eslint hard-bans them; metachar schema rejections red-proven; instrumented shims recorded exact argv (`--strictness-level 10 <path>`, `validate <path>`) | — | ✅ |
| `assertWithinProject` containment (symlink-aware, no `..`) for apc-mcp's own writes | **Strong** | 5 live PoCs rejected on the current tree incl. the PR-#36 dangling-symlink case; deepest-existing-ancestor walk verified by construction | — | ✅ |
| Validator command constrained to a bare PATH name | **Moderate** | `SAFE_TARGET` regex (no separators/whitespace — live-rejected); ⚠ **no in-repo negative test** pins it | add config-schema negative tests (`"/x/y"`, `"a b"`, `".."`) | ✅ with test debt noted |
| Configure `options` guarded (`SAFE_CMAKE_OPTION_TOKEN`, no `..`) | **Moderate** | grammar live-rejects `--fresh`, `-C`, `-P`, `--trace-redirect`; red-proven at `0ec788f`. ⚠ **F7 (reproduced):** `-DTEST=../outside` **passes** — `hasDotDot` sees the whole token, whose first segment is `-DTEST=..`, not `..`; the SEC-NEW-02 test only covers `../../` (double traversal). Guard claim ≠ guard behaviour | fix value-level `..` check + single-`../` test | ⚠ |
| Output caps & timeouts (16 MB, per-command) | **Moderate** | code + my live timeout and ENOBUFS repros; ⚠ no in-repo test for either message; DEF-1 swallows both in lint dry-run | tests + DEF-1 fix | ⚠ |
| **Residual-risk statement: "no … arbitrary file read/write outside the project root"** | **Failed as written** | ⚠ **F1 (reproduced):** `options="-DCMAKE_PROJECT_INCLUDE=/tmp/…/outside/payload.cmake"` passes the grammar, and cmake executed the outside script → file written outside the project, `Configure succeeded`. ⚠ **Artefact symlink escape (reproduced):** a symlinked `…/Release/CLAP` dir pointing outside hands an outside `.clap` to the validator (reported PASS from my shim). ⚠ **`apc-mcp.json` is read through a symlink** (reproduced — outside `validateFormats` applied). None extends write access beyond "anyone who can write the project dir can already…" *except* F1, which is prompt-injectable | rewrite the residual-risk section: apc-mcp's **own file operations** are contained; **subprocesses executing project-controlled CMake are not containable by design**; add `assertWithinProject` to artefact discovery + config read, or document | ❌ **tag blocker (docs honesty)** |
| 1.4.0/1.5.0 vulnerable (upgrade notice) | **Strong** | v1.5.0 tag source inspected: `SAFE_PATH` permits `..`; lint had no containment; `findBinary` returned true unconditionally via `sh -c` | — | ✅ |

### B. Honest output

| Claim | Level | Basis | Required next evidence | Sufficient to tag? |
|---|---|---|---|---|
| `isError: true` on command failure / compiler errors / failing tests | **Strong** | live: compile failure (2 errors parsed), failing ctest, configure FATAL_ERROR, failing validator; red phase 27/35 | — | ✅ |
| Counts never invented; unrecognized output flagged | **Strong** (with one ⚠ below) | live `1/0/1`; "unknown" + raw tail on unrecognized | — | ✅ |
| No-tests-found is a failure | **Strong** | live, dedicated diagnosis | — | ✅ |
| **Skipped ctest tests reported honestly** | **Moderate** | ⚠ **F2 (reproduced):** a `SKIP_RETURN_CODE` test → `## Tests passed`, `isError:false`, counts "unknown … not in a recognized format", **but the Details do show `***Skipped` and "The following tests did not run"**. The parser ignores `***Skipped` (ctest's skip-summary shape also differs). PR #40's matrix grades this High; I grade **Medium** — evidence is surfaced, but the header asserts "passed" for a run where nothing ran | count `***Skipped` and report "N skipped" in the header | ⚠ |
| **Space-in-path errors on exit 0** | **Failed for that case** | ⚠ **F3 (reproduced):** `/tmp/My Project/File.cpp:1:2: error: …`, exit 0 → `Build succeeded / Errors: 0 / isError:false` | extend `DIAGNOSTIC_PATTERNS` to tolerate spaces in the path token; add test | ⚠ |
| **Lint dry-run failure diagnosis** | **Failed for that branch** | ⚠ **DEF-1 (reproduced twice, incl. the new ENOBUFS message):** timeout/crash → `Lint found issues / 0 of N / Run with fix=true` — cause discarded, advice wrong. `fix:true` branch is correct | mirror the build handler's raw-tail fallback when `badFiles.length===0` | ⚠ |
| Validate three-outcome model (PASS/FAIL/SKIPPED/NOT CHECKABLE) | **Strong** | all four live: shims + real missing validator + built LV2 → NOT CHECKABLE, `isError:false`; missing configured validator → isError true | — | ✅ |
| "`validateCommand`/`clapValidatorCommand` are honoured" (changelog, under "22 new tests") | **Weak → Moderate** | ⚠ **zero in-repo tests** reference these keys (grep-verified). Code works — my shim proved a custom command is invoked — but a revert to hardcoded names would pass the whole suite | add the positive test the changelog already claims exists | ⚠ |
| Handler exceptions → readable `isError` results | **Strong** | `registerTool` wrapper; live reserved-name case | — | ✅ |

### C. Template correctness

| Claim | Level | Basis | Required next evidence | Sufficient to tag? |
|---|---|---|---|---|
| CLAP scaffold configures/builds against real free-audio/clap | **Strong** | live twice (incl. hostile metadata), artefact at the documented path; CI `Scaffolded CLAP builds` green on exact SHAs | — | ✅ |
| LV2 scaffold builds a loadable bundle; URI/port coherence | **Strong** | live `.lv2` bundle (`.so` + both `.ttl`); 14-test suite; compile+link against real headers (230/230 with env vars) | — | ✅ |
| JUCE/webview/standalone build against real JUCE 9 | **Strong (CI)** | green `Scaffolded JUCE builds` + real-pluginval jobs on `6c23658` and `fdbb0ce`; my static cross-check of every CMake keyword and `JUCE_FORMATS` against real 9.0.3 `JUCEUtils.cmake`; local full build blocked by sandbox (no GUI system deps — environment) | — | ✅ |
| Escaping per output grammar, non-ASCII OK | **Strong** | hostile vendor `Café "ACME, Inc." \ Evil&Co <script>` → escaped C++ literal, sanitized bundle ID, **compiles clean** with `-Wall -Wextra` against real headers; Turtle escaped; single-pass substitution | — | ✅ |
| Artefact discovery (FUNC-21) | **Strong** | 11/15 red at v1.5.0; live `My Verb`-style PRODUCT_NAME; CI artefact verification. ⚠ symlink-following gap logged in §A | containment on discovered artefacts | ✅ with ⚠ noted |
| PR #36 template changes (`CMAKE_SOURCE_DIR/_tools`, custom `pluginsDir`) | **Strong** | `CMAKE-01/02` red at `0ec788f`; **live**: custom `pluginsDir:"synths"` + vendored `_tools/clap` → built `build/synths/DeepPlugin/…/DeepPlugin.clap` | — | ✅ |
| PR #38 `LV2URI` fix | **Strong** | CI-caught red (JUCE `static_assert` on scheme-less derived URI) → fix + regression tests requiring scheme-prefixed unique LV2URI + changelog entry — the correct loop, observed working | — | ✅ |

### D. CI gates

| Claim | Level | Basis | Required next evidence | Sufficient to tag? |
|---|---|---|---|---|
| 11 verification jobs + publish gated on all; `publish` only on `v*` tags | **Strong** | workflow file + API: green runs `43817093143` (PR #35), `43952384395` (main `6c23658`), `43954414936` (main `fdbb0ce`); publish `skipped` on non-tag runs; 40-hex action pins; no `continue-on-error` | — | ✅ |
| Real validators exercised (clap-validator 0.4.1, pluginval 1.0.4) | **Strong** | install-from-release steps + "Validate it with the real …" steps `success` on this tree; `smoke-validate.mjs` verified to **exit non-zero on missing deps** (code) and require a PASS; raw logs on a blocked host — step-level API conclusions used | (optional) re-publish the validate step's log tail as a check-run annotation — already implemented in the workflow | ✅ |
| macOS matrix; Windows honestly unverified | **Strong** | 2×2 matrix green; no Windows runner; docs declare it | — | ✅ |

### E. Dependencies, license gate, packaging

| Claim | Level | Basis | Required next evidence | Sufficient to tag? |
|---|---|---|---|---|
| 0 vulnerabilities; two direct runtime deps; 163 lockfile packages | **Strong** | ran all three; CI runs the same plain `npm audit` | — | ✅ |
| License gate enforces policy | **Strong** | **12/12 adversarial tamper tests** (on a /tmp copy): prod GPL-3.0 → exit 1; dev-only violation → warn/exit 0, `--strict-dev` → exit 1; `reviewed_packages` bypass works as documented; `MIT OR GPL-3.0` allowed, `MIT AND CC-BY-4.0` rejected, `Apache-2.0 WITH LLVM-exception` allowed, `SEE LICENSE IN…` → violation; missing/malformed/empty lockfile and missing decisions file all exit 1. Wired into `check`, CI `license` job, and `publish.needs` | note: `reviewed_packages`/`allowed_licenses` edits require repo write — accepted trust boundary | ✅ |
| `files` ships only `index.js` + `templates/`; no tests or secrets | **Strong** | `npm pack --dry-run`: 27 files (LICENSE, README, package.json, index.js, 23 template files), 47.6 kB — **no** tests, scripts, docs, `AUDIT-2.0.0-RELEASE.md`, `license_decisions.yml`, fixtures, or workflows; secrets-pattern scan of shipped files clean (3 false positives only) | — | ✅ |

### F. Residual risks — the user-directed spotlight

| Documented residual risk | Substantiation | Level |
|---|---|---|
| PATH-resolved validator binary chosen by `apc-mcp.json` | Accurately described in security.md; `SAFE_TARGET` verified live; **but no in-repo test** (see §B), and the artefact-symlink escape (§A) gives a config-writer indirect control over the validator's *argument* as well — not documented | **Moderate** — add the test + one sentence |
| Prompt-injection DoS ("building a non-existent target fails harmlessly, invalid project path rejected, obnoxious name writes only inside root") | Bogus-projectPath: tested (QA-05). Non-existent target: **untested** (true by cmake's behaviour). Timeouts/maxBuffer cap hangs — code-verified, untested, and DEF-1 degrades the lint timeout report. **F1 (CMAKE_PROJECT_INCLUDE) is a prompt-injectable out-of-project write via cmake that the residual-risk section does not mention at all** | **Weak → Failed** — rewrite the section; this is the largest substantiation gap in the repo |
| "No host-load test", "Windows unverified", "macOS CFBundle unpackaged" | All consistent with the workflow (verified) — the docs *under*-claim here, which is correct behaviour | **Strong** |

---

## 4. Doc drift introduced after PR #36 (all still present on main tip `fdbb0ce`)

1. `docs/security.md:36` says **"2 MB maxBuffer"** — code has been **16 MB** since PR #36.
2. `docs/project-status.md:25` says **"221 tests, 213 pass"** — actual on this tree: **230 tests, 222 pass, 8 skipped** (+#38's tests on main).
3. `docs/project-status.md` maintainer trap #3 and `docs/toolchain.md:64` say a custom `pluginsDir` **breaks** the `_tools/` fallback — PR #36's `CMAKE_SOURCE_DIR/_tools`-first lookup **fixed** this (verified live with `pluginsDir:"synths"`); the docs describe the old behaviour.
4. **CHANGELOG.md has no entry for PR #36's hardening** (maxBuffer, ENOBUFS, options grammar, C++ keyword rejection, dangling-symlink handling, deterministic hash codes, cleanup-on-failure) — the repo's own standard (every 2.0.0 change in the changelog) was violated by that PR.
5. `docs/tools.md` still describes `options` as just "Space-separated `-DNAME=VALUE` flags" — the enforced grammar (`-D/-U/-W…` only) is an undocumented behavioural change.

None of these is dangerous; all of them are exactly the "looks finished" drift an evidence officer exists to catch, and all are cheap to fix before a tag.

---

## 5. Verdict — sufficient to tag 2.0.0?

**Core substantiation is genuinely strong**: security containment, no-shell, template correctness, CI gating and the license/packaging gates all survive adversarial reproduction, and the test suite has *proven* red phases at every pre-fix commit I probed — including the newest code. The historical claims (v1.5.0 vulnerability, audit closures) check out against the actual tagged sources.

**Blockers before tagging (3):**
1. **Rewrite the residual-risk section** (security.md) — the "no arbitrary file read/write outside the project root" absolute is falsified by F1 (`CMAKE_PROJECT_INCLUDE`, reproduced), the artefact-symlink escape (reproduced), and the symlinked-config read (reproduced). State the true boundary: apc-mcp's own file ops are contained; the cmake/compiler subprocesses it launches execute project-controlled code and are not containable.
2. **Fix DEF-1** (lint dry-run discards timeout/crash/ENOBUFS cause and advises `fix=true`) — a failure-reporting defect in the one branch the honesty claim name-checks.
3. **Fix F4** (`{"constructor":…}` breaks every tool call via the config prototype-chain lookup) — one line + test; it contradicts the documented forward-compatibility guarantee.

**Should-fix before tagging (5):** F3 (space-in-path errors on exit 0), F2 (count `***Skipped`), F7 (single `../` in `-D` values passes the guard its test claims blocks `..`), the missing `validateCommand`/`clapValidatorCommand` regression test, and the §4 doc-drift batch (maxBuffer, test counts, `_tools` trap, CHANGELOG entry for #36, options grammar).

Everything else: **sufficient as it stands.**

---

## Remediation record — 2026-11-17

All three blockers and all five should-fixes were fixed in this branch on the
same day the audit was delivered. Method: each fix landed with a regression
test, the pre-fix `index.js` was then restored via `git stash` and the new
suite run against it — **10 tests failed (red) on the pre-fix tree, 0 after
(purple→green observed directly)** — then the full gate (`npm run check`)
was re-run on the fixed tree.

| Finding | Fix (index.js unless noted) | Regression test (red on pre-fix) |
|---|---|---|
| Blocker 1 — residual-risk absolute | security.md residual-risk section rewritten (own-file-ops contained vs subprocess boundary not containable); plus the two symlink escapes below fixed in code, per the "add containment or document" remedy — both were done | `SUB-6` (config symlink) + `SUB-4` (artefact symlink) below |
| Blocker 1 component — artefact symlink escape | artefact paths `assertWithinProject`-checked before validation; escaped artefacts → `REFUSED`, `isError: true`, validator never spawned | `SUB-4 · refuses a format directory symlinked outside the project root`, `mixed run: validates the contained artefact, refuses only the escaped one` (tool-output.test.js) |
| Blocker 1 component — config symlink read | `apc-mcp.json` symlink resolving outside project root ignored with stderr warning; inside-project symlinks honoured | `SUB-6` both tests (security.test.js) |
| Blocker 2 — DEF-1 lint dry-run misreport | non-zero clang-format exit with zero per-file diagnostics → `## Lint failed` + cause; `fix=true` advice only when diagnostics exist | `DEF-1 · reports the clang-format failure cause and never advises fix=true` |
| Blocker 3 — F4 prototype-key crash | `Object.hasOwn(CONFIG_SCHEMA, key)` own-property lookup | `F4 · prototype-chain keys (constructor, toString, __proto__) are unknown keys, not crashes` |
| Should-fix F3 — space-in-path diagnostics | `DIAGNOSTIC_PATTERNS[0]` `\S+?`→`.+?`, `[1]` `[^\s(]+`→`[^(`+non-greedy | `F3 · clang/gcc…` and `F3 · MSVC…` (both exit-0 isError) |
| Should-fix F2 — skipped tests | `***Skipped`/`Skipped` counted as third category; all-skipped run header `Tests skipped (none ran to completion)`; existing `Passed: 1, Failed: 1, Total: 2` assertions unchanged (skipped appended only when > 0) | `F2 · counts ***Skipped as its own category in a mixed run`, `F2 · a run whose every test was skipped is not reported as "Tests passed"` |
| Should-fix F7 — single `../` in `-D` value | value after first `=` re-checked with `hasDotDot` | `SEC-NEW-02` loop extended with `-DTEST=../outside`, `-DSDK=..\outside`, `-DROOT=..` |
| Should-fix — missing validator-command test | (no code change; behaviour was already correct — coverage only, green pre-fix by design) | `SUB-5 · clapValidatorCommand is honoured end-to-end`, `SUB-5 · validateCommand values failing SAFE_TARGET degrade to the default` |
| Should-fix — doc drift | security.md 16 MB maxBuffer + layer 3/3b/5 rows updated; tools.md options grammar; toolchain.md + project-status.md `_tools` root-first; project-status.md counts (243/235/0/8, 2026-11-17); CHANGELOG gained the PR #36 entry and this round's section | `npm run docs:check` (141 relative paths resolve) |

Red-phase evidence: `git stash push -- index.js` → `node --test
tests/tool-output.test.js tests/security.test.js` → **87 pass / 10 fail**
(F2 ×2, F3 ×2, DEF-1, F4, SUB-6-outside, SEC-NEW-02 extended, SUB-4 ×2);
`git stash pop` → **97 pass / 0 fail**. Full gate on the fixed tree:
lint PASS, **243 tests / 235 pass / 0 fail / 8 skipped**, smoke 10/10,
audit 0 vulnerabilities, licenses 163/163, docs:check PASS.

Not addressed (out of scope, graded non-blocking in the verdict): F5 — the
WebView template's "Level" bar is driven by gain, not an audio-level
measurement (VERIFICATION-MATRIX Medium; misleading label, not a defect in this
server). F6 is the VERIFICATION-MATRIX name for the single-`../` `-D` gap —
that one **is** fixed here (F7 row above; the two logs use different IDs for
the same defect).

---

## Merge note — reconciliation with the concurrent security review (2026-11-17)

While this remediation was in flight, an independent second security review
(`SECURITY-REVIEW-2.0.0.md`, PR #43) landed on `main` and fixed three of the
same defects from its own findings: the artefact-symlink escape (their
SEC-NEW-05), the lint dry-run misreport (their SEC-NEW-08, same branch as this
log's DEF-1), and the `maxBuffer` doc drift (their SEC-NEW-07). It also closed
the F1 execution vector this log had graded "document, not fix", via a
`CMAKE_VARS_THAT_EXECUTE` blocklist plus `CMakeCache.txt` sanitisation.

This branch merged with that work rather than duplicating it. The reconciliation:

- **Adopted from main** (their implementation, their wording): write-time
  containment, the code-loading `-D` blocklist, cache sanitisation, the lint
  `could not run` branch, `findPluginBinaries()`' symlink/outside skip.
- **Kept from this audit on top**: a refused artefact now **fails** the run
  (header `N refused`, named list, `isError: true`, and a dedicated
  `## Validation refused` report when every discovered artefact was skipped —
  main's "No plugin binaries found" was misleading for a tree that did contain
  one); plus everything still absent from main: F4 (prototype-key lookup),
  config-symlink containment, F2 (ctest skips), F3 (space-in-path diagnostics),
  F7 (single `../` in `-D` values), and the validator-command regression tests.
- **Residual-risk statement** (blocker 1): both rewrites were combined — the
  review's blocklist/race paragraphs plus this log's subprocess-boundary
  framing, including the honest caveat that a blocklist of known code-loading
  variables is enumerated knowledge, not a proof.

Red phase re-verified after the merge against main's `index.js` (see
`git diff origin/main -- index.js` for exactly the unique deltas): the F2, F3,
F4, F7, config-symlink and refused-isError tests fail on main's code and pass
on the merged tree. Full gate on the merged tree: lint PASS, typecheck PASS,
**273 tests / 265 pass / 0 fail / 8 skipped**, smoke 10/10, audit 0
vulnerabilities, licenses 179/179, docs:check PASS.
