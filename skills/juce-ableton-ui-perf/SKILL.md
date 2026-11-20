---
name: juce-ableton-ui-perf
description: "Editor performance patterns for Ableton Live's aggressive editor pre-loading. Use when timers, repaints, or UI updates cause Live's UI to crawl even with the plugin window closed."
---

# Ableton UI Performance

## When to use
- Live UI becomes laggy with your plugin loaded, even if the editor is closed.
- `timerCallback` or heavy component construction runs while the window is hidden.

## Required guards
```cpp
void timerCallback() override
{
    if (!isShowing()) return;
    // only do work when actually visible
}
```

Override `visibilityChanged()` to create or destroy heavy child components and stop timers when hidden.

## Avoid
- Unconditional `repaint()` or Graphics path construction every timer tick.
- DSP or file work on the message thread from the editor.

## Verification
1. Load ≥8 instances in Ableton Live with all editors closed — CPU and UI thread remain responsive (no visible lag when clicking tracks or transport).
2. Open and close the editor repeatedly; no accumulating timers or retained heavy components (Instruments or Activity Monitor check).
3. Grep confirms every `timerCallback` and expensive constructor path is guarded by `isShowing()` or `visibilityChanged()`.
4. pluginval UI tests pass without host freezes.
