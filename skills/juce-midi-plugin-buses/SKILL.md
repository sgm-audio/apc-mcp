---
name: juce-midi-plugin-buses
description: "Correct bus layouts so pure MIDI or MIDI-generating JUCE plugins load in Ableton Live and other hosts that reject empty audio buses."
type: workflow
lifecycle: active
---

# MIDI Plugin Bus Layouts for Ableton

Ableton Live refuses VST3 plugins that have no audio buses. Pure MIDI plugins must declare at least one audio output.

## Standard fix
```cpp
MyProcessor()
    : AudioProcessor(BusesProperties()
          .withOutput("Output", AudioChannelSet::stereo()))
{}
```

## Host-conditional (cleaner)
```cpp
static BusesProperties getBuses()
{
    if (PluginHostType().isAbletonLive())
        return BusesProperties().withOutput("Output", AudioChannelSet::stereo());
    return BusesProperties(); // or your normal MIDI-only layout
}
```

Do not mark the plugin as "MIDI Effect Plugin" if you also need it to load as a regular instrument/effect in Live. Test instantiation in a fresh Live set after changing buses.
