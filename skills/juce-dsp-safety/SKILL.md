---
name: juce-dsp-safety
description: "Real-time DSP safety rules for JUCE AudioProcessor code. Use when writing or reviewing processBlock, prepareToPlay, or any code that runs on the audio thread. Flags locks, allocations, file I/O, and other non-realtime operations."
---

# JUCE DSP Safety

## When to use
- Editing `processBlock` or `prepareToPlay`.
- A plugin glitches, drops out, or crashes under load.
- Reviewing generated or hand-written DSP.

## Rules (audio thread)
- No allocations (`new`, `std::vector::resize`, `String` construction that allocates).
- No locks (`CriticalSection`, `std::mutex`, `MessageManagerLock`).
- No file I/O, logging that allocates, or network.
- No unbounded loops or heavy computation that can miss the deadline.
- Prefer pre-allocated buffers and lock-free structures prepared in `prepareToPlay`.

## Example
```cpp
void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
{
    // safe: read atomic parameters, process pre-allocated state
    // unsafe: buffer.setSize(...), new float[], file writes
}
```

## Verification
- Plugin survives long stress tests at small buffer sizes with no dropouts.
- Thread sanitizer or manual review finds zero audio-thread violations.
