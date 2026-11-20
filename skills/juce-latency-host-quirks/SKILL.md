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
1. Project containing the plugin loads in Ableton Live 10, 11, and 12 without crash.
2. Offline render (Export Audio) completes with no dropped blocks or truncated tails.
3. Grep confirms `setLatencySamples` is never called from `processBlock`.
4. pluginval latency tests pass; reported latency matches the actual delay measured with a impulse.
