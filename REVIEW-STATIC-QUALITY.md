# apc-mcp — static quality review

**Date:** 2026-11-16 · **Tree:** `0ec788f` (branch `arena/2451bc2f-apc-mcp`, clean) · **Reviewer stance:** pedantic, adversarial, evidence-first.
**Scope:** `index.js`, `templates/**`, `eslint.config.js`, `scripts/**`. No features proposed; every item is a defect, a missing control, or a false statement in code or comments.

Everything marked **reproduced** below was executed in this checkout. The harness:

| Tool | Version | What it was used for |
|---|---|---|
| Node / npm | 22.22.3 / 10.9.8 | `npm ci`, `npm run check`, MCP calls through `tests/helpers/mcp-client.mjs` |
| ESLint | 10.15.0 | bypass probes (`--stdin --stdin-filename`) |
| CMake / Ninja | **4.4.5** / 1.13 (installed via pip for this review) | configured, built and **installed** generated LV2 + CLAP projects |
| gcc / g++ | 12.2.0 | strict-warning compiles of generated C and C++ |
| Upstream sources | `free-audio/clap` @ 1.2.10, `lv2/lv2` `core/lv2.h`, `juce-framework/JUCE` @ 9.0.5 | API and macro verification |

**Status: fixed on branch `arena/2451bc2f-apc-mcp`** — see [§8 Resolution log](#8-resolution-log-branch-arena2451bc2f-apc-mcp) for what changed, what was executed to prove it, and the one item deliberately deferred.

Counts: **1 High, 5 Medium, 9 Low, 4 Info.** No Critical. No live shell injection, no SEC-01 regression, and the generated real-time code is allocation-free — those are verified, not asserted (§3, §4).

---

## 1. The finding that matters

**S-1 — the eslint "no shell" rule enforces a name, not the invariant.** `eslint.config.js:74-90`. The repo's security narrative rests on "`spawnSync` with argument arrays, never a shell", and this lint config is the only mechanical guard. It can be bypassed on two independent axes, both reproduced:

```console
$ printf 'import cp from "node:child_process";\nimport * as cps from "node:child_process";\nexport function f(){ cp.execSync("rm -rf /"); return cps.exec("ls"); }\n' \
    | npx eslint --no-ignore --stdin --stdin-filename index.js
$ echo $?
0                                    # ← passes: default/namespace imports are invisible to it

$ printf 'import { spawnSync } from "node:child_process";\nexport function g(){ return spawnSync("sh", ["-c","id"], { shell: true }); }\n' \
    | npx eslint --no-ignore --stdin --stdin-filename index.js
$ echo $?
0                                    # ← passes: { shell: true } re-opens the hole on the *sanctioned* API

$ printf 'import { execSync } from "node:child_process";\nexport const h = () => execSync("ls");\n' \
    | npx eslint --no-ignore --stdin --stdin-filename index.js
$ echo $?
1                                    # only the direct named import is caught
```

**Why it is bad for this tool:** `no-restricted-properties` matches an object literally named `child_process`, and `no-restricted-syntax` matches only `ImportSpecifier`s. `spawnSync(cmd, args, { shell: true })` — the one option that turns an argv array back into a shell string — is not restricted at all. There is no such call in the tree today (grep: zero `shell: true`), so this is a **latent control gap, not a live vulnerability**; but the gap sits exactly where the project's security argument is thinnest, and a single future `{ shell: true }` would be invisible to `npm run check`.

**Fix** (4 lines, no new dependency):

```js
'no-restricted-syntax': ['error',
  { selector: "ImportSpecifier[imported.name=/^exec(Sync)?$/]", message: '…' },
  // any non-false `shell` option anywhere: that is the shell-injection switch
  { selector: "Property[key.name='shell']", message: 'Never pass `shell` to child_process — it re-enables a shell.' },
  // binding-agnostic: catches default/namespace imports and aliases
  { selector: "CallExpression[callee.name=/^(exec|execSync)$/]", message: 'exec*() invokes a shell.' },
  { selector: "MemberExpression[property.name=/^(exec|execSync)$/]", message: 'exec*() invokes a shell.' },
],
```

---

## 2. Findings

### HIGH

| # | Location | Finding |
|---|---|---|
| **S-1** | `eslint.config.js:74-90` | No-shell lint enforced by name only; `{ shell: true }`, default/namespace imports and aliases all pass. Reproduced above. **Fix:** additional `no-restricted-syntax` selectors as shown in §1. |

### MEDIUM

| # | Location | Finding |
|---|---|---|
| **S-2** | `index.js:1128-1153` | **A failed `clang-format` is reported as "found issues" with contradictory counts.** When the tool exits non-zero but prints no diagnostics, `badFiles` is empty and the report is "`Files with problems: 0 of 1`" plus "`Run with fix=true to auto-format`" — advice that would fail the same way. Reproduced with a `clang-format` shim that `exit 1`s silently:<br>`## Lint found issues` / `Files with problems: 0 of 1` / `Run with fix=true to auto-format.`<br>**Why:** an MCP client feeds this straight back to the model, which will retry with `fix=true` (a *write*) instead of investigating the binary. **Fix:** `if (!r.ok && badFiles.length === 0)` → report `clang-format exited N` with the stderr/output tail, and drop the "run with fix=true" line. |
| **S-3** | `index.js:489-497`, `1156-1160` | **Lint silently skips unreadable trees and then claims the project is clean.** `findFilesByExt` does `catch { return; }` on `readdirSync`, so a permission error (or a directory removed mid-walk) drops a whole subtree, and the caller still answers "`No formatting issues found across project.`" — a false clean with `isError: false`. **Why:** for a lint tool that can rewrite sources, "clean" must mean "I read everything". **Fix:** return `{ files, skipped: [{path, error}] }` and render `skipped` in the success report (and set `isError` when nothing could be read). Not reproduced here because the sandbox runs as root (`EACCES` is unobtainable); the branch is plain code. |
| **S-4** | `templates/lv2/CMakeLists.txt:87-93` | **`cmake --install --prefix` is silently ignored; the rule writes to `/usr/local/lib/lv2`.** `LV2_INSTALL_DIR` is expanded at configure time into an *absolute* `DESTINATION`, which de-relocates the whole install. Reproduced with CMake 4.4.5: `cmake --install build --prefix /tmp/probe/inst` installed to `/usr/local/lib/lv2/Lv2Probe.lv2/…` (generated `cmake_install.cmake` line 54 hard-codes the path), and the `--prefix` directory stayed empty. It wrote into the system prefix as an unprivileged user because the sandbox is root — on a normal machine it fails with EACCES, or with `sudo` it pollutes the system. **Why:** LV2 bundles are installed per-user (`~/.lv2`) or per-system; a scaffolder that cannot be relocated breaks packaging and CI. **Fix:** `set(LV2_INSTALL_DIR "lib/lv2")` (relative, so `--prefix` and `CMAKE_INSTALL_PREFIX` both apply), and let users override with an absolute path only when they mean it. |
| **S-5** | `templates/juce-webview/Source/PluginProcessor.cpp:11-12,41-48`; `WebViewEditor.cpp:148-152` | **Every generated gain plugin has a quantised parameter, no smoothing, and an unclamped control path.** (a) `NormalisableRange<float>(0.0f, 1.0f, **0.01f**)` makes the parameter stepped, so host automation moves in 1 % jumps. (b) `const float gain = m_gain->get();` is applied per block with no `juce::SmoothedValue`, so every move is a step discontinuity — audible zipper noise, especially driven by the 30 Hz timer in the webview UI. (c) `*gainParam = static_cast<float>(params.getValue("data","1.0").getDoubleValue())` writes whatever JS asks for straight into the parameter — values above 1.0 are not clamped by the raw atomic write, so a UI bug becomes a loud output. **Why:** this is the audio path of *every* scaffolded gain plugin and the reference example users copy. **Fix:** continuous range (drop the interval), `juce::SmoothedValue<float, ValueSmoothingTypes::Linear>` reset in `prepareToPlay` and consumed via `getNextValue()` in the block loop, and `juce::jlimit(min, max, value)` in `handleJSAction`. |
| **S-6** | `index.js:846, 919, 964, 1026, 1204, 1354` | **No upper bounds on user-supplied strings.** `projectPath` is `z.string().optional()`, `name` is `.min(1).regex(SAFE_PLUGIN_NAME)` with no `.max()`, lint `target` is `.min(1).refine(…)` with no `.max()`. A 300-character name passes the schema and produces `ENAMETOOLONG` from `mkdir`, or a 300-character C++ class name; a 100 KB `projectPath` reaches `path.resolve` and fails with `ENAMETOOLONG` deep in a syscall instead of a clean `-32602` schema error. **Why:** MCP input is model-generated; unbounded strings are the norm, and schema messages are the only errors an LLM reliably acts on. **Fix:** `.max(1)` on `projectPath` isn't right — use `.max(4096)` (paths) and `.max(64)` (name, CMake target length), and add `.max()` to `target`/`testName`. |

### LOW

| # | Location | Finding |
|---|---|---|
| **S-7** | `index.js:691-697` | **`turtleEscape` and `cxxStringEscape` are byte-identical** (`String(text).replace(/\\/g,'\\\\').replace(/"/g,'\\"')`). Two names, one behaviour, zero reason to diverge — except that Turtle escaping also needs `\n`, `\r`, `\t` handling, and C++ needs the same plus trigraph-adjacent cases; the day someone fixes one they will not fix the other. **Fix:** one `escapeBackslashQuote()` used by both, or keep two and add a comment stating the intended divergence. |
| **S-8** | `index.js:195-201`, `225` | **`spawn()` is synchronous.** A function named `spawn` that calls `spawnSync` is the kind of naming that makes a reviewer's "no shell" audit harder, not easier; rename `captureSync`. Related: `maxBuffer: 2 * 1024 * 1024` — when a verbose JUCE build exceeds it, `result.error.code` is `ENOBUFS` and `trySpawn` reports `'cmake' could not be started: … ENOBUFS`, which is a *wrong* diagnosis (cmake started fine; its output was too big) at exactly the moment the user needs the output. **Fix:** map `ENOBUFS` to "output exceeded 2 MB — rerun with `-j1` or a narrower target", and keep the truncated stdout. |
| **S-9** | `index.js:1294-1296` | **`--strictness-level 10` is hard-coded and the validator spawn has no `cwd`.** 10 is pluginval's maximum: it enables the fuzz/GUI categories that legitimately fail for a work-in-progress plugin, and there is no config key to lower it even though `apc-mcp.json` already carries per-format validator names. Separately, `trySpawn(bin, args, { timeout: 120 })` inherits the *server's* working directory, so pluginval's log files land wherever the MCP client happened to start — outside the containment story. **Fix:** `strictnessLevel` config key (default 5, pluginval's own default), clamp 1-10; pass `cwd: proj`. |
| **S-10** | `index.js:945-951` + `45` | **`options` is split on whitespace, and quotes are forbidden by the charset.** `SAFE_OPTIONS` has no `"`, so `-DCMAKE_PREFIX_PATH="/Users/me/My Plugins"` is impossible to express; and `params.options.split(/\s+/)` would break it into two argv entries anyway. Any `-D` value containing a space is unusable. **Fix:** `options: z.array(z.string())` (breaking but correct), or split on `;` and document it. |
| **S-11** | `templates/juce/CMakeLists.txt:68`, `juce-webview/CMakeLists.txt:85`, `standalone/CMakeLists.txt:75` | **`JUCE_DISPLAY_SCALE_ENABLED=1` does not exist.** GitHub code search over `juce-framework/JUCE`: `JUCE_DISPLAY_SCALE_ENABLED` → **0 hits**; `JUCE_MODAL_LOOPS_PERMITTED` → 38; `JUCE_VST3_CAN_REPLACE_VST2` → 11. It is a hallucinated config flag: harmless (an unused macro) and therefore never noticed. It also teaches the user that display scaling is a config flag. **Fix:** delete it from all three files. While there: `JUCE_MODAL_LOOPS_PERMITTED=1` is a poor default for a *plugin* (modal loops can deadlock hosts); JUCE's own default is 0 — recommend removing that too. |
| **S-12** | `templates/juce/CMakeLists.txt:36-37`; `juce-webview:31-32`; `standalone:46-47` | **Fabricated company metadata.** `COMPANY_WEBSITE "https://{{VENDOR_CMAKE}}.com"` and `COMPANY_EMAIL "dev@{{VENDOR_CMAKE}}.com"` invent a domain from the vendor *display name*. With `vendor="ACME, Inc."` the .vst3/.component metadata ships `https://ACME, Inc..com` — an invalid URL — and the e-mail likewise. This is the "plausible-looking invention" failure mode in its purest form. **Fix:** drop both keywords (they are optional in `juce_add_plugin`), or emit `https://example.com` / `dev@example.com` as obvious placeholders. |
| **S-13** | `templates/lv2/Source/plugin.ttl:23, 27, 43-73` | **LV2 metadata calls a gain a `lv2:UtilityPlugin`**, asserts `doap:license <https://opensource.org/licenses/MIT>` on the user's behalf (a licence choice the scaffolder has no business making, and an opensource.org URL of the old shape), and omits `lv2:designation lv2:left`/`lv2:right` on the stereo ports. **Why:** hosts classify plugins and pair channels from these triples; a wrong class changes where the plugin appears in host menus. **Fix:** `lv2:AmplifierPlugin` (lv2core: "primarily designed to change the volume of its input"), make the licence triple a template variable or remove it, add `lv2:designation`. |
| **S-14** | `templates/lv2/Source/plugin.c:99-106` | **The NULL-port guard's comment is false.** "turns a malformed host into silence" — the early `return` leaves the output buffer *untouched*, so a host that failed to connect `in_l` gets whatever was in the buffer (stale audio or garbage), not silence. **Fix:** when only an input is missing, `memset` the connected outputs to 0; or correct the comment to "returns without writing, so output is whatever the host left there". |
| **S-15** | `templates/juce/Source/PluginProcessor.cpp:27-42` | **The "passthrough" loop copies each channel onto itself.** `channelData` and `outData` are the same pointer (`getReadPointer`/`getWritePointer` for channel *i*), so `outData[sample] = channelData[sample]` is a self-assignment; it also takes a writable pointer for data it only reads, which weakens JUCE's aliasing story and reads as if processing were happening. **Why:** it is the first thing a user edits; they will add DSP into a loop that has already taught them the wrong buffer access pattern. **Fix:** delete the loop (a passthrough needs no code) or make it a real gain with `SmoothedValue`. |
| **S-16** | `templates/standalone/Source/MainComponent.cpp:81-91` | **`buffer.setSample()` per sample in the audio callback.** `AudioBuffer::setSample` is bounds-checked in debug builds and re-resolves the channel pointer per call; the idiomatic form clears once and writes through `float*` per channel. Not a correctness bug, but it is a *template* — the pattern is what gets copied. **Fix:** `bufferToFill.clearActiveBufferRegion()` then `auto* ch = buffer->getWritePointer(c)` outside the loop. |
| **S-17** | `index.js:633-634` | **`case 'juce': default:` silently maps any unknown `type` to the JUCE template.** Unreachable today because the zod enum gates it — which is exactly what makes it dangerous: when a template is added or renamed, the forgotten `switch` arm degrades into "scaffold a JUCE plugin" rather than an error. **Fix:** drop `default`, add an `assertNever` throw. |

