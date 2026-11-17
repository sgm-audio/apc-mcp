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
| **1. Input schemas & template escaping** | Invalid characters in `target`, `generator`, `options`, `testName`, `name`, `vendor`, `description`, `formats`, `projectPath`; C++/CMake/Turtle string breakout | Per-parameter regexes (`SAFE_TARGET`, `SAFE_PLUGIN_NAME`, `SAFE_GENERATOR`, `SAFE_OPTIONS`, `SAFE_PATH`, …) plus `RESERVED_CMAKE_TARGETS`. `description` and `vendor` are escaped per output grammar in a single-pass `replaceTemplateVars()` substitution (`{{PLUGIN_DESCRIPTION_CXX}}`, `{{VENDOR_CMAKE}}`, `{{VENDOR_TTL}}`, `{{VENDOR_HTML}}`, …): CMake needs three backslashes per quote, a C++ or Turtle literal one, and HTML needs `&`/`<`/`>` escaped instead. Both accept any single line of non-control text, so non-ASCII vendor names work; the only universal rejection is control characters, which no escaping can make safe in all four grammars. |
| **2. No shell** | All shell injection | `spawn()` → `spawnSync()` with an **argument array**; user values become separate argv entries, so `;`, backticks and `$()` are literal. `eslint.config.js` fails lint if `exec` / `execSync` is ever imported. |
| **3. Project containment** | Path and symlink traversal | `assertWithinProject()` resolves absolute paths and checks the nearest existing ancestor with `fs.realpathSync()` against the real root; `hasDotDot()` rejects `..` segments — in a path *and* inside a `-D` value. Used by lint, create (including the root `CMakeLists.txt` guard), plugins, build, configure, test, validate **and artefact discovery** (a format directory symlinked out of the build tree is refused, never handed to a validator). |
| **3b. Config validation** | A hostile `apc-mcp.json` | `loadProjectConfig()` validates each key independently against `CONFIG_SCHEMA` (own-property lookup only, so a `constructor` key is an unknown key, not a prototype-chain collision); one bad value degrades to its default. `buildDir` / `pluginsDir` must be relative and free of `..`; unknown keys are ignored. A config file that is itself a symlink resolving **outside** the project root is ignored with a warning; one that stays inside is honoured. |
| **4. Command whitelist** *(one documented exception)* | Arbitrary binary execution | `trySpawn()` is called with hardcoded names (`cmake`, `ctest`, `clang-format`). **Exception:** `audio_plugin_validate` takes its validator from `validateCommand` / `clapValidatorCommand`, constrained to `SAFE_TARGET` (no path separator, no whitespace) so it names a binary resolved through `PATH`. See [residual risk](#residual-risk). |
| **5. Output caps & timeouts** | Memory exhaustion / hangs | 16 MB `maxBuffer`, a 180 s default timeout tuned per command (60–120 s lint/configure/validate, 300 s ctest, 600 s cold JUCE builds). A timeout is reported as a timeout, not `exit code null`; a lint run that fails *without* per-file diagnostics is reported as a failed run with its cause, not as "0 files with problems". |
| **6. Binary discovery without a subprocess** | Injection via `which` | `binaryOnPath()` scans `PATH` with `fs.accessSync`; a missing tool is actually reported as missing (`requireTool()`, `installHint()`). |
| **7. Honest failure reporting** | Acting on a false premise | `registerTool()` and the handlers set `isError: true` when a command failed, emitted compiler errors, had failing tests, found no tests at all, or a configured validator was missing. Checks that cannot be performed at all (LV2/AU/Standalone validation) are reported as `NOT CHECKABLE` rather than passed or failed. A model told "No formatting issues" after a failed rewrite will keep going. |
| **8. Supply-chain gate** | Policy drift | `scripts/check-licenses.mjs` parses full SPDX expressions (`WITH` > `AND` > `OR` + parentheses) for every lockfile package against `license_decisions.yml`; a distributed dependency outside it fails CI. |

## Residual risk

The honest boundary, stated in two halves:

**apc-mcp's own file operations are contained.** Reads and writes performed by `index.js` itself stay inside the project root: tool `target`/`projectPath` arguments, `buildDir`/`pluginsDir` from config, the config file read (symlinks resolving outside are ignored), and artefact discovery (symlinks resolving outside are refused). Prompt injection can still cause nuisance or denial of service — building a non-existent target fails harmlessly, an invalid project path is rejected before anything is created, and an obnoxious (but charset-valid) plugin name only writes inside the project root, equivalent to the user typing it.

**The subprocesses apc-mcp launches are not containable, by design.** `cmake`, the compiler it drives, `ctest`, `clang-format -i` and the validators all run with your user privileges and all act on the project you pointed the server at. Concretely:

- **Configure options execute project-controlled code.** The `options` grammar admits only `-D<VAR>[:<TYPE>]=<VALUE>`, `-U<GLOB>` and `-Wdev`/`-Wdeprecated` flags — no `--script`, no `-P`, no `--trace-redirect`, and no `..` segments in a flag *or* a `-D` value. But a `-D` value may legitimately be an absolute path (SDK locations such as `-DJUCE_DIR=/opt/JUCE`), and some cache variables are read by CMake as files to include or execute — `CMAKE_PROJECT_INCLUDE` being the canonical example. A crafted `options` string can therefore direct CMake at a file outside the project root, and `Configure succeeded` will follow. This is inherent in delegating configuration to CMake: the project's own `CMakeLists.txt` is already arbitrary code, and `options` cannot be more contained than the thing it configures. **Only point apc-mcp at projects whose build system you would run yourself.**
- **Anyone who can write `apc-mcp.json` can choose which `PATH`-resolved binary `audio_plugin_validate` executes** with a plugin path as its argument (`validateCommand` / `clapValidatorCommand`). `SAFE_TARGET` forbids path separators and whitespace, so they cannot point at an arbitrary path or inject arguments — but naming a malicious binary already on `PATH` is within reach. Anyone who can write to your project directory can already write to your source files, so the trust boundary is not extended; layer 4 is simply not absolute.
- **Validators load their argument as a plugin** — that is their job. Artefact paths are containment-checked before they are handed over, but the binary executed is still a `PATH`-resolved program you installed, doing what validators do.

**What remains true:** there is no shell anywhere in the server (`spawn()` with argument arrays only), and apc-mcp's *own* reads and writes do not cross the project root. What is **not** true, and was wrongly claimed here before: that no code path can read or write outside the project root. The subprocess boundary is the real boundary, and it is your judgement, not a regex, that enforces it.

## Audit history

| Version | Security-relevant changes |
|---|---|
| 2.0.0 (current, unreleased) | Closed SEC-01 (lint traversal + symlink-aware containment), SEC-03 (per-key config validation), SEC-02 (dependency advisories); C++/CMake/Turtle escaping; fixed prerequisite detection and timeout reporting; removed `type="ara"` (unbuildable scaffold); honest `isError` reporting; license gate and pinned GitHub Actions CI; `options` grammar + `..`-in-value rejection; artefact-discovery and config-read symlink containment; prototype-key-safe config lookup; residual-risk statement rewritten to match the subprocess boundary (see [SUBSTANTIATION-LOG.md](../SUBSTANTIATION-LOG.md)) |
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

Automated scanning: Dependabot, CodeQL on push/PR, `npm audit --audit-level=high`, scaffold smoke tests, real CMake compile+link jobs for CLAP/LV2/JUCE, ESLint, the license gate and the docs link check in GitHub Actions.

## Reporting a vulnerability

Open an issue at https://github.com/sgm-audio/apc-mcp/issues with the `security` label. For sensitive disclosures — anything that would let an attacker write outside a project root or execute a command — use GitHub's private vulnerability reporting on the repository, or contact the owner directly, rather than a public issue.
