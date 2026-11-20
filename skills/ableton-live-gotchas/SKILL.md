---
name: ableton-live-gotchas
description: "Ableton Live-specific gotchas for JUCE plugins. Use when a plugin misbehaves only in Live: UI lag with the editor closed, MIDI-only plugins not loading, AU automation death, latency crashes, or editor lifecycle issues."
---

# Ableton Live Gotchas

## When to use
- UI crawls in Live even with the plugin window closed.
- Pure MIDI VST3 fails to instantiate.
- AU automation is permanently disabled after a JUCE update.
- Live 10 crashes on project load when reporting latency.

## Critical guards
- Live pre-loads every editor. Guard expensive work:
  ```cpp
  void timerCallback() override { if (!isShowing()) return; /* work */ }
  ```
- Never take `MessageManagerLock` from the processor.
- Force a stereo output bus for pure MIDI plugins when `PluginHostType().isAbletonLive()`.
- Set `JUCE_FORCE_USE_LEGACY_PARAM_IDS=1` to preserve AU automation.
- Delay the first `setLatencySamples` call or avoid certain VST3 restart flags.

## Verification
1. Load multiple instances in Ableton Live with all editors closed — Live UI remains responsive (no crawl).
2. Pure MIDI plugin instantiates on a MIDI track in Live.
3. Existing AU automation survives project reload after the change.
4. Project containing the plugin loads in Live 10/11/12 without crash when latency is reported.
5. No `MessageManagerLock` appears in processor code (grep confirmation).
