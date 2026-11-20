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

Pick the SDK for the format you scaffold. The templates resolve it in this order (`CMAKE_SOURCE_DIR` is the **project root**, so the first hop works no matter how deep or customised `pluginsDir` is; the second is the legacy fixed-depth fallback):

| Scaffold `type` | SDK | Resolution order |
|---|---|---|
| `clap` | [CLAP](https://github.com/free-audio/clap) — header-only C API | `find_package(clap CONFIG QUIET)` (i.e. `clap-config.cmake` on `CMAKE_PREFIX_PATH`) → `${CMAKE_SOURCE_DIR}/_tools/clap/CMakeLists.txt` via `add_subdirectory(…, EXCLUDE_FROM_ALL)` → legacy two-up fallback → clear `FATAL_ERROR`. The imported target is `clap`, not `CLAP::clap`. |
| `juce`, `vst3`, `standalone` | [JUCE 9](https://github.com/juce-framework/JUCE) — C++ framework | If `juce::juce_audio_utils` is not already a target: `-DJUCE_DIR=/path/to/JUCE` or `$ENV{JUCE_DIR}` → `${CMAKE_SOURCE_DIR}/_tools/JUCE` → plugin `_tools/JUCE` → legacy two-up fallback → global cache `~/.apc-mcp/deps/JUCE` → pinned `FetchContent` fallback (`9.0.3` commit `be29c81492b6151c8ea8d14c840e1311963b3a83`, populated into `~/.apc-mcp/deps/` and respecting `FETCHCONTENT_FULLY_DISCONNECTED`). Alternatively call `add_subdirectory(JUCE)` yourself from the root `CMakeLists.txt` before the plugin; the guard prevents adding JUCE twice. JUCE supplies VST3 and LV2 wrappers, so no separate [Steinberg VST3 SDK](https://github.com/steinbergmedia/vst3sdk) is needed; the [Avid AAX SDK](https://developer.avid.com/aax/) is only needed if `formats` includes `AAX`. |
| `juce` / `vst3` with `ui="jive"` | [JIVE](https://github.com/ImJimmi/JIVE) — declarative XML/JSON UI | Resolved only when `APC_USE_JIVE=ON` and `jive::jive_layouts` is not already a target: `-DJIVE_DIR=/path/to/JIVE` or `$ENV{JIVE_DIR}` → plugin `_tools/JIVE` → `${CMAKE_SOURCE_DIR}/_tools/JIVE` → legacy two-up fallback → global cache `~/.apc-mcp/deps/JIVE` → pinned `FetchContent` fallback (`v2.0.1` commit `693788a539eb42b9c15848706f9ceae43ee60084`, populated into `~/.apc-mcp/deps/` and respecting `FETCHCONTENT_FULLY_DISCONNECTED`). Links `jive::jive_layouts` and `jive::jive_style_sheets` privately on the plugin target. |
| `lv2` | [LV2](https://github.com/lv2/lv2) — header-only C11 spec | `find_path(LV2_INCLUDE_DIR NAMES lv2/core/lv2.h …)` with hints `LV2_DIR`, `LV2_INCLUDE_DIR`, env `APC_LV2_DIR` / `LV2_DIR` → `${CMAKE_SOURCE_DIR}/_tools/lv2/include` → legacy two-up fallback → clear `FATAL_ERROR`. System packages (`apt install lv2-dev`, `brew install lv2`) normally satisfy `find_path`. |

Vendoring the simple default — see [Getting started](getting-started.md#3-bootstrap-a-project-folder):

```sh
git clone --depth 1 https://github.com/free-audio/clap.git _tools/clap
# git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git _tools/JUCE
# git clone --depth 1 --branch v2.0.1 https://github.com/ImJimmi/JIVE.git _tools/JIVE
# git clone --depth 1 https://github.com/lv2/lv2.git _tools/lv2
```

Or pass flags to `audio_plugin_configure`:

```text
audio_plugin_configure(options="-DJUCE_DIR=/path/to/JUCE -DJIVE_DIR=/path/to/JIVE -DLV2_INCLUDE_DIR=/path/to/lv2/include")
```

## Platform notes

- **Linux / JUCE:** install the system dev headers from JUCE's [Linux Dependencies.md](https://github.com/juce-framework/JUCE/blob/9.0.3/docs/Linux%20Dependencies.md) (`libasound2-dev`, `libjack-jackd2-dev`, `ladspa-sdk`, `libcurl4-openssl-dev`, `libfreetype*-dev`, `libfontconfig1-dev`, the `libx*`/`libglu`/`mesa` family, `libegl-dev`, and `libwebkit2gtk-4.1-dev` for `ui="webview"`). On minimal/headless Linux environments where `alsa` is absent from `pkg-config`, the JUCE scaffolds automatically set `JUCE_ALSA=0` so VST3/LV2 plugin builds still succeed. On headless CI, wrap JUCE builds that include the `LV2` format and `pluginval` runs in `xvfb-run -a`.
- **Windows / MSVC:** JUCE plugin scaffolds set `CMAKE_MSVC_RUNTIME_LIBRARY` to `MultiThreaded$<$<CONFIG:Debug>:Debug>` (`/MT` in Release) so distributed `.vst3` binaries do not depend on a matching VC++ Redistributable.
- **macOS universal binaries:** pass `-DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"` or `-DAPC_MACOS_UNIVERSAL=ON` when configuring Release distribution builds.
- **Staging (`dist/`):** JUCE plugin builds automatically copy clean `.vst3`, `.component` (AU) and `.lv2` bundles into `<build>/dist/<Config>/` and expose a `<PluginName>_package` target.
- **WebView backend:** the `webview` template uses WebView2 on Windows, WebKit on Linux and WKWebView on macOS. Windows additionally needs [Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
- **Windows paths:** native `C:\...` paths are accepted (backslash is allowed in `projectPath`); they reach filesystem APIs or discrete argv entries, never a shell.
- **macOS CLAP:** the CLAP template produces a `CFBundle` on Apple platforms; bundle packaging needs platform-specific verification beyond the Linux/Windows compile checks. See [Project status](project-status.md#known-limitations).

## Good-to-know quirks

- **Empty folders are rejected on purpose.** Every tool needs `<project>/apc-mcp.json` or `<project>/CMakeLists.txt` first, so a typo'd `projectPath` cannot write outside a real project. `audio_plugin_create` creates a minimal root `CMakeLists.txt` when only `apc-mcp.json` exists.
- **`_tools/` is looked up from the project root first.** Each template checks `${CMAKE_SOURCE_DIR}/_tools/…` before its legacy two-directories-up fallback, so a custom or deeper `pluginsDir` in `apc-mcp.json` no longer breaks SDK discovery. If you keep SDKs somewhere else entirely, pass `-DJUCE_DIR=…` / `-DLV2_INCLUDE_DIR=…` or `add_subdirectory()` them from your root `CMakeLists.txt`.
- **System plug-in folders are never modified.** JUCE templates set `COPY_PLUGIN_AFTER_BUILD FALSE`, so builds cannot silently overwrite `~/Library/Audio/Plug-Ins` or fail on CI permissions. Copy from `<build>/plugins/<Name>/<Name>_artefacts/<Config>/` when ready.
- **Two different LV2 paths.** `type="lv2"` scaffolds a zero-dependency **pure C11** plugin (`<Name>.so` inside `<Name>.lv2/`, matching `manifest.ttl` on every platform). `type="juce"` builds a **C++ JUCE** plugin through JUCE's LV2 wrapper. They are unrelated implementations, but they share one identity rule: for the same `vendor` and `name`, both use the sanitized `urn:<vendor>:<plugin>` URI, and the JUCE templates pass it as `LV2URI` explicitly rather than letting JUCE derive one from a `COMPANY_WEBSITE` the templates deliberately do not invent. Treat that URI as permanent — hosts store it with saved sessions.
- **`type="standalone"` ≠ `formats="Standalone"`.** The former scaffolds a standalone GUI audio *application* via `juce_add_gui_app` and rejects a `formats` argument. For a DAW plugin plus a standalone wrapper, use `type="juce"` with `formats="VST3;Standalone"`.
- **Validator coverage.** `pluginval` runs on VST3 and `clap-validator` on CLAP. LV2, AudioUnit and Standalone artefacts are discovered and reported **`NOT CHECKABLE`** — no validator exists for them, so nothing is attempted and the run is not marked as failed. A configured-but-missing validator (e.g. `clap-validator` not on `PATH`) is a different thing: that is a real `isError: true`. See [`audio_plugin_validate`](tools.md#audio_plugin_validate).
- **Single- vs multi-config CMake trees.** `audio_plugin_build` auto-configures `build/` on first run and regenerates single-config caches when the requested `config` differs from `CMAKE_BUILD_TYPE`; multi-config generators receive `--config` at build time.
- **Scaffolding is not installing.** `audio_plugin_create` reports success as soon as the files and root CMake registration exist. Building still needs the matching SDK; the generated `CMakeLists.txt` fails early with a readable message if it cannot find it.
