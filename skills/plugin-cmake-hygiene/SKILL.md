---
name: plugin-cmake-hygiene
description: "Enforce reproducible CMake for JUCE, CLAP, and LV2 audio plugins. Use when writing or reviewing CMakeLists.txt, pinning dependencies, avoiding unpinned FetchContent, setting universal binaries, or debugging configure/build failures in generated plugin projects."
---

# Plugin CMake Hygiene

## When to use
- Creating or editing a CMakeLists.txt for a JUCE / CLAP / LV2 plugin.
- A configure or build fails after a dependency update.
- You need reproducible builds across machines or CI.
- Enabling universal macOS binaries or warnings-as-errors.

## Required practices
1. Pin every external dependency by exact commit or tagged release. Never use `GIT_TAG main` or unpinned `FetchContent`.
2. Prefer project-local `_tools/` or a user cache (`~/.apc-mcp/deps/`) over network FetchContent on every configure.
3. Set `CMAKE_CXX_STANDARD 20` and enable warnings-as-errors (`-Wall -Wextra -Werror` or `/W4 /WX`).
4. For macOS universal builds use `CMAKE_OSX_ARCHITECTURES=arm64;x86_64` or an explicit option.
5. Statically link the MSVC runtime on Windows Release (`/MT`).

## Example
```cmake
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG be29c81492b6151c8ea8d14c840e1311963b3a83)  # exact pin
```

## Verification
1. `rg -n "GIT_TAG (main|master)|FetchContent_Declare" CMakeLists.txt` — no unpinned tags.
2. `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release` succeeds with no network errors when offline after cache is populated.
3. `cmake --build build --config Release` exits 0 and produces zero compiler warnings.
4. On macOS, `file build/**/*.vst3/**/*.dylib` (or equivalent) shows both arm64 and x86_64 when universal is requested.
5. Same commit on a second clean machine produces identical binary hashes for the non-timestamped artifacts.
