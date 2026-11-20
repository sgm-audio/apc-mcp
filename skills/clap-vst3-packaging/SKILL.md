---
name: clap-vst3-packaging
description: "CLAP, VST3, and LV2 packaging, validation, and distribution for audio plugins. Use when scaffolding, building, validating with pluginval or clap-validator, codesigning, or creating dist packages for macOS/Windows/Linux."
type: workflow
lifecycle: active
---

# CLAP / VST3 / LV2 Packaging

## Validation
- VST3: `pluginval --strictness-level 5 --validate-in-process <path-to.vst3>`
- CLAP: `clap-validator validate <path-to.clap>`
- Always run on the actual built artefact, not a symlink that escapes the project.

## macOS
- Ad-hoc sign for local testing: `codesign --force --deep -s - <bundle>`
- Public distribution requires Developer ID + hardened runtime + notarization (`notarytool`).
- Universal binaries: set `CMAKE_OSX_ARCHITECTURES="arm64;x86_64"` or equivalent.

## Windows
- Static runtime for release (`/MT`) to avoid redistributable dependencies.
- Authenticode signing for public installers.

## Output Layout
Prefer a `dist/<Name>-<Version>-<OS>/` folder containing the plugin bundle + INSTALL.txt.

Never claim a plugin is validated if the validator was skipped or the binary was not found.
