---
name: juce-parameter-id-stability
description: "Keep JUCE parameter IDs stable so Ableton Live (especially AU) does not permanently disable automation. Also covers meta-parameter host notification that Live VST3 enforces. Use when updating JUCE, adding parameters, or seeing automation loss."
---

# Parameter ID Stability

## When to use
- AU automation disappears after a JUCE upgrade.
- Meta-parameters get overwritten in Live VST3.
- Adding parameters with `audio_plugin_add_param` or by hand.

## Rules
1. Enable `JUCE_FORCE_USE_LEGACY_PARAM_IDS=1` when porting older projects so existing automation survives.
2. When a meta-parameter changes other parameters, notify the host (`setValueNotifyingHost` or equivalent) or Live will stomp the value.
3. Call `setValueNotifyingHost` only when the value actually changed; batch with `updateHostDisplay` on preset load.

## Verification
1. Load a saved Ableton Live set that contains automation on the plugin; automation lanes still drive the parameters after the JUCE update or parameter addition.
2. Gesture a meta-parameter in Live VST3; the dependent parameters stay at the new values and are not overwritten on the next host update.
3. `pluginval` automation and parameter tests pass at strictness ≥5.
4. Diff of parameter IDs before/after shows no unexpected renames for existing parameters.
