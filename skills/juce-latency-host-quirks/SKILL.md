---
name: juce-latency-host-quirks
description: "Host-specific rules for setLatencySamples in JUCE, especially Ableton Live VST3 crashes on project load and offline-render dropouts when latency changes from the audio thread."
type: workflow
lifecycle: active
---

# Latency Reporting Quirks

## Ableton Live 10 VST3 crash
Calling `setLatencySamples` (especially with `kParamTitlesChanged` in the restart) crashes Live on project load. Workarounds:
- Delay the first call until after the plugin is fully initialized.
- Avoid unnecessary restart flags.

## Offline render dropouts
Changing latency from inside `processBlock` (or calling `setLatencySamples` every block) causes Ableton offline renders to drop blocks. Compute latency in `prepareToPlay` (or by processing one dummy block there) and only report once.

## General rule
Report latency as early as possible and only when it actually changes. Prefer `prepareToPlay` over the audio thread.