### INFO

| # | Location | Finding |
|---|---|---|
| **S-18** | `index.js:1180-1200` | `audio_plugin_plugins` reads `status.json`, refuses symlinks, and reports parse errors — careful code for a file **nothing in the repo writes**. It is documented in `docs/configuration.md` and `docs/tools.md` as user-authored metadata, so it is a deliberate extension point; consider either scaffolding a `status.json` in `audio_plugin_create` or noting "no tool writes this" in the docs. |
| **S-19** | `scripts/ship.mjs:54-62, 70` | `spawnSync(NPM_CMD, …)` with `NPM_CMD = 'npm.cmd'` on Windows throws `EINVAL` without `shell: true` (Node refuses to spawn batch files directly); and no `spawnSync` in this file has a `timeout`, so an interactive git credential prompt blocks forever. Windows is documented as unverified, so this is consistent with that — but the `.cmd` path is the kind of thing a "we support Windows paths" claim invites. |
| **S-20** | `index.js:846-1210` | **No tool declares `outputSchema` / `structuredContent`.** `audio_plugin_plugins` already has a `format: 'json'` mode that returns a JSON string inside `content[0].text` — the SDK supports declaring `outputSchema` and returning `structuredContent`, which is what a machine-consuming client prefers over re-parsing prose. Low priority, but it is "incomplete schema" by the reviewer's definition. |
| **S-21** | `index.js:97-110` | `assertWithinProject` is sound (realpath ancestor-walk; direct and symlinked escape checks verified in the previous audit), with two residual soft spots: `catch { return resolved; }` when `realpathSync(root)` fails **silently skips the symlink check** (fail-open), and the check-then-write is TOCTOU-exposed. Neither is reachable through the seven tools as they stand. **Fix if you want it airtight:** fail *closed* on realpath errors, and `O_NOFOLLOW`/`realpath` immediately before each write. |

