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

1. Define the tool with `server.tool()` in `index.js`
2. Add a Zod schema for params
3. Add tests in `tests/server.test.js`
4. Update README.md tool table

## Code style

- Single file (`index.js`) — keep it there unless it genuinely outgrows ~800 lines
- `node --check index.js` before committing (runs in CI on push)
- Template files go in `templates/<type>/`
- Config schema lives in `apc-mcp.json` at the project root
- Use `tryRun()` for commands that might fail, `run()` when failure is fatal
- Structured output uses `### Headers` for sections followed by raw text
- .editorconfig is in place — your editor should respect it automatically

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
