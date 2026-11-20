---
name: juce-ableton-ui-perf
description: "JUCE editor performance patterns specifically for Ableton Live's aggressive editor pre-loading. Use when timers, repaints, or UI updates cause Live's UI to crawl even with the plugin window closed."
type: workflow
lifecycle: active
---

# JUCE Editor Performance in Ableton Live

Live constructs every editor on project load and keeps it alive. Expensive work in `timerCallback` or `visibilityChanged` runs even when the window is hidden.

## Required guards
```cpp
void timerCallback() override
{
    if (!isShowing()) return;
    // only do work when actually visible
}
```

## Editor lifecycle
Override `visibilityChanged()` to create/destroy heavy child components or stop timers when hidden.

## Avoid
- Allocating or building Graphics paths every timer tick.
- Calling `repaint()` unconditionally.
- Doing DSP or file work on the message thread from the editor.