---

## 3. The claims I was asked to verify

| Claim | Verdict | Evidence |
|---|---|---|
| **"No shell, argument arrays only"** | **Holds.** | No `exec`/`execSync`/`execFile`/`fork`/`shell: true` anywhere in `index.js`, `scripts/**` (grep). All seven tools reach the toolchain through `trySpawn(cmd, argv)`; user values appear only as discrete argv entries (`params.target`, `cfg.*`, `testName`, `options`). No `spawn` of a shell string. |
| **"eslint bans `exec`/`execSync`"** | **Literally true, materially incomplete.** | Direct named import is caught; default import, namespace import, aliasing and `{ shell: true }` are not (§S-1, reproduced). |
| **"Generated real-time code is allocation- and lock-free"** | **Holds for all four audio callbacks.** | CLAP `process` (`templates/clap/Source/PluginProcessor.cpp:127-172`): no allocation, no locks, no I/O, gain read once per block, null-guards on every buffer, zero-fills unmatched output channels. LV2 `run` (`plugin.c:95-120`): same; control port dereferenced once. JUCE `processBlock`: `ScopedNoDenormals`, no allocation, `getTotalNum*Channels` only. Standalone `getNextAudioBlock`: atomic load `memory_order_relaxed`, `std::sin`, no allocation; `setSample` perf nit only (S-16). |
| **"eslint + `node --check` is the static bar"** | **Adequate but thin.** | No type checking, no arithmetic on `result.error` nullability, no dead-code detection, nothing for C++/CMake/Turtle (§5). |
| **Path containment / SEC-01 not regressed** | **No regression found.** | `..` rejected before resolution *and* re-checked by `assertWithinProject` (`index.js:1046-1070`); symlinked `plugins/`, symlinked `status.json`, symlinked root `CMakeLists.txt` all refused (`1053`, `1187`, `1424`); `findFilesByExt` skips symlinks; build/validate paths come from a config validated by `RELATIVE_DIR` (`270-276`). |
| **Zod schemas complete** | **Mostly; three gaps.** | Missing `.max()` on `projectPath`/`name`/`target`/`testName` (S-6); `options` is a string with lossy parsing instead of an array (S-10); no `outputSchema` (S-20). Enums (`type`, `ui`, `config`, `format`, `validateFormats`) are exhaustive and match the templates' capabilities. |
| **Maintainer traps in `docs/project-status.md`** | **Still accurate.** | The documented traps (JuceHeader generation, `PRODUCT_NAME` ≠ directory name, artefact suffix scanning, `-G` on a cached generator, `_tools` fallback) are all implemented as described. |

