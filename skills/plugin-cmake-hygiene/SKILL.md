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
- `cmake --build build --config Release` succeeds with zero warnings.
- The same commit produces identical artifacts on a clean machine.
