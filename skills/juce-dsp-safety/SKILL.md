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
1. Grep `processBlock` and any helpers it calls for `new `, `malloc`, `std::vector`, `CriticalSection`, `std::mutex`, `File::`, `DBG`, and `String` constructions that can allocate — zero hits on the audio path.
2. Build with ThreadSanitizer (`-fsanitize=thread`) and run a stress test (small buffers, high CPU load, rapid parameter changes) for ≥10 minutes with no races or dropouts.
3. `pluginval` at strictness ≥5 completes without audio-thread violations or crashes.
4. Manual review or static analysis confirms all buffers and state are sized in `prepareToPlay` only.