---

## 4. What is genuinely clean (checked, not assumed)

- **Generated C and C++ compile warning-free under a strict set.** `gcc -std=c11 -Wall -Wextra -Wpedantic -Wshadow -Wcast-qual -Wcast-align -Wswitch-enum -Wstrict-prototypes -Wmissing-prototypes -Wconversion` on `plugin.c`: **0 warnings**. `g++ -std=c++20 -Wall -Wextra -Wpedantic -Wshadow -Wconversion` on both CLAP translation units: **0 warnings** (only upstream `clap/version.h` trips `-Wold-style-cast`). Enabling these flags in the CLAP/LV2 CMakeLists is therefore free.
- **The generated projects actually build.** CMake 4.4.5 + Ninja configured and compiled the LV2 bundle (`.so` + both `.ttl` copied into `<name>.lv2/`) and the CLAP module (`.clap`) with no warnings.
- **CLAP ABI usage is correct**, including the current `process->audio_inputs` declaration (`const clap_audio_buffer_t *`, not the older double pointer) — the `const auto &in = process->audio_inputs[0]` binding is right for this header, and `in_place_pair = 0` on the output legitimately declares port 0 pairing (and the loop is in-place safe); setting it on the *inputs* is inert rather than wrong, contra the earlier audit's framing.
- **Escaping chain is correct where it matters.** The four vendor placeholders and three description placeholders are each substituted in one pass (`replaceTemplateVars`), and the CMake level really does emit 3 backslashes per quote (verified byte-for-byte by scaffolding `ACME, Inc. & "Sons"`).
- **`assertProjectRoot`, `loadProjectConfig` per-key validation, honest `isError` paths, and the `registerTool` wrapper** do what their comments claim.

