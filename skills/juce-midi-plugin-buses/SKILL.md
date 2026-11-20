---
name: juce-midi-plugin-buses
description: "Declare correct audio buses so pure MIDI or MIDI-generating JUCE plugins load in Ableton Live and other hosts that reject empty buses. Use when a MIDI-only VST3 or CLAP fails to instantiate."
---

# MIDI Plugin Bus Layouts

## When to use
- A pure MIDI plugin or arpeggiator will not load in Ableton Live.
- You see “could not be opened” or empty-bus rejection.
- Scaffolding a synth or MIDI utility.

## Fix
Declare at least one stereo output when running in Live:

```cpp
MyProcessor()
    : AudioProcessor(BusesProperties()
          .withOutput("Output", juce::AudioChannelSet::stereo()))
{}
```

Or conditionally:

```cpp
if (juce::PluginHostType().isAbletonLive())
    return BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo());
```

Do not set the “MIDI Effect Plugin” flag if the plugin must also appear as a normal instrument or effect.

## Verification
1. Plugin instantiates without error in a fresh Ableton Live set (MIDI track and instrument track).
2. Same binary loads in Reaper with no empty-bus or “could not be opened” message.
3. `pluginval --strictness-level 5` completes the bus-layout tests without failure.
4. No host log entries about rejected empty output buses.
