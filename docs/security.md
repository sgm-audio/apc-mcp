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
| **1. Input schemas & template escaping** | Invalid characters in `target`, `generator`, `options`, `testName`, `name`, `vendor`, `description`, `formats`, `projectPath`; C++/CMake/Turtle string breakout | Per-parameter regexes (`SAFE_TARGET`, `SAFE_PLUGIN_NAME`, `SAFE_GENERATOR`, `SAFE_OPTIONS`, `SAFE_PATH`, …) plus `RESERVED_CMAKE_TARGETS`. `description` is escaped per output grammar in a single-pass `replaceTemplateVars()` substitution. |
| **2. No shell** | All shell injection | `spawn()` → `spawnSync()` with an **argument array**; user values become separate argv entries, so `;`, backticks and `$()` are literal. `eslint.config.js` fails lint if `exec` / `execSync` is ever imported. |
| **3. Project containment** | Path and symlink traversal | `assertWithinProject()` resolves absolute paths and checks the nearest existing ancestor with `fs.realpathSync()` against the real root; `hasDotDot()` rejects `..` segments. Used by lint, create (including the root `CMakeLists.txt` guard), plugins, build, configure, test and validate. |
| **3b. Config validation** | A hostile `apc-mcp.json` | `loadProjectConfig()` validates each key independently against `CONFIG_SCHEMA`; one bad value degrades to its default. `buildDir` / `pluginsDir` must be relative and free of `..`; unknown keys are ignored. |
| **4. Command whitelist** *(one documented exception)* | Arbitrary binary execution | `trySpawn()` is called with hardcoded names (`cmake`, `ctest`, `clang-format`). **Exception:** `audio_plugin_validate` takes its validator from `validateCommand` / `clapValidatorCommand`, constrained to `SAFE_TARGET` (no path separator, no whitespace) so it names a binary resolved through `PATH`. See [residual risk](#residual-risk). |
| **5. Output caps & timeouts** | Memory exhaustion / hangs | 2 MB `maxBuffer`, a 180 s default timeout tuned per command (60–120 s lint/configure/validate, 300 s ctest, 600 s cold JUCE builds). A timeout is reported as a timeout, not `exit code null`. |
| **6. Binary discovery without a subprocess** | Injection via `which` | `binaryOnPath()` scans `PATH` with `fs.accessSync`; a missing tool is actually reported as missing (`requireTool()`, `installHint()`). |
| **7. Honest failure reporting** | Acting on a false premise | `registerTool()` and the handlers set `isError: true` when a command failed, emitted compiler errors, had failing tests, or validation was incomplete. A model told "No formatting issues" after a failed rewrite will keep going. |
| **8. Supply-chain gate** | Policy drift | `scripts/check-licenses.mjs` parses full SPDX expressions (`WITH` > `AND` > `OR` + parentheses) for every lockfile package against `license_decisions.yml`; a distributed dependency outside it fails CI. |

## Residual risk

Prompt injection can still cause nuisance or denial of service: building a non-existent target fails harmlessly, an invalid project path is rejected before anything is created, and an obnoxious (but charset-valid) plugin name only writes inside the project root — equivalent to the user typing it.

**If an attacker can write `apc-mcp.json`, they can choose which `PATH`-resolved binary `audio_plugin_validate` executes** with a plugin path as its argument (`validateCommand` / `clapValidatorCommand`). `SAFE_TARGET` forbids path separators and whitespace, so they cannot point at an arbitrary path or inject arguments — but naming a malicious binary already on `PATH` is within reach. Anyone who can write to your project directory can already write to your source files, so the trust boundary is not extended; layer 4 is simply not absolute.

There is **no residual risk of shell command injection, nor of arbitrary file read/write outside the project root**.

## Audit history

| Version | Security-relevant changes |
|---|---|
| 2.0.0 (current, unreleased) | Closed SEC-01 (lint traversal + symlink-aware containment), SEC-03 (per-key config validation), SEC-02 (dependency advisories); C++/CMake/Turtle escaping; fixed prerequisite detection and timeout reporting; removed `type="ara"` (unbuildable scaffold); honest `isError` reporting; license gate and pinned GitHub Actions CI |
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
