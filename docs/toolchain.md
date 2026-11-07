# Toolchain & SDKs

> **apc-mcp wraps your toolchain; it does not ship one.** It invokes binaries on `PATH` with argument arrays (never a shell) and writes only inside a marked project root. Compilers, CMake and the audio plugin SDKs are your responsibility.

## Prerequisites

| Category | Requirement | Used by |
|---|---|---|
| Runtime | [Node.js 22+](https://nodejs.org/) | The MCP server itself (Node 18 and 20 are EOL) |
| Build | [CMake 3.22+](https://cmake.org/download/) (`cmake`, `ctest`) | `configure`, `build`, `test` — templates require `cmake_minimum_required(VERSION 3.22)` |
| Build | Optional [Ninja](https://ninja-build.org/) | Faster parallel builds via `generator="Ninja"` |
| Compiler | C11 / C++20 toolchain — Xcode Command Line Tools (macOS), Visual Studio Build Tools (Windows), GCC or [Clang](https://llvm.org/) (Linux) | Compiling scaffolded plugins |

Optional tools, needed only for the matching tool call:

| Binary | Needed for | Install hint |
|---|---|---|
| [clang-format](https://clang.llvm.org/docs/ClangFormat.html) | `audio_plugin_lint` | `brew install clang-format` / `apt install clang-format` |
| [pluginval](https://github.com/Tracktion/pluginval/releases) | `audio_plugin_validate` on VST3 | Tracktion releases |
| [clap-validator](https://github.com/free-audio/clap-validator/releases) | `audio_plugin_validate` on CLAP | free-audio releases |

If a binary is missing, the tool names it, explains what it is for and prints an install hint instead of failing with an opaque exit code:

```text
## audio_plugin_configure failed
'cmake' not found on PATH (needed for build/configure).
  Install: brew install cmake / apt install cmake / https://cmake.org/download
```

## SDK discovery

Pick the SDK for the format you scaffold. The templates resolve it in this order (paths are relative to `<project>/plugins/<Name>/CMakeLists.txt`):

| Scaffold `type` | SDK | Resolution order |
|---|---|---|
| `clap` | [CLAP](https://github.com/free-audio/clap) — header-only C API | `find_package(clap CONFIG QUIET)` (i.e. `clap-config.cmake` on `CMAKE_PREFIX_PATH`) → `../../_tools/clap/CMakeLists.txt` via `add_subdirectory(…, EXCLUDE_FROM_ALL)` → clear `FATAL_ERROR`. The imported target is `clap`, not `CLAP::clap`. |
| `juce`, `vst3`, `standalone` | [JUCE 9](https://github.com/juce-framework/JUCE) — C++ framework | If `juce::juce_audio_utils` is not already a target: `-DJUCE_DIR=/path/to/JUCE` → `../../_tools/JUCE` → clear `FATAL_ERROR`. Alternatively call `add_subdirectory(JUCE)` yourself from the root `CMakeLists.txt` before the plugin; the guard prevents adding JUCE twice. JUCE supplies VST3 and LV2 wrappers, so no separate [Steinberg VST3 SDK](https://github.com/steinbergmedia/vst3sdk) is needed; the [Avid AAX SDK](https://developer.avid.com/aax/) is only needed if `formats` includes `AAX`. |
| `lv2` | [LV2](https://github.com/lv2/lv2) — header-only C11 spec | `find_path(LV2_INCLUDE_DIR NAMES lv2/core/lv2.h …)` with hints `LV2_DIR`, `LV2_INCLUDE_DIR`, env `APC_LV2_DIR` / `LV2_DIR` → `../../_tools/lv2/include` → clear `FATAL_ERROR`. System packages (`apt install lv2-dev`, `brew install lv2`) normally satisfy `find_path`. |

Vendoring the simple default — see [Getting started](getting-started.md#3-bootstrap-a-project-folder):

```sh
git clone --depth 1 https://github.com/free-audio/clap.git _tools/clap
# git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git _tools/JUCE
# git clone --depth 1 https://github.com/lv2/lv2.git _tools/lv2
```

Or pass flags to `audio_plugin_configure`:

```text
audio_plugin_configure(options="-DJUCE_DIR=/path/to/JUCE -DLV2_INCLUDE_DIR=/path/to/lv2/include")
```

## Platform notes

- **Linux / JUCE:** install the system dev headers from JUCE's [Linux Dependencies.md](https://github.com/juce-framework/JUCE/blob/9.0.3/docs/Linux%20Dependencies.md) (`libasound2-dev`, `libjack-jackd2-dev`, `ladspa-sdk`, `libcurl4-openssl-dev`, `libfreetype*-dev`, `libfontconfig1-dev`, the `libx*`/`libglu`/`mesa` family, `libegl-dev`, and `libwebkit2gtk-4.1-dev` for `ui="webview"`). On headless CI, wrap JUCE builds that include the `LV2` format in `xvfb-run -a`: JUCE's `juce_lv2_helper` touches GUI context during `POST_BUILD` `.ttl` generation.
- **WebView backend:** the `webview` template uses WebView2 on Windows, WebKit on Linux and WKWebView on macOS. Windows additionally needs [Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
- **Windows paths:** native `C:\...` paths are accepted (backslash is allowed in `projectPath`); they reach filesystem APIs or discrete argv entries, never a shell.
- **macOS CLAP:** the CLAP template produces a `CFBundle` on Apple platforms; bundle packaging needs platform-specific verification beyond the Linux/Windows compile checks. See [Project status](project-status.md#known-limitations).

## Good-to-know quirks

- **Empty folders are rejected on purpose.** Every tool needs `<project>/apc-mcp.json` or `<project>/CMakeLists.txt` first, so a typo'd `projectPath` cannot write outside a real project. `audio_plugin_create` creates a minimal root `CMakeLists.txt` when only `apc-mcp.json` exists.
- **`_tools/` is a fixed depth.** The fallback looks two directories up from `<project>/plugins/<Name>/CMakeLists.txt`. If you customise `pluginsDir` in `apc-mcp.json` to a deeper path, pass `-DJUCE_DIR=…` / `-DLV2_INCLUDE_DIR=…`, or `add_subdirectory()` the SDK from your root `CMakeLists.txt`.
- **System plug-in folders are never modified.** JUCE templates set `COPY_PLUGIN_AFTER_BUILD FALSE`, so builds cannot silently overwrite `~/Library/Audio/Plug-Ins` or fail on CI permissions. Copy from `<build>/plugins/<Name>/<Name>_artefacts/<Config>/` when ready.
- **Two different LV2 paths.** `type="lv2"` scaffolds a zero-dependency **pure C11** plugin (`<Name>.so` inside `<Name>.lv2/`, matching `manifest.ttl` on every platform). `type="juce"` builds a **C++ JUCE** plugin through JUCE's LV2 wrapper. They are unrelated.
- **`type="standalone"` ≠ `formats="Standalone"`.** The former scaffolds a standalone GUI audio *application* via `juce_add_gui_app` and rejects a `formats` argument. For a DAW plugin plus a standalone wrapper, use `type="juce"` with `formats="VST3;Standalone"`.
- **Validator coverage.** `pluginval` runs on VST3 and `clap-validator` on CLAP. LV2, AudioUnit and Standalone artefacts are discovered and reported **skipped** — no validator is configured for them, and the result is flagged incomplete. See [`audio_plugin_validate`](tools.md#audio_plugin_validate).
- **Single- vs multi-config CMake trees.** `audio_plugin_build` auto-configures `build/` on first run and regenerates single-config caches when the requested `config` differs from `CMAKE_BUILD_TYPE`; multi-config generators receive `--config` at build time.
- **Scaffolding is not installing.** `audio_plugin_create` reports success as soon as the files and root CMake registration exist. Building still needs the matching SDK; the generated `CMakeLists.txt` fails early with a readable message if it cannot find it.
