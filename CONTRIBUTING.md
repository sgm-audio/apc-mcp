# Contributing

## Prerequisites

- Node.js 18+
- Familiarity with MCP (Model Context Protocol)

## Setup

```sh
git clone https://github.com/sgm-audio/apc-mcp.git
cd apc-mcp
npm install
```

## Running tests

```sh
npm test
```

Tests use Node's built-in `node:test` runner — no test framework dependency.

## Adding a tool

1. Register it with `registerTool(name, schema, handler)` in `index.js`. Do **not**
   call `server.tool()` directly — the wrapper is what turns a thrown `Error` into
   a readable `isError: true` tool result instead of an opaque JSON-RPC protocol
   error that reaches the model with empty text.
2. Add a zod schema for every parameter. Any user-controlled string needs a regex
   constraint (`SAFE_TARGET`, `SAFE_PATH`, …); see `SECURITY.md` layer 1.
3. Add tests. Pick the file by kind: `tests/server.test.js` (happy path),
   `tests/security.test.js` (rejections), `tests/tool-output.test.js` (reporting and
   parsing), `tests/templates.test.js` (generated project structure),
   `tests/artefacts.test.js` (finding build artefacts in a build tree),
   `tests/cpp-api.test.js` (compiling the generated C++),
   `tests/release.test.js` (packaging and CI invariants).
4. **Write the failing test first and watch it fail.** Run it against the pre-change
   code in a throwaway worktree (`HANDOFF.md` §4). The original suite passed 11/11
   while the scaffold templates could neither configure nor compile.
5. Update the README tool table.

## Code style

`npm run lint` is ESLint over the whole repo plus a parse check, and `npm run check`
runs lint, the tests, the scaffold smoke test, `npm audit` and the license gate.
Run `npm run check` before committing; CI runs the same thing.

- The server is a single file (`index.js`, ~900 lines). It has outgrown the old
  "~800 lines" guidance; if you add a substantial subsystem, propose splitting it
  rather than growing the file further.
- **Never build a shell string.** Use `spawnSync()` / `trySpawn()` with an argument
  array. ESLint bans importing `exec`/`execSync` for this reason.
- Use `trySpawn()` for commands that might fail — it inspects `result.error` and
  `result.signal`, so a missing binary or a timeout produces an actionable message
  rather than `exit code null`. Use the inner `spawn()` only for the raw call.
- **A tool that did not succeed must return `isError: true`**, including when the
  command exited 0 but its output shows errors, and when a step had to be skipped.
  Reporting success for a failed operation is worse than throwing.
- Template files go in `templates/<type>/`. If you touch them, run `npm run smoke`
  and — with a compiler available — `tests/cpp-api.test.js`; see `HANDOFF.md` §3 for
  how to point it at real JUCE and CLAP checkouts.
- Config schema for `apc-mcp.json` lives in `CONFIG_SCHEMA` in `index.js`, validated
  per key so one bad value degrades to its default.
- Structured output uses `### Headers` for sections followed by raw text.
- .editorconfig is in place — your editor should respect it automatically.

## Release process

`npm run ship` performs the release and **refuses** if any precondition is unmet.
It runs `npm run check` (syntax, tests, scaffold smoke, `npm audit`, license
gate), then verifies that HEAD is `main`, the working tree is clean, the version
tag does not already exist, and `CHANGELOG.md` has a `## [<version>]` heading —
then tags `v<version>` and pushes the branch and the tag. CI publishes to npm on
`v*` tags.

The human steps are therefore just:

1. Bump `version` in `package.json`. That is the **only** place the version
   lives — `index.js` reads it at startup, so `initialize` reports it
   automatically and the two cannot drift.
2. Rename the `## [Unreleased]` heading in `CHANGELOG.md` to
   `## [<version>] — <date>` and complete the entry.
3. `npm run ship`

Preview everything without changing anything:

```sh
node scripts/ship.mjs --dry-run
```

Each guard prints why it stopped. If you genuinely mean to tag a branch other
than `main`, pass `--branch=<name>` — but understand that the tag then points at
work which is not on `main`, which is exactly the mistake the guard exists to
prevent.

## License

MIT — go build stuff.
