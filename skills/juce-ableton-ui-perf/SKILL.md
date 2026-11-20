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
- Live remains responsive with multiple instances loaded and editors closed.
