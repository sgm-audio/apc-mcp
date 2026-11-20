---
name: apc-mcp-release
description: "Release hygiene and README/docs polish for sgm-audio/apc-mcp. Use when preparing a GitHub release, tightening presentation, verifying badges/tags/changelog against live repo state, or generating verified release notes. Forces live inspection via GitHub tools or clone before any advice or edits."
type: workflow
lifecycle: active
---

# apc-mcp Release Hygiene — Live Repo Only

Use this skill whenever the task involves polishing, releasing, or verifying presentation of the `sgm-audio/apc-mcp` MCP server (or similar CMake/JUCE/CLAP plugin tooling repos). Never trust screenshots, cached summaries, or previous conversation claims about tool counts, versions, or file contents.

## Mandatory Live Inspection (Do This First)

1. Confirm GitHub connector is available. If not, request it.
2. Fetch the live tree and key files:
   - `github___get_repository_tree` (owner=`sgm-audio`, repo=`apc-mcp`, recursive=true)
   - `github___get_file_contents` for: `README.md`, `package.json`, `CHANGELOG.md`, `docs/development.md`, `docs/tools.md`, `LICENSE`, `index.js` (first 200 lines or search for tool registration), `.github/workflows/publish.yml`
3. Extract authoritative facts only from these live fetches:
   - Exact version from `package.json`
   - Number and names of MCP tools (search `registerTool` or equivalent in `index.js`)
   - Presence of slash commands / prompts
   - Existing badges, sections, and links in `README.md`
   - Latest tagged version vs. unreleased notes in `CHANGELOG.md`
   - Whether `LICENSE`, `SECURITY.md`, docs/ are present and consistent
4. If any claim from the user or prior AI contradicts the live files, explicitly call it out and proceed from live state only.

## Core Workflow: Polish → Verify → Release Notes

### 1. Gap Analysis (against live state)
Compare current files to high-signal release hygiene:
- README is a scannable landing page (one-liner + "wraps toolchain" callout + Quick Start + tools-at-a-glance + links to docs/). Deep architecture belongs in `docs/`.
- Badges: Node version, license, GitHub release/version. No badge soup.
- `package.json`: `"version"` matches intended release, `"engines": {"node": ">=22"}`, `"type": "module"`, `"license": "MIT"`, repository/homepage set.
- `CHANGELOG.md` has a dated `## [X.Y.Z]` section (or Unreleased ready to promote).
- Repo About sidebar topics and description match reality (mcp, juce, clap, lv2, cmake, audio-plugin, model-context-protocol).
- One visual proof (screenshot or GIF of scaffold + build/validate) is linked or noted as missing.

### 2. Generate Concrete Changes
Produce:
- Exact diff or new section text for `README.md` (keep it tight; move excess to docs/).
- Ready-to-paste GitHub Release body for the next version (list actual tools, requirements, verification commands from live `package.json` scripts).
- Suggested annotated tag command and `package.json` version bump if needed.
- Any missing files or badge updates.

Do **not** invent tool names, counts, or features that are not in the live `index.js` / docs.

### 3. Verification Steps (must be included in output)
Always end with an explicit verification checklist the human or next agent can run:
- `npm run check` (or the live scripts: test, lint, typecheck, smoke*)
- Confirm `package.json` version == intended tag
- Confirm README badges and links resolve
- Confirm CHANGELOG entry matches the release body
- Optional: open a PR with the changes and request review

## Output Format
1. **Live State Summary** (3–6 bullets, facts only from fetched files)
2. **Recommended Changes** (concrete text or diffs)
3. **Release Notes Draft** (tight, accurate)
4. **Verification Checklist**

Never skip the live inspection. Screenshots are evidence of a past state only.
