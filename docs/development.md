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
| `npm run smoke` | Scaffolds every `type` × `ui` case into a temp project and verifies structure |
| `npm run smoke:configure` | Same, plus real CMake configure (needs CMake and SDK paths) |
| `npm run audit` | `npm audit` |
| `npm run licenses` | Lockfile license gate against `license_decisions.yml` |
| `npm run docs:check` | Every relative doc link, cross-file anchor, and the [docs index](README.md) coverage |
| `npm run check` | Full gate: lint + test + smoke + audit + licenses + docs check |
| `npm run ship` | Guarded release (see below) |

Run `npm run check` before committing; `scripts/ship.mjs` runs the same chain before tagging. CI runs lint, tests, smoke, audit, license checks, documentation links, real C/C++ compile checks and CMake build jobs for CLAP, LV2 and JUCE against upstream SDKs.

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
├── scripts/                 # smoke-scaffold.mjs, check-licenses.mjs, check-docs.mjs, ship.mjs
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