---

## 5. Missing static analysis (ordered by value per minute)

All nine are now in place; the last column says what each one found when it was first
run, because a gate that has never produced a finding has not been proved to work.
Details of the wiring, and the two deliberate omissions, are in §8.

| Add | Would have caught | Where | Status (evidence) |
|---|---|---|---|
| **`{ shell: true }` + binding-aware `child_process` rules** | S-1 | `eslint.config.js` | **Done in PR #37** — the rule is exercised by linting four violations through the real config (`tests/release.test.js`) |
| **`tsc --noEmit --checkJs` over `index.js` + `scripts/`** | S-6, S-8, S-21, the `var`→`float` casts | `package.json`, `tsconfig.json` | **Done** — `npm run typecheck`, inside `npm run quality` and the CI `test` job. Found 4 real defects: `.error.code` read behind a type without `code` (4 sites); `audio_plugin_validate` rows mixing `reason`/`output` across statuses |
| **`-Wall -Wextra -Wpedantic -Werror` in `templates/clap` and `templates/lv2`** | Nothing today — it keeps it that way | template CMakeLists | **Done** — `PRIVATE` on the generated target, `/W4 /WX` under MSVC, third-party headers `SYSTEM`. Both templates build with 0 warnings against real headers; `tests/templates.test.js` fails if a flag is dropped |
| **`clang-tidy` in the `scaffold-clap` / `scaffold-lv2` jobs** | S-14, S-15, S-16 class | `.github/workflows/publish.yml`, `.clang-tidy` | **Done** — driven by `compile_commands.json` through `smoke-scaffold.mjs --clang-tidy`, with the config passed explicitly (`--config-file=`); findings are errors. Found `performance-trivially-destructible` on the CLAP template's out-of-line `= default` destructor. `readability-*`/`cppcoreguidelines-*` excluded on purpose (§8) |
| **`lv2lint` / `sord_validate` on the generated bundle** | S-13 | `scaffold-lv2` job | **Done (lv2lint)** — `--lv2lint` fails when the tool is absent, and CI builds lv2lint from the pinned upstream mirror (no distribution packages it). `sord_validate` skipped: it needs the LV2 schemas staged on disk and `lv2lint` already validates through lilv against lv2core |
| **`cmake --install` smoke (with `--prefix`)** | S-4 | `scaffold-lv2` job | **Done** — `--install` asserts the bundle lands under the prefix with binary + both `.ttl`, and fails if `/usr/local/lib/lv2/<name>.lv2` appeared anyway |
| **`cmake-lint` / `cmakelang`** | S-4 class, inconsistent `cmake_minimum_required` | `scripts/`, CI | **Done** — `npm run cmake:lint` + the CI `lint-config` job, configured by `.cmake-format.py` that states the house style instead of disabling `C0301`/`C0307`. Found two 121-column `OUTPUT_DIRECTORY` lines in the LV2 template |
| **`shellcheck` + `actionlint`** | The CI bash and workflow syntax | CI | **Done** — the `lint-config` job runs `actionlint` (which runs `shellcheck` over every `run:` block), pinned to a commit, and `publish` now needs it |
| **`eslint-plugin-n`** | S-19, `process.exit` in scripts | `eslint.config.js` | **Done** — recommended module rules + `n/prefer-node-protocol`. Found 2 real defects: `import.meta.dirname` in `scripts/smoke-stdio.mjs` (crashes on Node 22.0–22.15, which `engines` allows) and four unprefixed `node:` imports |

