<!-- Vendored from Noizefield/audio-plugin-coder (MIT). Adapted for apc-mcp. -->

# `apc::license` — Optional Licensing Seam

> **Source:** Vendored from `Noizefield/audio-plugin-coder` (`common/apc/ApcLicense.h` and `common/apc/ApcCanonicalJson.h`, MIT License).

Header-only, std-only C++17 (no JUCE dependency) licensing state machine and canonical JSON (`apc-canon/1`) parser/serializer.

## Design & Threat Model

- **Optional & OFF by default:** Enable in CMake with `-DAPC_USE_LICENSE_SEAM=ON` (`APC_USE_LICENSE_SEAM` defaults to `OFF`). When enabled, CMake adds this directory to the plugin target's private include path and defines `APC_HAS_LICENSE_SEAM=1`.
- **Never gates the audio path:** Every state (`DEMO`, `TRIAL`, `LICENSED`, `UNVERIFIED`) processes audio identically and recalls projects normally. Only UI/persistence verbs (`PresetSave`, `PackExport`, `PackInstall`) are queried, and `state()` / `isAllowed()` / `isLicensedRT()` are a single `std::atomic` load.
- **Injected verifier (no crypto library shipped):** `ApcLicense.h` does not bundle or link an Ed25519 implementation. Inject an `apc::ISignatureVerifier` adapter backed by a vetted library (e.g., libsodium, Monocypher-ed25519, or OpenSSL).
- **Friction, not DRM:** Signed license files, component-wise machine binding, and trial rollback guards are lightweight friction for honest users—not copy protection against a determined attacker.

## Files

| File | Purpose |
|---|---|
| `ApcLicense.h` | State machine, gate matrix, component-wise machine match, trial rollback guard |
| `ApcCanonicalJson.h` | Strict JSON parser, `apc-canon/1` canonical serializer, SHA-256/HMAC/base64/hex helpers, `ISignatureVerifier` interface |
