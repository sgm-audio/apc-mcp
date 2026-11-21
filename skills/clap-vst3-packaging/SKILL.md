---
name: clap-vst3-packaging
description: "Package, validate, codesign, and distribute CLAP, VST3, and LV2 plugins. Use when running pluginval or clap-validator, creating dist packages, fixing Gatekeeper/quarantine issues, or preparing a local or commercial release of a CMake audio plugin."
---

# CLAP / VST3 / LV2 Packaging

## When to use
- Shipping a plugin with `apc-ship` or an equivalent CMake package target.
- pluginval or clap-validator fails.
- macOS Gatekeeper blocks a CLAP or VST3.
- Creating a self-contained dist folder.

## Steps
1. Build Release.
2. Lint sources.
3. Run `pluginval --strictness-level 5 --validate-in-process` (and clap-validator for CLAP).
4. Package into `dist/<Name>-<Version>-<OS>/` with INSTALL.txt.
5. On macOS run ad-hoc `codesign --force --deep -s -` so the bundle loads locally. This
   signature is **local-only**: it confers no Gatekeeper trust, is not notarized, and is
   never valid for distribution. For a distributable build, sign with a Developer ID
   Application certificate (`--options runtime --timestamp`), notarize with
   `xcrun notarytool submit --wait` and staple with `xcrun stapler staple` — see
   `docs/release.md`. On Windows a release needs timestamped Authenticode
   (`signtool sign /tr <timestamp_url> /td sha256 /fd sha256`).
6. Install to the OS user folder (`~/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\VST3`, `~/.vst3`).

## Common failures
- Empty audio buses → pure MIDI plugins rejected by some hosts.
- Missing codesign → Gatekeeper quarantine on macOS.
- An ad-hoc-signed bundle that worked locally is rejected on another machine — expected;
  ad-hoc signatures do not travel. Use the release flow in `docs/release.md`.
- pluginval strictness ≥5 runs auval; filters that assume ≥48 kHz or multi-channel fail.

## Verification
1. `pluginval --strictness-level 5 --validate-in-process <path-to.vst3>` exits 0 with no failures.
2. For CLAP: `clap-validator validate <path-to.clap>` exits 0.
3. Dist folder contains the binary, INSTALL.txt, and (on macOS) a valid ad-hoc signature for local use (`codesign -dv --verbose=4`). For distribution, verify `codesign --verify --deep --strict`, a `status: Accepted` notarization and `xcrun stapler validate` instead (`docs/release.md`).
4. After local install the plugin appears and loads in both Reaper and Ableton Live with a fresh project.
5. On macOS, `spctl --assess --type execute` or Gatekeeper does not quarantine the ad-hoc-signed bundle for local use. This says nothing about distribution machines; they need the notarized flow.