## 6. Magic-number inventory (all intentional today; none configurable)

| Value | Where | Why it is a smell |
|---|---|---|
| `180 / 120 / 300 / 600 s` | `index.js:197, 875, 888, 953, 980` | Four different spawn budgets with no comment tying them to a workload; a large JUCE build can legitimately exceed 600 s. |
| `2 * 1024 * 1024` | `index.js:199` | Silent-truncation threshold, reported as a *start* failure (S-8). |
| `'--strictness-level', '10'` | `index.js:1295` | Maximum strictness, not configurable (S-9). |
| `BATCH_SIZE = 200`, `> 100 ? 120 : 60` | `index.js:1101, 1108` | Two tied constants with no explanation of the 100/120/60 relationship. |
| `slice(-2000)` ×3, `slice(0, 20)` | `index.js:896, 999, 1014, 434` | Output truncation budgets chosen once and copied. |
| `i < 20` | `index.js:322` | Max directory depth for project-root discovery. |
| `30` Hz, `440.0` Hz, `0.001` f | `WebViewEditor.cpp:61`, `MainComponent.h:43`, `WebViewEditor.cpp:112` | UI poll rate, demo tone, change threshold. |
| `VERSION 1.0.0` ×3, `"1.0.0"` | template CMakeLists, `clap/PluginProcessor.cpp:24`, `plugin.ttl:35-36` | Five places that must agree and are not derived from one variable. |

---

## 7. Bottom line

The Node side is better than most MCP servers I read: honest error propagation, a real path guard, per-key config validation, no shell, no dead catch blocks. The generated C++ is genuinely real-time safe and, as of today, warning-clean under a strict compiler.

What remains is the residue of generation rather than engineering:

1. **Controls that look stronger than they are** — the no-shell lint rule names a variable instead of banning an option (S-1), and the lint report calls a crashed tool "0 of 1 files with issues" (S-2).
2. **Claims that were never executed** — `cmake --install` (S-4), the LV2 Turtle (S-13), and a JUCE config macro that does not exist (S-11) all survive because no job ever runs the thing that would disagree.
3. **Templates that teach the wrong pattern** — unquantise and smooth the gain (S-5), delete the self-copy passthrough (S-15), stop inventing company URLs (S-12).

Fix S-1 … S-5 and add `lv2lint` + `cmake --install` + `-Wall -Werror` to CI, and the static story matches the prose.

---

## 8. Resolution log (branch `arena/2451bc2f-apc-mcp`)

Every finding below was fixed at the root cause and, where a machine can check it, given a
guard that fails when the bug returns. Nothing in this section is hearsay: each "verified"
line names the command that was run in this checkout.

