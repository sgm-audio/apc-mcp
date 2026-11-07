# Documentation index

Everything you need to use or maintain apc-mcp. Start with the [README](../README.md) for the two-minute version; this folder holds the detail.

## For users

| Document | Read it for |
|---|---|
| [Getting started](getting-started.md) | MCP client setup, installing the toolchain, building your first plugin, where binaries land |
| [Tool reference](tools.md) | Every tool, its arguments, examples, scaffold types and failure reporting |
| [Configuration](configuration.md) | `apc-mcp.json`, defaults, project-root detection, expected layout |
| [Toolchain & SDKs](toolchain.md) | Prerequisites, how CMake finds JUCE / CLAP / LV2, platform notes, gotchas |
| [Troubleshooting](troubleshooting.md) | FAQ, missing-binary errors, validation skips, `npx` cache |

## For maintainers

| Document | Read it for |
|---|---|
| [Development](development.md) | Setup, test commands, adding a tool, code style, release process (contributing guide) |
| [Security](security.md) | Threat model, defence layers, residual risk, vulnerability reporting |
| [Project status](project-status.md) | Current state, verification baseline, known limitations, maintainer traps |
| [Roadmap](roadmap.md) | Shipped templates and the remaining ARA work |
| [Docs hygiene report](docs-hygiene.md) | Audit of the documentation set, findings, link check, confidence score |
| [Archive](archive/README.md) | Frozen historical audit and handoff records (not maintained) |

Also in the repository root: [CHANGELOG.md](../CHANGELOG.md) (release history), [SECURITY.md](../SECURITY.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) (short pointers kept there because GitHub looks for those filenames), and [LICENSE](../LICENSE).

## Documentation policy

1. **One home per fact.** Reference material lives here, not in the README. Duplicate a link, never a paragraph.
2. **No volatile numbers in prose.** Test counts, line numbers, dependency counts and "current" results go stale. Describe the command that produces them (`npm test`, `npm audit`, `npm run licenses`) instead. Verified numbers are recorded with a date in [the hygiene report](docs-hygiene.md).
3. **Link by symbol, not by line.** Say `assertWithinProject()` rather than `index.js:80` — the latter drifts with every edit.
4. **Docs are checked.** `npm run docs:check` validates every relative Markdown/HTML link, cross-file anchor and the completeness of this index across the whole repository. It runs in `npm run check` and CI.
5. **Frozen records are labelled.** Snapshots of past audits belong in [archive/](archive/README.md) with a banner; they are evidence, not instructions.
