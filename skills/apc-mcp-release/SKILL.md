---
name: apc-mcp-release
description: "Release hygiene for sgm-audio/apc-mcp. Use when preparing a GitHub release, updating badges, CHANGELOG, or release notes. Forces live inspection of the repository before any advice or edits."
---

# apc-mcp Release Hygiene

## When to use
- Preparing a new version tag or GitHub Release.
- Updating README badges, version, or CHANGELOG.
- Verifying that published claims match the live repo.

## Mandatory first step
Inspect the live repository (README.md, package.json, CHANGELOG.md, index.js, docs/) via GitHub tools or a fresh clone. Reject any advice based solely on screenshots or cached knowledge.

## Output format
1. Live State Summary (version, tool count, key files).
2. Recommended Changes (only what the live files support).
3. Draft Release Notes.
4. Verification Checklist.

## Verification
1. `package.json` `"version"` exactly matches the intended tag.
2. CHANGELOG.md contains an entry for the new version with the correct date and bullet list of changes.
3. README badges and tool-count claims match the live `index.js` / `docs/tools.md` (count registered tools).
4. `npm run check` (or equivalent CI gate) passes on the release commit.
5. GitHub Release notes match the CHANGELOG entry and do not claim features absent from the live tree.