A parallel change (PR #36, `ffdfad0`) fixed a subset — S-1, S-2, S-3, S-8 and the
`npm.cmd`/`EINVAL` half of S-19 — before this branch was merged with it. Where that
happened the row describes the code as it ships after the merge and says so; the guards
added here run against the merged code, not against either implementation in isolation.

| # | State | Fix | Guard |
|---|---|---|---|
| **S-1** | Fixed | `eslint.config.js` now bans what actually reaches a shell: a default import, a namespace import, any `Property[key.name='shell']`, and a shell named as the spawn executable — not the literal variable name `child_process` | `tests/release.test.js` → "the no-shell rule is binding-based": four violations are linted through the real config and must exit non-zero; `RegExp.prototype.exec` and a plain `spawnSync('cmake', …)` must exit 0 |
| **S-2** | Fixed | lint tool failure is reported as a tool failure, not "0 of N files with issues" | existing lint-report tests |
| **S-3** | Fixed | `findFilesByExt` returns `{ files, skipped }`; skipped directories are surfaced in the report, and an entirely unreadable tree is `isError` | existing tool-output tests |
| **S-4** | Fixed | `DESTINATION` is `${CMAKE_INSTALL_LIBDIR}/lv2` via `include(GNUInstallDirs)` — relative, so `--prefix` and `CMAKE_INSTALL_PREFIX` both apply | `tests/templates.test.js` → "keeps the LV2 install destination relative"; verified for real: `cmake --install build --prefix /tmp/verify/inst` produced `inst/lib/lv2/VerifyLv2.lv2/{VerifyLv2.so,manifest.ttl,plugin.ttl}` and did **not** create `/usr/local/lib/lv2` (CMake 4.4.5, Ninja) |
| **S-5** | Fixed | gain is a continuous `NormalisableRange<float>(0.0f, 1.0f)` (no 0.01 quantisation), driven by a 20 ms `juce::SmoothedValue` reset from the host sample rate and advanced **once per sample** (sample-outer loop over `getArrayOfWritePointers()`, which is allocation-free); the WebView `setGain` handler rejects NaN, clamps to 0..1 and reports the change as a gesture (`beginChangeGesture`/`setValueNotifyingHost`/`endChangeGesture`) instead of trusting the page | `tests/templates.test.js` asserts the `reset(sampleRate, 0.02)` and `getNextValue()` calls and the absence of the per-block multiply; `tests/cpp-api.test.js` compiles and links the template against the JUCE stub |
| **S-6** | Fixed | `.max()` caps on `projectPath` (4096), `name` (64), `target` (256/4096), `testName` (512), `RELATIVE_DIR` (1024) | schema-level, exercised by the existing validation tests |
| **S-7** | Fixed | one `escapeBackslashQuote` helper instead of two divergent copies | — |
| **S-8** | Fixed | The spawn wrapper diagnoses `ENOBUFS` as output overflow (16 MB, naming the limit) instead of a start failure, and keeps the truncated stdout. The rename to `captureSync` was dropped in the merge: the wrapper is still called `spawn()`, because that is the name every call site and the ESLint rules use | — |
| **S-9** | Fixed | `strictnessLevel` is an `apc-mcp.json` key (1-10, default 10) instead of a hard-coded `10`, and the validator runs with `cwd: <project>` so its logs land in the project | documented in `docs/configuration.md`; existing `--strictness-level 10` assertion still passes because the default is unchanged |
| **S-10** | Fixed | `options` splits on `;` first, so `-DNAME=value with space` survives (bare whitespace splitting is kept for the common case) | documented in `docs/tools.md` |
| **S-11** | Fixed | `JUCE_DISPLAY_SCALE_ENABLED` deleted from all three JUCE templates (it has 0 references in JUCE 9.0.5); `JUCE_MODAL_LOOPS_PERMITTED` removed from the two **plugin** templates so a nested event loop cannot be compiled into a host callback, kept in `standalone` with a comment saying why an app may have one | — |
| **S-12** | Fixed | `COMPANY_WEBSITE` / `COMPANY_EMAIL` removed from all three `juce_add_*` calls — the vendor slug is a guess, and both fields ship verbatim in Windows DLL properties and VST3 metadata | — |
| **S-22** (found by CI while fixing S-12) | Fixed | Removing `COMPANY_WEBSITE` did not just blank a metadata field: `_juce_initialise_target()` derives `LV2URI = "${company_website}/plugins/${plugin_name}"`, so the plugin's **permanent LV2 identity** was `https://<guessed-domain>/plugins/<Name>` — and with no website it became `/plugins/<Name>`, which fails JUCE's `static_assert(startsWithValidScheme(...))` and broke the LV2 target in both real-JUCE jobs. Both JUCE plugin templates now pass `LV2URI "{{PLUGIN_URI}}"` (the same `urn:<ns>:<id>` the native LV2 template uses, from one derivation in `index.js`) | `tests/templates.test.js` → "passes LV2URI explicitly"; real JUCE build in CI |
| **S-13** | Fixed | `lv2:AmplifierPlugin` (lv2core: "primarily designed to change the volume of its input"); the fabricated `doap:license` triple is gone, replaced by a comment telling the user to add their own; the four audio ports carry `lv2:designation lv2:left` / `lv2:right` | `tests/templates.test.js` asserts all three; Turtle parsed with rdflib against a real scaffold (`AmplifierPlugin`, no `doap.license`, designations on in_l/in_r/out_l/out_r, 46 triples) |
| **S-14** | Fixed | the NULL-port guard now `memset`s the connected outputs, so "silence" is what the host actually gets instead of last block's samples | strict `gcc -Werror` compile of the generated `plugin.c` |
| **S-15** | Fixed | the self-copy pass-through loop is deleted; the comment says why a pass-through needs no code, leaving only the mandatory clear loop | `tests/templates.test.js` asserts `getReadPointer(` no longer appears in a JUCE `processBlock` |
| **S-16** | Fixed | `getNextAudioBlock` hoists `getArrayOfWritePointers()` out of the sample loop instead of calling bounds-checked `setSample()` per sample | `tests/cpp-api.test.js` stub compile |
| **S-17** | Fixed | the template map throws on an unknown type instead of silently falling through a `default:` arm | — |
| **S-18** | Fixed (docs) | `docs/configuration.md` and `docs/tools.md` now state that **no tool** writes `status.json`; no scaffolding was added, since that would be a new feature | `npm run docs:check` |
| **S-19** | Fixed | `ship.mjs` never spawns `npm.cmd` (which `EINVAL`s without `shell: true`): it runs npm's JS entrypoint (`npm_execpath`) with `process.execPath`. On top of that, every child now has a timeout and git runs with `GIT_TERMINAL_PROMPT=0`, so a missing credential fails the release instead of hanging it | `tests/release.test.js` → "spawns no .cmd shim and bounds every child process" |
| **S-20** | **Deferred** | `outputSchema` / `structuredContent` is a feature, not a defect fix, and this pass is scoped to findings. The `format: "json"` modes keep working; a client can still parse them | — |
| **S-21** | Fixed | `assertWithinProject` fails **closed** when `realpathSync` throws, with the underlying error attached as `cause`; the TOCTOU window remains and is documented as not reachable from the seven tools | existing path-guard tests |

§5's backlog — `lv2lint`, `cmake --install --prefix`, `-Wall -Wextra -Wpedantic -Werror` in the
CLAP/LV2 templates, `clang-tidy`, `cmake-lint`, `shellcheck`/`actionlint`, `eslint-plugin-n` and
`tsc --noEmit --checkJs` — was left open here and closed on branch `arena/535a7c23-apc-mcp`. §5's
table now carries the status of each gate and what it found; the wiring is:

- **`npm run typecheck`** (`tsconfig.json`, `checkJs`, no emit) covers `index.js`, `scripts/**` and
  `tests/helpers/**`; it is part of `npm run quality` and of the CI `test` job, so it cannot drift
  from the suite it type-checks.
- **`eslint-plugin-n`** adds its recommended module rules plus `n/prefer-node-protocol`.
  `n/no-process-exit` and `n/hashbang` are off, with the reason written where they are configured:
  these scripts are CLI entry points whose exit status is the interface, and they are not published
  `bin` shims.
- **The templates' compiler flags** apply `PRIVATE` to the generated target (`/W4 /WX` under MSVC)
  and include the third-party CLAP/LV2 headers as `SYSTEM`, so `-Werror` judges generated code only.
  Two proofs: both templates compile clean against real headers (CMake 4.4.5 + Ninja 1.13.2, gcc 12.2.0), and
  `tests/templates.test.js` fails if a flag, the `MSVC` guard, or the `SYSTEM` include is dropped.
- **`smoke-scaffold.mjs` grew `--install`, `--lv2lint` and `--clang-tidy`**, each of which *fails*
  when its tool is missing. It also stopped reporting a pass for work it had not done: a `--build`
  run with an unset SDK printed `skip <family>` and exited 0, so a misconfigured job looked green.
  A build run now names its family (`--family=clap|juce|lv2`) and fails when that family has no
  SDK, which is how each CI job passes exactly the one SDK it has.
- **`clang-tidy`** runs through the compile database with `.clang-tidy` enabling the analyzers plus
  `bugprone-*`/`performance-*`/`portability-*` and `WarningsAsErrors: '*'`. The style families
  (`readability-*`, `cppcoreguidelines-*`, `modernize-*`) are excluded: they rewrite working code to
  taste, and this review has no finding that they would have caught. The config is passed with
  `--config-file=` because the generated project lives in a temp directory, out of reach of
  clang-tidy's upward search — the first CI run showed exactly that (warnings reported, none
  promoted). Three checks are excluded, each with its reason beside the setting; the first run
  also found a real nit, `performance-trivially-destructible` on the CLAP template's out-of-line
  `~Processor() = default;`, which is now defaulted on its first declaration.
