---
name: midi-ci-protocol
description: "MIDI-CI and MIDI 2.0 protocol implementation guidance for Rust or C++. Use when implementing discovery, property exchange, or protocol negotiation. Focuses on the official MIDI-CI specification details that are easy to get wrong."
type: knowledge
lifecycle: active
---

# MIDI-CI Protocol Notes

- MIDI-CI uses Universal System Exclusive. MUID is 28-bit, randomly generated, never 0xFFFFFFF.
- Discovery: Initiator sends Discovery, Responder replies with Reply to Discovery.
- Property Exchange uses JSON over SysEx. Chunking is required for large payloads (max 100 bytes payload per message in many implementations).
- Protocol Negotiation: Query Protocol, then Set Protocol.
- Always handle NAK and timeout. Devices can ignore unsupported features.
- In Rust, prefer zero-copy parsing of SysEx bytes; avoid allocating per message on the hot path.

Reference the official MIDI Association MIDI-CI specification for exact message formats. Do not invent message layouts.
