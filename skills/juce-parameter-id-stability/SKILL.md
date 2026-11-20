---
name: juce-parameter-id-stability
description: "Keep JUCE parameter IDs stable across versions so Ableton Live (especially AU) does not permanently disable automation. Also covers meta-parameter host-notification rules that Live VST3 enforces."
type: workflow
lifecycle: active
---

# Parameter ID Stability and Host Notification

## AU automation death on ID change
When porting from older JUCE, parameter IDs change. Live AU treats this as a different plugin and permanently disables existing automation (no re-enable button).

Enable in your Projucer / CMake:
```
JUCE_FORCE_USE_LEGACY_PARAM_IDS=1
```
This restores the old continuous index behavior. Document the choice — it affects saved projects.

## Meta-parameters
If a meta-parameter changes other parameters internally, you must still notify the host of the slave changes (or Live VST3 will stomp the value on the next gesture). Use `setValueNotifyingHost` or the appropriate VST3 restart only when the value actually changed, and prefer the message thread.

## setValueNotifyingHost volume
Calling it for every parameter on preset load blocks Live’s UI. Only notify when the value actually differs, and batch via `updateHostDisplay` when possible.