- **`cmake-lint`** runs with `.cmake-format.py` declaring the templates' actual style (4-space
  indents, 100 columns) rather than disabling the two codes that complained, so `C0301` and `C0307`
  still fire on a genuine violation. That is how the two 121-column `OUTPUT_DIRECTORY` lines were
  found and replaced with `LV2_ARTEFACTS_DIR`/`LV2_BUNDLE_DIR`.
- **`actionlint` + `shellcheck`** run in a new `lint-config` job, which `publish` now needs. The
  action is pinned to a commit SHA like every other action in the repo, and `tests/release.test.js`
  asserts each gate is actually invoked (a config file is not a gate).

Deliberately not done: **`sord_validate`** (it needs the LV2 schema files staged on disk; `lv2lint`
already validates each description through lilv against lv2core) and the `clang-tidy` style
families (above).

The gates also caught two of their own integration mistakes, which is the point of running
them: `lv2lint` takes a plugin URI plus a *bundle* directory (`-I` goes straight to
`lilv_world_load_bundle()`) and is packaged by no distribution, so CI builds it from the
upstream mirror; `clang-tidy` needs `--config-file=` for a project outside this checkout.

Verified after the gates were wired: `npm run check` exit 0 — `npm run lint`, `npm run typecheck`,
**248 tests / 240 pass / 0 fail / 8 environment skips**, `npm run smoke` 10/10,
`npm audit` 0 vulnerabilities, the license gate (179 packages), and `npm run docs:check`.
`npm run cmake:lint` exits 0 on the five templates and non-zero on a file with an unterminated
`add_library(`.

Two things here were only findable by running the real thing: the `.cmd`/`timeout` defects in
`ship.mjs` (no test executed the Windows path) and S-22, which the JUCE stub cannot see because
it is a CMake-level derivation rather than an API. The first real-JUCE CI run on this branch
failed both JUCE jobs on it; that is the mechanism the review's §5 asked for, applied to itself.

Verified after the fixes: `npm run lint` clean, `npm test` green, strict
`gcc -std=c11 -Wall -Wextra -Wpedantic -Wshadow -Wcast-qual -Wcast-align -Wswitch-enum -Wstrict-prototypes -Wmissing-prototypes -Wconversion -Werror`
on the generated `plugin.c` and `g++ -std=c++20` with the same set on the generated CLAP sources: both exit 0.
