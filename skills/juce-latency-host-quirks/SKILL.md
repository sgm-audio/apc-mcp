---
name: juce-latency-host-quirks
description: "Host-specific rules for setLatencySamples in JUCE. Use when Ableton Live crashes on project load, offline renders drop samples, or latency reported from the audio thread causes problems."
---

# Latency Reporting Quirks

## When to use
- Live 10 crashes on project load after calling `setLatencySamples`.
- Offline render in Ableton drops blocks once dynamic latency is reported.
- You need to report plugin latency safely.

## Rules
- Report latency as early as possible and only when it actually changes.
- Prefer `prepareToPlay` over the audio thread.
- Delay the first call until the plugin is fully initialized; avoid unnecessary VST3 restart flags.
- Never change latency from inside `processBlock`.

## Verification
- Project loads in Live 10/11/12 without crash.
- Offline render completes without dropouts.
