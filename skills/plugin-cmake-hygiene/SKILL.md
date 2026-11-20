---
name: plugin-cmake-hygiene
description: "CMake hygiene for JUCE, CLAP, and LV2 audio plugins. Use when writing or reviewing CMakeLists.txt for plugin projects: pinning dependencies, avoiding unpinned FetchContent, universal binaries, and reproducible builds."
type: workflow
lifecycle: active
---

# Plugin CMake Hygiene

## Dependency Pinning
- Never FetchContent from `main` or `master` without a GIT_TAG that is a commit SHA or version tag.
- Prefer project-local `_tools/` or a user cache (`~/.apc-mcp/deps/`) over repeated downloads.
- Support offline builds with `FETCHCONTENT_FULLY_DISCONNECTED=ON` once the cache is populated.

## JUCE Specific
- Guard `add_subdirectory(JUCE)` with `if(NOT TARGET juce::juce_audio_utils)`.
- Set stable `PLUGIN_CODE` and `PLUGIN_MANUFACTURER_CODE` (do not rely on random defaults).
- For LV2, always set an explicit `LV2URI` with a scheme.

## Platform
- macOS universal: `CMAKE_OSX_ARCHITECTURES=arm64;x86_64`
- Windows release: MultiThreaded runtime (`/MT`)

## Verification
`cmake -B build -S . && cmake --build build` must succeed from a clean tree with only the documented SDKs present.
