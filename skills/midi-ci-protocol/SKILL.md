---
name: midi-ci-protocol
description: "MIDI-CI and MIDI 2.0 protocol implementation guidance for Rust or C++. Use when implementing discovery, property exchange, or protocol negotiation. Focuses on official specification details that are easy to get wrong."
---

# MIDI-CI Protocol

## When to use
- Implementing MIDI Capability Inquiry (MIDI-CI) discovery or property exchange.
- Negotiating MIDI 2.0 protocol between devices or plugins.
- Debugging failed profile or property transactions.

## Key rules
- Follow the official MIDI-CI specification for message formatting and timeouts.
- Handle the exact discovery and reply sequence; partial implementations fail silently.
- Property exchange requires correct subscription and chunking.
- Test against real hardware or a known-good reference implementation.

## Verification
1. Capture MIDI traffic (e.g. MIDI Monitor or Wireshark) and confirm discovery request/reply sequence matches the official MIDI-CI spec byte-for-byte.
2. Property exchange read and write succeeds against a reference device or test harness.
3. Timeout and error cases are handled without hanging the MIDI thread.
4. No malformed or truncated messages appear in the capture log.
