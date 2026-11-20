---
name: juce-dsp-safety
description: "Real-time DSP safety rules for JUCE audio plugins. Use when writing, reviewing, or generating AudioProcessor processBlock, prepareToPlay, or any code that runs on the audio thread. Flags locks, allocations, file I/O, and other non-realtime operations."
type: workflow
lifecycle: active
---

# JUCE DSP Safety — Audio Thread Rules

Apply these rules to every JUCE AudioProcessor that processes audio. The audio thread must never block, allocate, or do non-deterministic work.

## Hard Rules (Audio Thread)
- No `new`, `malloc`, `std::vector::push_back` that can reallocate, or any heap allocation.
- No locks (`std::mutex`, `juce::CriticalSection`, `std::atomic` with blocking CAS loops that can spin forever).
- No file I/O, network, logging that flushes, or `DBG`/`std::cout`.
- No `juce::String` operations that allocate (prefer `juce::String::fromUTF8` pre-allocated or raw buffers).
- No exceptions that can be thrown on the audio path.
- Prefer `juce::AudioBuffer` views, pre-allocated delay lines, and fixed-size arrays.

## Allowed Patterns
- Pre-allocate everything in `prepareToPlay` or constructor.
- Use `juce::dsp::AudioBlock` and `juce::dsp::ProcessContextReplacing`.
- Double-buffer or lock-free queues for parameter updates from the message thread.
- `juce::SmoothedValue` for parameter smoothing (already realtime-safe).

## Review Checklist
1. Does `processBlock` (or `process`) allocate?
2. Is there any `CriticalSection` or mutex held across the audio callback?
3. Are delay lines, FFT buffers, and coefficient arrays sized in `prepareToPlay`?
4. Are parameter changes copied via atomic or lock-free mechanism?

Flag any violation immediately with the exact line and the safe alternative.
