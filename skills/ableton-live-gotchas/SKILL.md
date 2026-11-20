---
name: ableton-live-gotchas
description: "Ableton Live-specific gotchas for JUCE plugins drawn from the JUCE Forum and official Ableton docs. Use when a plugin misbehaves only in Live: UI lag, crashes on load, MIDI-only plugins not instantiating, AU automation death, latency crashes, or editor lifecycle issues."
type: knowledge
lifecycle: active
---

# Ableton Live Gotchas for JUCE Plugins

## Editor pre-loading (Windows UI death)
Live instantiates every plugin editor on project load and keeps timers running even when the UI is closed. Guard expensive work:
```cpp
void timerCallback() override
{
    if (!isShowing()) return;
    // expensive work
}
```
Users can force on-demand behavior by opening then closing every editor once.

## MessageManagerLock is toxic
Never take `MessageManagerLock` from the processor or any path that can race Live’s message queue. It deadlocks or crashes VST3 projects.

## Pure MIDI VST3 won’t load
Live refuses empty audio buses. Force a stereo output when running in Live:
```cpp
AudioProcessor (PluginHostType().isAbletonLive()
    ? BusesProperties().withOutput("out", AudioChannelSet::stereo())
    : BusesProperties())
```

## AU parameter ID changes kill automation permanently
Porting older JUCE to newer changes param IDs. Live AU disables automation with no re-enable button. Set `JUCE_FORCE_USE_LEGACY_PARAM_IDS=1`.

## setLatencySamples + certain VST3 restart flags crash Live 10
Delay the first `setLatencySamples` call or avoid `kParamTitlesChanged` in restartComponent.

## Program-change UI polling can crash large sessions
A 30 Hz timer that polls `getCurrentProgram` and repaints has crashed Live in big projects. Prefer host-driven updates or heavier guards.

## Meta-parameters that don’t notify get stomped
If a meta-param changes a slave without notifying the host, Live VST3 can force the old value back on the next gesture.

## Metal / peer timing (Live 12)
Graphics calls that fire before the peer exists crash. Guard with `if (getPeer() == nullptr) return;`.

## Official Ableton rules
- Use only one format (AU or VST3 or VST2) of the same plugin in a Set.
- Waves AU is unsupported — use VST3.
- Install to default system folders; never mix VST2/VST3 in one folder.
