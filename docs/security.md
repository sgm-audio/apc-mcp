# Security

## Threat model

apc-mcp runs local system commands (`cmake`, `ctest`, `clang-format`, `pluginval`, `clap-validator`) on projects you point it at. It communicates with the MCP client over **stdio only** — no network listener, no telemetry, no external service calls.

The primary threat is **prompt injection**: an attacker hides instructions in content (a README, a source file, an email) that reaches the LLM, which then emits tool calls with attacker-controlled arguments.

A second, easily missed one: **`apc-mcp.json` is untrusted input too.** Its values reach `path.join()` and `spawnSync()` argv just like tool arguments, and anyone who can write to the project directory can write it. It is validated per key — see [defence layers](#defence-layers).

## ⚠️ Upgrade notice — path traversal fixed in 2.0.0

**Versions 1.4.0 and 1.5.0 are vulnerable.** `audio_plugin_lint`'s `target` parameter was checked only against a character allowlist that permits `.`, so `../victim` passed, was joined onto the project root, and was handed to `clang-format -i` with `fix: true`. One tool argument could **modify in place** any C/C++ file the user could write, including outside the project.

Fixed in 2.0.0 by `assertWithinProject()`. Until `v2.0.0` is tagged and published to npm, install the fixed code from GitHub:

```sh
npx -y github:sgm-audio/apc-mcp --version   # expect 2.0.0
```

Configure your MCP client with that command (see [Getting started](getting-started.md#1-add-apc-mcp-to-your-mcp-client)); `npx` may need its `_npx` cache cleared to pick up a new revision. There is no published `@sgm-audio/apc-mcp` package to `npm install` yet, and npm/git tags `1.4.x` / `1.5.x` predate the fix.

If you ran 1.4.0 / 1.5.0 against untrusted content, review recent changes to C++ files outside the projects you pointed it at.

## Defence layers

Linked by symbol name rather than line number — those move with every edit. All live in `index.js` unless noted.

| Layer | What it blocks | How |
|---|---|---|
| **1. Input schemas & template escaping** | Invalid characters in `target`, `generator`, `options`, `testName`, `name`, `vendor`, `description`, `formats`, `projectPath`; C++/CMake/Turtle string breakout | Per-parameter regexes (`SAFE_TARGET`, `SAFE_PLUGIN_NAME`, `SAFE_GENERATOR`, `SAFE_OPTIONS`, `SAFE_PATH`, …) plus `RESERVED_CMAKE_TARGETS`. `description` and `vendor` are escaped per output grammar in a single-pass `replaceTemplateVars()` substitution (`{{PLUGIN_DESCRIPTION_CXX}}`, `{{VENDOR_CMAKE}}`, `{{VENDOR_TTL}}`, `{{VENDOR_HTML}}`, …): CMake needs three backslashes per quote, a C++ or Turtle literal one, and HTML escapes `&`/`<`/`>` plus quotes. `description` and `vendor` also escape `#` and `;` as octal C escapes (`\043`, `\073`): JUCE turns them into a compile definition, and a raw `#` starts a comment in the generated Makefile line while `;` is a CMake list separator — either one made a legally-named plugin fail to compile. Both fields accept any single line of non-control text, up to their schema caps (128 characters for `vendor`, 512 for `description`), so non-ASCII vendor names work; control characters are the only content rejected outright, as no escaping can make them safe in all four grammars. |
| **2. No shell** | All shell injection | `spawn()` → `spawnSync()` with an **argument array**; user values become separate argv entries, so `;`, backticks and `$()` are literal. `eslint.config.js` fails lint if `exec` / `execSync` is ever imported. |
| **3. Project containment** | Path and symlink traversal | Two stages. *Check time:* `assertWithinProject()` resolves absolute paths and checks the nearest existing ancestor with `fs.realpathSync()` against the real root; `hasDotDot()` rejects `..` segments — in a path *and* inside a `-D` value. *Write time:* `mkdirInside()` / `assertRealDir()` / `writeFileInside()` re-resolve the real path of every directory immediately before use, refuse to create or write through a symlinked directory at any level, create directories one level at a time, and open files with `O_NOFOLLOW` (plus `O_EXCL` for new ones). The second stage exists because the first is a check, not a lock: a process that swaps `plugins/` for a symlink between the check and the write used to redirect the scaffold outside the root. Used by lint, create (including the root `CMakeLists.txt`), plugins, build, configure, test, validate **and artefact discovery** (a format directory symlinked out of the build tree is refused — see layer 4). |
| **3b. Config validation** | A hostile `apc-mcp.json` | `loadProjectConfig()` validates each key independently against `CONFIG_SCHEMA`, looking keys up as **own properties only** — a `constructor` key is an unknown key, not a prototype-chain collision that crashed every tool call; one bad value degrades to its default. `buildDir` / `pluginsDir` must be relative, free of `..`, and restricted to a charset that is safe in CMake *source* — no `\` (a CMake escape character) and no `:` — because a value like `pl\ugins` scaffolded a project that failed to configure. Unknown keys are ignored. A config file that is itself a symlink resolving **outside** the project root is ignored with a warning; one that stays inside is honoured. |
| **4. Command whitelist** | Arbitrary binary execution *by the server itself* | `trySpawn()` is called with hardcoded names (`cmake`, `ctest`, `clang-format`). This layer governs which binary the server spawns — **not** whether code runs: configuring and building a project executes that project's own `CMakeLists.txt`, so build tools are code by definition. What the server does refuse is letting a tool *argument* pick the code: `-D` variables whose value CMake parses, loads or executes (`CMAKE_PROJECT_TOP_LEVEL_INCLUDES`, `CMAKE_PROJECT_INCLUDE*`, toolchain/module paths, compilers, launchers, `*_FLAGS`, linkers, `CMAKE_MAKE_PROGRAM`, …) are rejected by `cmakeOptionSetsCode()`, and a `CMakeCache.txt` that belongs to another source tree, or that carries a cache-visible code mark (`CMAKE_PROJECT_*`, toolchain file, module path, user make rules override, compiler launcher), is deleted before configure (`sanitizeCmakeCache()`) — a committed cache used to execute code on a plain `configure`. A cache can still name a different compiler; that is project state, and the rest of the project is code too (see [residual risk](#residual-risk)). **Exception:** `audio_plugin_validate` takes its validator from `validateCommand` / `clapValidatorCommand`, constrained to `SAFE_TARGET` (no path separator, no whitespace), and loads artefacts from the build tree — so a build directory is code too. Artefacts that are symlinks or resolve outside the project are never loaded: they are reported as **refused** and the run fails. See [residual risk](#residual-risk). |
| **5. Output caps & timeouts** | Memory exhaustion / hangs | 16 MB `maxBuffer` per command (`MAX_OUTPUT_BYTES`), at most 20 diagnostics per kind, 500 characters per diagnostic line, 4 000 characters of `cmake` error text, and a 180 s default timeout tuned per command (60–120 s lint/configure/validate, 300 s ctest, 600 s cold JUCE builds). A timeout is reported as a timeout, not `exit code null`, and `killProcessTree()` kills the whole process group — `cmake --build --parallel` leaves make/ninja workers behind if only the direct child is signalled. |
| **6. Binary discovery without a subprocess** | Injection via `which` | `binaryOnPath()` scans `PATH` with `fs.accessSync`; a missing tool is actually reported as missing (`requireTool()`, `installHint()`). |
| **7. Honest failure reporting** | Acting on a false premise | `registerTool()` and the handlers set `isError: true` when a command failed, emitted compiler errors, had failing tests, found no tests at all, **linted zero files when a target was named**, or a configured validator was missing. Checks that cannot be performed at all (LV2/AU/Standalone validation) are reported as `NOT CHECKABLE` rather than passed or failed. A model told "No formatting issues" after a failed rewrite will keep going. |
| **8. Supply-chain gate** | Policy drift | `scripts/check-licenses.mjs` parses full SPDX expressions (`WITH` > `AND` > `OR` + parentheses) for every lockfile package against `license_decisions.yml`; a distributed dependency outside it fails CI. |

## Residual risk

The honest boundary, stated in two halves:

**apc-mcp's own file operations are contained.** Reads and writes performed by `index.js` itself stay inside the project root: tool `target`/`projectPath` arguments, `buildDir`/`pluginsDir` from config, the config file read (a symlink resolving outside the project root is ignored with a warning), and artefact discovery (an artefact that is a symlink or resolves outside the project is never handed to a validator, is reported as refused, and fails the run). Prompt injection can still cause nuisance or denial of service — building a non-existent target fails harmlessly, an invalid project path is rejected before anything is created, and an obnoxious (but charset-valid) plugin name only writes inside the project root, equivalent to the user typing it.

**Configuring or building a project runs that project's code.** `CMakeLists.txt`, `CMakeCache.txt` and the compiler/toolchain a cache names are all part of the project. The server refuses to let a *tool argument* choose code (layer 4 — the `options` grammar admits only `-D`/`-U`/`-Wdev` flags with no `..` segments in a flag or a `-D` value, and known code-loading variables are rejected outright) and discards untrusted caches — but that rejection is a **blocklist of known code-loading variables**, not a proof: a `-D` value may legitimately be an absolute path (SDK locations such as `-DJUCE_DIR=/opt/JUCE`), so a variable CMake learns to treat as code in a future release would pass until blocklisted. A project you do not trust is still a program you are choosing to run. Review a project before you build it, and only point apc-mcp at projects whose build system you would run yourself.

**`audio_plugin_validate` executes the artefact it validates.** `validateCommand` / `clapValidatorCommand` name a `PATH`-resolved binary (`SAFE_TARGET` forbids separators and whitespace), and the validator loads the plugin it is pointed at. Symlinked artefacts and artefacts that resolve outside the project are refused and fail the run. Anyone who can write the build directory can write code the validator will load — within the project, which is the same trust as the sources themselves.

**A concurrent local writer can still race the write-time checks.** Node exposes no `openat(2)`, so the final containment check and the `mkdir`/`open` are two syscalls. The window is sub-millisecond and a race can no longer write file *content* outside the project (the file opens with `O_NOFOLLOW`, and directory levels are verified immediately before use), but it can in principle create an empty directory outside, which the server then removes. Closing the window entirely needs a native `openat` helper.

There is **no residual risk of shell command injection**, and no path from tool arguments, `apc-mcp.json`, template metadata or plugin metadata to a shell. What is **not** claimed — and was wrongly claimed here before the substantiation audit — is that no code path can read or write outside the project root: the subprocess boundary (`cmake`, compilers, `ctest`, `clang-format -i`, validators — all running with your privileges) is the real boundary, and it is your judgement, not a regex, that enforces it.

## Audit history

| Version | Security-relevant changes |
|---|---|
| 2.0.0 (current, unreleased) | Closed SEC-01 (lint traversal + symlink-aware containment), SEC-03 (per-key config validation), SEC-02 (dependency advisories); C++/CMake/Turtle escaping; fixed prerequisite detection and timeout reporting; replaced the unbuildable intermediate `type="ara"` scaffold with a dedicated ARA effect template and missing-SDK guard; honest `isError` reporting; license gate and pinned GitHub Actions CI. Second review (`SECURITY-REVIEW-2.0.0.md`): SEC-NEW-04 (bounded, whitelisted `status.json`), SEC-NEW-05 (write-time containment, no writes through symlinks, artefact symlinks skipped), SEC-NEW-06 (`-D` code-loading variables rejected, untrusted CMake caches discarded), SEC-NEW-07 (output caps documented), SEC-NEW-08 (lint reports zero files as an error), SEC-NEW-09 (`#`/`;` escaped in generated command lines), SEC-NEW-10 (CMake-unsafe `buildDir`/`pluginsDir` rejected). Substantiation audit ([SUBSTANTIATION-LOG.md](../SUBSTANTIATION-LOG.md)): residual-risk statement rewritten to state the subprocess boundary honestly; artefact refusal now fails the run; `apc-mcp.json` symlink containment; prototype-key-safe config lookup; single-`../` rejection in `-D` values; skip-aware ctest counting; space-tolerant compiler diagnostics |
| 1.5.0 / 1.4.0 | **Vulnerable to SEC-01** — see the upgrade notice above |
| 1.2.0 | CodeQL workflow, Dependabot, `node --check` lint step |

The original findings and evidence are preserved in [archive/AUDIT.md](archive/AUDIT.md). Current state is summarised in [Project status](project-status.md).

## Dependency audit & supply chain

Two direct runtime dependencies:

| Package | Risk |
|---|---|
| `@modelcontextprotocol/sdk` (official MCP SDK) | Low. Pulls an HTTP transport stack, but this server is stdio-only and never starts a listener, so those paths are unreachable here — still a reason to keep the lockfile current. |
| `zod` | Low. Mature schema validator, used for every tool input. |

`package.json` `files` is `["index.js", "templates/"]`, so tests, fixtures, scripts and docs do not ship in the tarball. `engines.node` is `>=22`. Verify the current posture rather than trusting a number in a document:

```sh
npm audit
npm run licenses
npm run check
```

Automated scanning: Dependabot, CodeQL on push/PR, plain `npm audit` (CI runs `npm run audit` — deliberately no `--audit-level`, so CI matches the documented local baseline), scaffold smoke tests, real CMake compile+link jobs for CLAP/LV2/JUCE, ESLint, the license gate and the docs link check in GitHub Actions.

## Reporting a vulnerability

Open an issue at https://github.com/sgm-audio/apc-mcp/issues with the `security` label. For sensitive disclosures — anything that would let an attacker write outside a project root or execute a command — use GitHub's private vulnerability reporting on the repository, or contact the owner directly, rather than a public issue.
