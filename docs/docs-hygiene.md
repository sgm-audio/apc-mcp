# Docs hygiene report

**Date:** 2026-11-07 · **Scope:** every Markdown file in the repository, plus references to docs from code, tests, scripts, CI and GitHub templates.

This is the audit of the documentation set and the confidence assessment requested alongside the README rewrite. It is a dated snapshot; the [verification baseline](project-status.md#verification-baseline) holds the reproducible numbers for the code.

## Method

1. Read all seven root Markdown documents (~185 KB), `index.js` (1,418 lines), the five scaffold `CMakeLists.txt` files, `package.json`, `scripts/`, `tests/`, `.github/` workflows and templates.
2. Cross-checked every factual claim against the code and the real environment: `npm ci`, `npm test`, `npm run lint`, `npm run smoke`, `npm audit`, `npm run licenses`, `npm run check`, `npm run docs:check`, `git tag`, and the npm registry.
3. Inventoried every relative Markdown/HTML link and cross-file anchor, then fixed what broke.
4. Rewrote the documentation into `docs/` with a single home per fact; archived frozen records with explicit banners.

## Before → after

| Measure | Before | After |
|---|---|---|
| `README.md` | 387 lines / 2,425 words / 22.0 KB — status, quickstart, tool reference, config, development, FAQ, project tree | **78 lines / 424 words / 3.7 KB** — what it is, "wraps your toolchain, not SDKs", quickstart, docs links (−83% bytes) |
| Root-level Markdown | 7 files / 184.7 KB, no index, live docs mixed with frozen logs | 4 files / 51.2 KB: concise README, release history, two short convention stubs |
| Maintained reference docs | none (everything in README + root files) | **11 documents in `docs/`**, ~66 KB, with an [index](README.md) and a documented policy |
| Historical records | `AUDIT.md` + `HANDOFF.md` (94 KB) presented as current docs | [`docs/archive/`](archive/README.md) with "not maintained" banners; current state rewritten as [project-status.md](project-status.md) |
| Roadmap | `TODO.md`, mostly struck-through completed items | [roadmap.md](roadmap.md) — shipped vs ARA remaining |
| Link checking | `tests/release.test.js` checked relative links in root `.md` only | `npm run docs:check` checks every `.md` in the repo, HTML `href`/`src`/`srcset`, cross-file anchors and index completeness; wired into `npm run check` and CI |

Everything that was documented is still documented, rewritten: the [docs index](README.md) maps each topic to its single maintained home.

## Findings and resolutions

| ID | Severity | Finding (evidence) | Resolution |
|---|---|---|---|
| D-01 | High | README mixed six unrelated audiences into one 387-line page; a new user had to scroll past a project-status block, a full tool reference and a repository tree to find the install command. | Rewrote to 78 lines: identity → toolchain-not-SDKs callout → 3-step quickstart → documentation links. |
| D-02 | High | No `docs/` directory and no navigation; seven root Markdown files totalled 184.7 KB with overlapping content. | Created `docs/` with an index, a "one home per fact" policy, and short root stubs where GitHub relies on fixed filenames. |
| D-03 | High | **Contradictory volatile numbers.** `CONTRIBUTING.md`: "189 tests across 7 files"; `README.md` / `SECURITY.md`: 215; `HANDOFF.md`: 189; `AUDIT.md` follow-up: 174. `HANDOFF.md` said `index.js` was 1,301 lines (it is 1,418); `CONTRIBUTING.md` said "~1,300". | Removed counts from prose. One dated, reproducible baseline in [project-status.md](project-status.md#verification-baseline); commands (`npm test`, `npm audit`, …) everywhere else. |
| D-04 | High | **Stale source line references** throughout `SECURITY.md` and `HANDOFF.md`: e.g. `registerTool()` at `index.js:713` (actually 736), `trySpawn()` `:193` (195), `CONFIG_SCHEMA` `:250` (253), `loadProjectConfig()` `:263` (266), `assertWithinProject()` `:80` (81). | Defence layers in [security.md](security.md#defence-layers) link by **symbol name**; policy item 3 forbids line numbers in docs. |
| D-05 | High | **Factually wrong validator coverage.** README claimed `audio_plugin_validate` "runs pluginval on VST3 and (on macOS) AudioUnit". In `index.js`, `validatorFor` maps only `VST3` and `CLAP`; AU, LV2 and Standalone artefacts are explicitly reported `SKIPPED` and make the run incomplete. | Corrected in [tools.md](tools.md#audio_plugin_validate), [toolchain.md](toolchain.md#good-to-know-quirks) and [troubleshooting.md](troubleshooting.md). |
| D-06 | Medium | **Unusable security advice.** `SECURITY.md` told users to `npm install -g @sgm-audio/apc-mcp@latest` to get the fix; the npm registry returns **404** for that package and the newest tag is `v1.5.0`. | Replaced with `npx -y github:sgm-audio/apc-mcp`, a `--version` check and cache-clearing instructions in [security.md](security.md) and [getting-started.md](getting-started.md#install-from-github-until-200-is-tagged). |
| D-07 | Medium | Quick-start MCP config was OpenCode-shaped (`"mcp": { … "command": [array] }`) while the README claimed "any MCP client"; other clients would fail to parse it. | Generic `mcpServers` snippet plus an explicit note that the *envelope* varies by client, in [getting-started.md](getting-started.md#1-add-apc-mcp-to-your-mcp-client). |
| D-08 | Medium | `AUDIT.md` (655 lines) and `HANDOFF.md` (589 lines) are frozen session logs presented at top level as live documentation; `TODO.md` was ~85% struck-through completed work. No single "current state" document existed. | Archived both with banners + an [archive README](archive/README.md); wrote [project-status.md](project-status.md) and [roadmap.md](roadmap.md); removed `TODO.md`. |
| D-09 | Medium | Moving files would have dangled references: README's project tree, `CONTRIBUTING.md` ("update the README tool table", `HANDOFF.md §4`), `.github/pull_request_template.md` (`AUDIT.md`, `HANDOFF.md §4`), three test-file comments, and `CHANGELOG.md`'s legacy filenames. | All updated to `docs/…` / `docs/archive/…`; `CHANGELOG.md` got a header note explaining the pre-reorg names. `scripts/ship.mjs` still reads root `CHANGELOG.md`, so that file stays put. |
| D-10 | Medium | Docs links were only checked for root Markdown files, so a new `docs/` tree could rot unnoticed; anchors were never checked at all. | Added `scripts/check-docs.mjs` + `npm run docs:check`: recursive Markdown scan, fenced-code-aware, resolves relative paths, GitHub-style heading slugs, explicit HTML anchors and asset refs, and verifies the docs index is complete. Added to `npm run check` and the CI `test` job. |
| D-11 | Low | Duplication: prerequisites/SDK table, FAQ answers, config example, tool examples, development setup and project status each appeared in 2–4 root documents with divergent wording. | One home per topic: [toolchain](toolchain.md), [troubleshooting](troubleshooting.md), [configuration](configuration.md), [tools](tools.md), [development](development.md), [project status](project-status.md). Cross-links only. |
| D-12 | Low | README used absolute `raw.githubusercontent.com/.../main/...` image URLs (wrong branch in forks, opaque offline) and a release badge that would show `v1.5.0` while `package.json` is `2.0.0`. | Relative `assets/*.svg` paths; confusing release badge dropped. |
| D-13 | Low | README claimed the baseline includes "real `gcc`/`g++` compile + link checks" without qualification; locally **8 of 215 tests skip** unless `APC_CLAP_INCLUDE` / `APC_LV2_INCLUDE` are set (CI does set them). | Stated explicitly in [project-status.md](project-status.md#verification-baseline) and [development.md](development.md#commands). |

### Claims verified accurate

`npm run check` exits 0; `npm test` reports 215 tests / 0 failures (8 environment-dependent skips); `npm run smoke` 10/10; `npm audit` 0 vulnerabilities; license gate 163 lockfile packages; ESLint clean; latest git tag `v1.5.0`; `@sgm-audio/apc-mcp` not published (404); seven tools registered; `engines.node >=22`; `files: ["index.js", "templates/"]`; all CMake/SDK resolution paths in the docs match the templates.

### Automatic check result

`npm run docs:check` passes over the whole repository (including `docs/archive/` and `.github/`): **21 Markdown files, 138 relative paths, 44 anchors, 10 indexed docs (plus the index), 0 broken links**. All 12 unique `github.com` URLs in the maintained docs were spot-checked and returned HTTP 200 (the JUCE dependency link is pinned to the same `9.0.3` tag the templates target). The checker deliberately does **not** fetch external URLs — that would make an offline quality gate network-dependent. `npm run lint` passes over the new checker; `git diff --check` is clean.

## Confidence score

Ratings describe the project **after this reorganisation**, on a 0–10 scale where higher is better. "Complexity" is scored as *manageability* (higher = leaner / easier to reason about). **Confidence** is how strongly the evidence I could actually gather supports each rating — not a measure of the project.

| Dimension | Score | Confidence | Evidence |
|---|---|---|---|
| **Ease of use** | **7.5 / 10** | 88% | 78-line README, 3-step quickstart, generic MCP config, auto-detected project root, honest error messages with install hints. Held back by unavoidable manual setup: CMake + compiler + vendored JUCE/CLAP/LV2 SDKs, per-client config shapes, an unreleased `2.0.0` with no npm install path, and a few real gotchas (`_tools` depth, root markers, validator skips). |
| **Complexity** | **7.0 / 10** | 92% | One-file stdio server, 7 tools, 2 runtime dependencies, no framework, no network listener, `spawnSync` argv-only, clear containment boundary. The domain itself (four plugin formats, three SDKs, CMake generator differences, platform-specific headers) is irreducibly complex; `index.js` at 1,418 lines is outgrowing the "single file" design, and 8 local test skips hide compile coverage unless env vars are set. |
| **Relevance** | **9.0 / 10** | 85% | A focused, current MCP server for audio-plugin work with working scaffolds against JUCE 9 / CLAP / LV2, a documented prompt-injection threat model, honest `isError` semantics, Node 22+, pinned CI and a license gate. Gaps: no ARA template, validation for only VST3 + CLAP, no DAW host-load test, and the fixed version is not yet published. |
| **Quality** | **8.5 / 10** | 87% | 215 tests (negative/security, template structure, artefact discovery, real compiler checks in CI), 0 audit vulnerabilities, license gate, immutable CI pins, guarded release script, and now a navigable, link-checked docs set. Deductions: 8 environment-dependent skips, macOS CLAP bundle verification outstanding, single-file server, and the historical docs needed this hygiene pass. |
| **Overall** | **8.0 / 10** | **88%** | Weighted toward relevance and quality; ease of use is the main limiter and is a consequence of wrapping (rather than bundling) a real toolchain. |

### What I could not verify (why confidence is not 100%)

- No plugin was loaded in a real DAW, and no macOS or Windows build was run here; CI covers Linux compile/link for all three SDK families.
- No live MCP client session (Claude Code / VS Code / OpenCode) was exercised — only the stdio handshake in the test suite.
- The 8 skipped compile/link tests were not re-run with real upstream headers locally; CI sets `APC_CLAP_INCLUDE` / `APC_LV2_INCLUDE` and runs them.
- `2.0.0` is unreleased, so npm-install ergonomics and the published tarball were not tested end to end.
- Docs usability is assessed by structure, link integrity and factual verification, not by user testing.

## Maintenance checklist

- New document → add it to [docs/README.md](README.md); `npm run docs:check` fails otherwise.
- Never copy a live number into prose; point at the command, or update the dated [verification baseline](project-status.md#verification-baseline).
- New root file → check `scripts/ship.mjs` (`CHANGELOG.md`), GitHub conventions (`SECURITY.md`, `CONTRIBUTING.md`) and `tests/release.test.js` before moving anything.
- Historical evidence → [`docs/archive/`](archive/README.md) with a banner, never presented as current guidance.
- Run `npm run check` before committing; it now includes `npm run docs:check`.
