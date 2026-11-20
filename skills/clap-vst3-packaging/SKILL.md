---
name: clap-vst3-packaging
description: "Package, validate, codesign, and distribute CLAP, VST3, and LV2 plugins. Use when running pluginval or clap-validator, creating dist packages, fixing Gatekeeper/quarantine issues, or preparing a local or commercial release of a CMake audio plugin."
---

# CLAP / VST3 / LV2 Packaging

## When to use
- Shipping a plugin with `audio_plugin_ship` or an equivalent CMake package target.
- pluginval or clap-validator fails.
- macOS Gatekeeper blocks a CLAP or VST3.
- Creating a self-contained dist folder.

## Steps
1. Build Release.
2. Lint sources.
3. Run `pluginval --strictness-level 5 --validate-in-process` (and clap-validator for CLAP).
4. Package into `dist/<Name>-<Version>-<OS>/` with INSTALL.txt.
5. On macOS run ad-hoc `codesign --force --deep -s -` so the bundle loads locally.
6. Install to the OS user folder (`~/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\\VST3`, `~/.vst3`).

## Common failures
- Empty audio buses → pure MIDI plugins rejected by some hosts.
- Missing codesign → Gatekeeper quarantine on macOS.
- pluginval strictness ≥5 runs auval; filters that assume ≥48 kHz or multi-channel fail.

## Verification
- Plugin loads in Reaper and Ableton Live after local install.
- clap-validator and pluginval both pass at the target strictness.
