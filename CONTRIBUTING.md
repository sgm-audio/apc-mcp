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

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "release: v1.0.1"`
4. Tag: `git tag v1.0.1 && git push origin v1.0.1`
5. CI publishes to npm automatically

## License

MIT — go build stuff.
