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
- Version in package.json matches the tag.
- CHANGELOG entry exists.
- Badges and README claims match the actual tool list and behavior.
