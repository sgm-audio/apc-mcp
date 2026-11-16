# Development & contributing

This is the contributing guide. For user-facing setup see [Getting started](getting-started.md).

## Setup

```sh
git clone https://github.com/sgm-audio/apc-mcp.git
cd apc-mcp
npm ci
```

Requires Node.js 22+. The server itself is `index.js` (ESM, single file) with two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`). Tests use Node's built-in `node:test` runner — no test framework.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Full suite (`node --test`, auto-discovers `tests/`). Some C/C++ compile checks skip unless `APC_CLAP_INCLUDE` / `APC_LV2_INCLUDE` point at real upstream headers |
| `npm run lint` | ESLint over the repo + `node --check index.js` |
| `npm run typecheck` | `tsc -p tsconfig.json`: `checkJs` over `index.js`, `scripts/` and the test helpers. No emit |
| `npm run smoke` | Scaffolds every `type` × `ui` case into a temp project and verifies structure |
| `npm run smoke:configure` | Same, plus real CMake configure (needs CMake and SDK paths) |
| `npm run smoke -- --build` | Plus compile/link and artefact checks. Add `--install` (honour `cmake --install --prefix`), `--lv2lint` (validate the built bundle) or `--clang-tidy` (static analysis) — each fails when its tool is missing rather than skipping. A build run also fails when a family has no SDK, so pass `--family=clap`, `--family=juce` or `--family=lv2` when the machine has only some of them (CI passes exactly one per job) |
| `npm run cmake:lint` | `cmake-lint` over `templates/*/CMakeLists.txt`, configured by `.cmake-format.py` (needs `pip install cmakelang`) |
| `npm run smoke:validate -- --type=clap` | Scaffolds, builds and validates one plugin with the **real** `clap-validator` (needs `APC_CLAP_DIR` + the binary on `PATH`). `--type=juce` does the same with `pluginval` and `APC_JUCE_DIR`. Fails when a dependency is missing — it never skips |
| `npm run audit` | `npm audit` |
| `npm run licenses` | Lockfile license gate against `license_decisions.yml` |
| `npm run docs:check` | Every relative doc link, cross-file anchor, and the [docs index](README.md) coverage |
| `npm run check` | Full gate: lint + typecheck + test + smoke + audit + licenses + docs check |
| `npm run ship` | Guarded release (see below) |

Run `npm run check` before committing; `scripts/ship.mjs` runs the same chain before tagging.

CI runs that same chain on Linux (Node 22 and 24) and macOS, plus jobs that need a real toolchain:

| Job | What it proves |
|---|---|
| `compile-scaffold` | Generated C11/C++ syntax-checks against the checked-in JUCE stub |
| `scaffold-clap`, `scaffold-lv2`, `scaffold-juce` | Generated projects configure, compile and link against real upstream SDKs, with `-Werror` inherited from the templates. The CLAP and LV2 jobs also run `clang-tidy`; the LV2 job additionally runs `cmake --install --prefix` and `lv2lint` on the built bundle |
| `lint-config` | `actionlint` (workflow schema, expressions, `shellcheck` over every `run:` block) and `cmake-lint` over the templates |
| `scaffold-clap-validate` | `audio_plugin_validate` runs a real `clap-validator` on a built CLAP plugin and reports PASS (build and validate are separate steps, so a red job says which half broke) |
| `scaffold-juce-validate` | Same with a real `pluginval` on a built VST3 (`xvfb-run`: pluginval is a GUI app) |

The last two exist because every other `audio_plugin_validate` test installs a PATH shim: shims prove the argv shape and the reporting logic, but not that upstream's binary accepts the invocation, or that a scaffolded plugin passes it. Both jobs fail if the report skips validation instead of running it — an unrun validator must never look like a pass. Neither is part of `npm run check`, since both need a multi-GB SDK download.

To run the C/C++ compile checks locally:

```sh
export APC_CLAP_INCLUDE=/path/to/clap/include APC_LV2_INCLUDE=/path/to/lv2/include
npm test
```

To exercise real CMake configure/build for every template:

```sh
export APC_JUCE_DIR=/path/to/JUCE APC_CLAP_DIR=/path/to/clap APC_LV2_DIR=/path/to/lv2/include
node scripts/smoke-scaffold.mjs --build
```

## Repository layout

```text
apc-mcp/
├── index.js                 # MCP server — seven tools, stdio transport
├── templates/               # clap/, juce/, juce-webview/, lv2/, standalone/
├── tests/                   # node:test suites + MCP stdio client + JUCE API fixture
│   ├── helpers/mcp-client.mjs
│   ├── fixtures/juce-api-stub/
│   ├── server.test.js         # happy path, CLI flags, root CMake wiring
│   ├── security.test.js       # negative / traversal / symlink rejection
│   ├── tool-output.test.js    # config precedence, parsers, failure reporting
│   ├── templates.test.js      # generated project structure
│   ├── artefacts.test.js      # build-artefact discovery
│   ├── cpp-api.test.js        # real compiler checks against upstream headers
│   └── release.test.js        # versioning, CI pins, SPDX, docs links, release guards
├── scripts/                 # smoke-scaffold.mjs, smoke-validate.mjs, check-licenses.mjs, check-docs.mjs, ship.mjs
├── docs/                    # this documentation set
│   └── archive/             # frozen historical audit / handoff snapshots
├── .github/workflows/       # publish.yml (CI + npm publish on v* tags), codeql.yml
├── eslint.config.js
├── license_decisions.yml    # license allowlist
├── CHANGELOG.md             # release history (read by scripts/ship.mjs — keep at root)
├── SECURITY.md              # short pointer to docs/security.md (GitHub convention)
├── CONTRIBUTING.md          # short pointer to this file (GitHub convention)
└── README.md                # concise entry point
```

## Adding a tool

1. Register it with `registerTool(name, schema, handler)` in `index.js`. Do **not** call `server.tool()` directly — the wrapper converts a thrown `Error` into a readable `isError: true` result instead of an opaque JSON-RPC error with empty text.
2. Add a zod schema for every parameter. Any user-controlled string needs a regex constraint (`SAFE_TARGET`, `SAFE_PATH`, …); see [Security](security.md#defence-layers).
3. **Write the failing test first and watch it fail** against the pre-change code in a throwaway worktree (`git worktree add /tmp/red HEAD && cp tests/<new>.test.js /tmp/red/tests/`). A control with no red phase is not a control.
4. Put the test in the file matching its kind (see the layout above).
5. Update [tools.md](tools.md) and, if the config surface changed, [configuration.md](configuration.md). Do not grow the README.

## Code style

- **Never build a shell string.** Use `spawnSync()` / `trySpawn()` with an argument array. ESLint bans importing `exec` / `execSync`.
- Use `trySpawn()` for commands that might fail — it inspects `result.error` and `result.signal` so a missing binary or a timeout produces an actionable message rather than `exit code null`.
- **A tool that did not succeed must return `isError: true`**, including when a command exited 0 but its output shows errors, and when a step was skipped.
- Every path joined onto the project root must pass through `assertWithinProject()`; it also resolves symlinks.
- Config schema lives in `CONFIG_SCHEMA` in `index.js`, validated per key so one bad value degrades to its default.
- Structured output uses `### Headers` for sections followed by raw text.
- Template files live in `templates/<type>/`. If you touch them, run `npm run smoke` and the C/C++ compile checks. **Verify every CMake keyword and C++ API against real upstream source**, not memory — see [Roadmap](roadmap.md#standing-constraint) and [Project status](project-status.md#maintainer-traps).
- `index.js` is deliberately a single file. If you add a substantial subsystem, propose splitting it rather than growing it further.
- `.editorconfig` is in place: LF, final newline, no tabs/trailing whitespace.

## Release process

`npm run ship` refuses to release unless every precondition holds. It runs `npm run check`, then verifies HEAD is on `main`, the working tree is clean, the version tag does not exist locally or on origin, and `CHANGELOG.md` has a `## [<version>]` heading — then tags `v<version>` and pushes. CI publishes to npm on `v*` tags.

Human steps:

1. Bump `version` in `package.json`. That is the **only** copy — `index.js` reads it at startup, so `initialize` cannot report a stale version.
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [<version>] — <date>` and finish the entry. Note breaking tool-schema/output changes require a major bump ([Semantic Versioning](https://semver.org)).
3. `npm run ship`. Preview with `node scripts/ship.mjs --dry-run`; each guard prints why it stopped.

## License

MIT — see [LICENSE](../LICENSE).
