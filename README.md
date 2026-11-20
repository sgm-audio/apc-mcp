<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="apc-mcp" src="assets/logo.svg" width="440">
  </picture>
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22+-339933?logo=node.js&logoColor=white" alt="Node 22+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sgm-audio/apc-mcp" alt="MIT License"></a>
</p>

# apc-mcp

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server for commercial audio plugin development. It equips an AI coding agent with **10 MCP tools** and **4 native `/` slash commands** (`prompts/list` & `prompts/get`) to **scaffold, design, synchronize parameters, configure, build, test, lint, validate, package, and locally install** CMake audio plugins for **JUCE + JIVE**, standard **JUCE**, **JUCE ARA effects**, **CLAP**, **VST3**, **LV2**, and **standalone** applications.

> **It wraps your toolchain — it does not ship one.** apc-mcp calls the CMake, C/C++ compiler, `ctest`, `clang-format`, `pluginval` and `clap-validator` binaries on your `PATH`, and caches or resolves JUCE and JIVE deterministically via `_tools/` or `~/.apc-mcp/deps/`. [What you need →](docs/toolchain.md)

---

## Quickstart (60 Seconds to DAW)

### 1. Add `apc-mcp` to your MCP client

```json
{
  "mcpServers": {
    "apc-mcp": {
      "command": "npx",
      "args": ["-y", "github:sgm-audio/apc-mcp"]
    }
  }
}
```

Check the running version with `npx -y github:sgm-audio/apc-mcp --version`. [Client config variants →](docs/getting-started.md)

### 2. Initialize a project directory

```sh
mkdir my-plugins && cd my-plugins
echo '{}' > apc-mcp.json
```

### 3. Run the `/apc:new` → `/apc:ui` → `/apc:ship` slash-command workflow

MCP clients automatically expose `apc-mcp`'s registered MCP Prompts as native `/` slash commands:

| Slash Command | Arguments | What It Executes |
|---|---|---|
| `/apc:doctor` | *(none)* | Runs `apc-doctor`, initializes `~/.apc-mcp/deps/`, and outputs a toolchain & SDK readiness matrix. |
| `/apc:new` | `name` *(required)*, `style` *(optional: `fx` \| `synth` \| `utility`)* | Runs `apc-doctor` if the cache is cold, then `apc` scaffolds a JUCE + JIVE plugin (`type="juce"`, `ui="jive"`), and summarizes APVTS parameters and live hot-reload paths. |
| `/apc:ui` | `design` *(required)* | Reads `Source/UI/MainView.xml`, `Source/UI/Styles.json`, and `Source/PluginProcessor.cpp`, adds new parameters atomically via `apc-add-param`, updates JIVE Flexbox/Grid layout & styles using `Source/UI/Presets/` primitives, and runs a `Debug` compile check. |
| `/apc:ship` | `version` *(optional, default `"0.1.0"`)* | Runs `apc-ship(installLocal=true)` (`Release Build → Lint → pluginval Strictness 5 → dist/ Package → Local VST3 Install`), self-healing up to 3 times on any compiler/validator error. |

```text
/apc:new name="TapeEcho" style="fx"
/apc:ui design="Add a warm saturation drive knob (0 to 24 dB), feedback slider (0 to 95 %), and bypass toggle"
/apc:ship version="1.0.0"
```

---

## Creating and Shipping a JUCE + JIVE Plugin

`apc` defaults to `type="juce"` and `ui="jive"` when omitted, generating a deterministic CMake 3.22+ project powered by [JUCE 9.0.3](https://github.com/juce-framework/JUCE) and [JIVE v2.0.1](https://github.com/ImJimmi/JIVE) (declarative XML layouts + JSON stylesheets).

### 1. Architecture & Hot-Reload (`Debug` vs. `Release`)

- **Debug Hot-Reload (`#if JUCE_DEBUG`):** `PluginEditor` configures `jive::SourceRoot` pointing to `Source/UI` on disk (`APC_JIVE_UI_DIR`). Editing `Source/UI/MainView.xml` or `Source/UI/Styles.json` updates the open plugin window live in your DAW or standalone host without recompiling C++.
- **Release Embedded Assets (`CMAKE_BUILD_TYPE=Release`):** `Source/UI/MainView.xml` and `Source/UI/Styles.json` are compiled directly into the binary via `juce_add_binary_data(<PluginName>_JiveData NAMESPACE <PluginId>_JiveData)`. The shipped `.vst3` / `.component` / `.lv2` bundle has zero external file dependencies and can be moved to any machine.
- **Compile-Time Toggle (`-DAPC_USE_JIVE=ON|OFF`):** Generated JIVE projects expose `option(APC_USE_JIVE "Enable JIVE declarative XML/JSON UI" ON)`. Passing `-DAPC_USE_JIVE=OFF` skips fetching/linking `jive::jive_layouts` and `jive::jive_style_sheets` without polluting global include paths and falls back to `juce::GenericAudioProcessorEditor`.
- **Warnings-as-Errors & Portability:** All generated plugin sources compile with `-Wall -Wextra -Werror` (GCC/Clang) or `/W4 /WX` (MSVC). Release Windows builds statically link the MSVC runtime (`/MT` via `MultiThreaded$<$<CONFIG:Debug>:Debug>`), and macOS builds support universal binaries (`CMAKE_OSX_ARCHITECTURES="arm64;x86_64"` or `-DAPC_MACOS_UNIVERSAL=ON`).

### 2. Deterministic Dependency Caching (`_tools/` vs. `~/.apc-mcp/deps/`)

Generated `CMakeLists.txt` files never fetch unpinned `main`/`master` branches. Dependencies resolve in strict priority order:

1. **Explicit CMake / environment override:** `-DJUCE_DIR=/path/to/JUCE` / `$ENV{JUCE_DIR}` and `-DJIVE_DIR=/path/to/JIVE` / `$ENV{JIVE_DIR}`.
2. **Project-local `_tools/` override:** `${CMAKE_SOURCE_DIR}/_tools/JUCE`, `_tools/JIVE`, `_tools/clap`, and `_tools/lv2`.
3. **Global user cache (`~/.apc-mcp/deps/`):** `~/.apc-mcp/deps/JUCE`, `~/.apc-mcp/deps/JIVE`, `~/.apc-mcp/deps/clap`, and `~/.apc-mcp/deps/lv2` (`APC_DEPS_CACHE_DIR`).
4. **Pinned CMake `FetchContent` fallback (populated into `~/.apc-mcp/deps/` on first run):**
   - **JUCE `9.0.3`:** commit SHA `be29c81492b6151c8ea8d14c840e1311963b3a83`
   - **JIVE `v2.0.1`:** commit SHA `693788a539eb42b9c15848706f9ceae43ee60084`
   - Supports offline air-gapped builds via `-DFETCHCONTENT_FULLY_DISCONNECTED=ON` once `~/.apc-mcp/deps/` or `_tools/` is populated.

---

## Manual Tool Reference

See the full [Tool reference](docs/tools.md) for the 10 canonical tools (`apc`, `apc-add-param`, `apc-ship`, `apc-doctor`, `apc-cfg`, `apc-build`, `apc-test`, `apc-lint`, `apc-val`, `apc-list`). The former `audio_plugin_*` names remain available as deprecated compatibility aliases.

### `apc`

Scaffolds a new plugin or application into `<pluginsDir>/<name>`, registers `add_subdirectory(...)` in the root `CMakeLists.txt`, and initializes `~/.apc-mcp/deps/`. JUCE projects are auto-configured when their SDKs are available; ARA projects defer configuration until you supply the required external SDK path.

| Parameter | Type / Default | Description |
|---|---|---|
| `projectPath` | `string` *(optional)* | Project root containing `apc-mcp.json` or `CMakeLists.txt` (auto-detected from CWD). |
| `name` | `string` *(required)* | Plugin name (`[a-zA-Z][a-zA-Z0-9_-]*`, e.g. `"TapeEcho"`, `"Phaser9000"`). |
| `type` | `'juce'` *(default)* \| `'vst3'` \| `'clap'` \| `'lv2'` \| `'standalone'` \| `'ara'` | Target scaffold. Defaults to `'juce'` (`VST3;LV2;Standalone`). `'ara'` creates a JUCE ARA effect with fixed VST3/AU formats; it requires an external ARA SDK at configure time. |
| `ui` | `'jive'` *(default)* \| `'generic'` \| `'juce'` \| `'webview'` | UI framework for `juce`/`vst3` plugins. Defaults to `'jive'`. Use `'generic'` (or `'juce'`) for `GenericAudioProcessorEditor`; ARA uses its dedicated ARA-aware editor and ignores this option. |
| `style` | `'fx'` *(default)* \| `'synth'` \| `'utility'` | Seeds initial DSP & JIVE controls: `'fx'` (stereo effect with `gain`), `'synth'` (`IS_SYNTH TRUE`, `NEEDS_MIDI_INPUT TRUE`, `gain` + `cutoff` knob), or `'utility'` (`gain` + `bypass` toggle). ARA is always generated as an effect and ignores this option. |
| `vendor` | `'apc-mcp'` *(default)* | Vendor/company name embedded in plugin metadata (up to 128 chars, non-ASCII supported). |
| `description` | `'An audio plugin'` *(default)* | Short plugin description (up to 512 chars, non-ASCII supported). |
| `formats` | `'VST3;LV2;Standalone'` *(optional)* | Semicolon-separated JUCE format override for `juce`/`vst3` (`AU`, `AUv3`, `AAX`, `LV2`, `Standalone`, `Unity`, `VST`, `VST3`). Rejected for `ara`, which uses fixed VST3 and AU formats; ARA is not a format. |

For `type="ara"`, obtain the external ARA SDK with its submodules initialized, then configure it before building. JUCE 9 documents ARA SDK 2.1.0:

```sh
git clone --depth 1 --recurse-submodules --branch releases/2.1.0 \\
  https://github.com/Celemony/ARA_SDK.git /absolute/path/to/ARA_SDK
```

```text
apc-cfg(projectPath="/path/to/my-plugins", options="-DAPC_ARA_SDK_PATH=/absolute/path/to/ARA_SDK")
```

The path must be the SDK root containing `ARA_Library/PlugIn/ARAPlug.h` and `ARA_API/ARAInterface.h`. Generated CMake fails early with `FATAL_ERROR` for an unset, empty, or incomplete SDK, then calls `juce_set_ara_sdk_path(...)` before `juce_add_plugin(...)`. ARA uses `FORMATS VST3 AU` with `IS_ARA_EFFECT TRUE`; do not pass `formats="ARA"`.

**Return payload:** Markdown summary containing the created plugin directory, template and style preset used, root `CMakeLists.txt` registration status, `~/.apc-mcp/deps/` cache initialization status, and the scaffolded file tree.

### `apc-add-param`

Atomically synchronizes a new automatable parameter across C++ APVTS, JIVE XML layout, and JSON stylesheet.

| Parameter | Type / Default | Description |
|---|---|---|
| `projectPath` | `string` *(optional)* | Project root (auto-detected from CWD). |
| `pluginName` | `string` *(optional)* | Target plugin name under `plugins/` (auto-selected when the project has a single JIVE plugin). |
| `id` | `string` *(required)* | Unique APVTS parameter ID and JIVE component ID (`[a-zA-Z][a-zA-Z0-9_]*`, e.g. `"cutoff"`, `"mix"`, `"bypass"`). |
| `name` | `string` *(required)* | Display name (e.g. `"Filter Cutoff"`). |
| `min` | `number` *(default `0`)* | Minimum value (must be `< max` for `"knob"` and `"slider"`). |
| `max` | `number` *(default `1`)* | Maximum value. |
| `default` | `number` *(default `0.5`)* | Initial default value (`min <= default <= max`). |
| `unit` | `string` *(default `""`)* | Optional unit label (e.g. `"Hz"`, `"dB"`, `"%"`, `"ms"`). |
| `controlType` | `'knob'` *(default)* \| `'slider'` \| `'toggle'` | JIVE element to inject: `'knob'` (`<Knob>`), `'slider'` (`<Slider>`), or `'toggle'` (`<Checkbox>` with `AudioParameterBool`). |

**Return payload:** Confirmation listing the updated `Source/PluginProcessor.cpp` (`createParameterLayout`), `Source/UI/MainView.xml` binding, `Source/UI/Styles.json` (`#<id>`) rule, and XML well-formedness / JSON validity verification.

### `apc-ship`

Executes the end-to-end commercial shipping pipeline in a single call: **Stage 1 (`Release` Configure & Build) → Stage 2 (`clang-format` Source Lint) → Stage 3 (`pluginval --strictness-level 5 --validate-in-process`) → Stage 4 (`dist/<Name>-<Version>-<OS>/` Packaging + `INSTALL.txt` + macOS ad-hoc `codesign --force --deep -s -`) → Stage 5 (Local OS VST3 Install)**.

| Parameter | Type / Default | Description |
|---|---|---|
| `projectPath` | `string` *(optional)* | Project root (auto-detected from CWD). |
| `version` | `'1.0.0'` *(default)* | Semantic version string for `dist/<Name>-<Version>-<OS>/`. |
| `installLocal` | `true` *(default)* | Copies the validated `.vst3` bundle into the OS user VST3 folder (`~/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\VST3`, or `~/.vst3`). |

**Return payload:** Stage-by-stage pass summary with exact `dist/` package paths and local VST3 install paths, or structured compiler/linter/validator diagnostic lines (`isError: true`) when any gate fails so the calling agent can self-heal immediately.

### `apc-doctor`

Inspects the local build environment and initializes the global dependency cache.

| Parameter | Type / Default | Description |
|---|---|---|
| `projectPath` | `string` *(optional)* | Optional project root to check for project-local `_tools/JUCE` and `_tools/JIVE`. |

**Return payload:** Status report for `cmake`, the C++20 compiler (`c++` / `clang++` / `g++` / `cl`), `~/.apc-mcp/deps/` initialization, `JUCE` SDK path, `JIVE` framework path, `pluginval` availability, OS VST3 directory, and actionable installation commands for any missing tool.

---

## Distribution, OS Install Paths & Limitations

### Packaging Output (`dist/`)

Running `apc-ship` or `cmake --build build --config Release --target package` produces a self-contained distribution folder:

```text
dist/<PluginName>-<Version>-<macOS|Windows|Linux>/
  <PluginName>.vst3
  <PluginName>.component   # macOS when AU is enabled in FORMATS
  INSTALL.txt
```

### Standard End-User Plugin Paths

| OS | Format | Destination |
|---|---|---|
| macOS | VST3 | `~/Library/Audio/Plug-Ins/VST3/` (or `/Library/Audio/Plug-Ins/VST3/`) |
| macOS | AU | `~/Library/Audio/Plug-Ins/Components/` |
| Windows | VST3 | `C:\Program Files\Common Files\VST3\` (`%COMMONPROGRAMFILES%\VST3`) |
| Linux | VST3 | `~/.vst3/` |
| Linux | LV2 | `~/.lv2/` |

### Known Limitations

- **macOS Ad-Hoc Signing vs. Public Notarization:** `apc-ship` and the CMake `package` target run `codesign --force --deep --sign -` on macOS bundles so they load locally without Gatekeeper quarantine failures. Public commercial distribution on macOS requires an Apple **Developer ID Application** certificate, hardened runtime signing, and `notarytool` notarization; Windows public installers should be signed with an **Authenticode** certificate.
- **ARA SDK requirement:** `type="ara"` generates a JUCE ARA effect scaffold, but the ARA SDK is external and is not bundled. Configure with `-DAPC_ARA_SDK_PATH=/absolute/path/to/ARA_SDK` before building; the path must point to a complete SDK root with initialized `ARA_Library` and `ARA_API` headers. ARA is an effect mode (`IS_ARA_EFFECT TRUE`) layered on VST3/AU, never a `FORMATS` value.
- **Headless Linux Display:** `pluginval` instantiates the plugin GUI editor and requires an X11 display on Linux (wrap headless CI runs in `xvfb-run -a`). Generated JUCE `CMakeLists.txt` files automatically define `JUCE_ALSA=0` when `libasound2-dev` is absent on headless Linux containers.

---

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](docs/getting-started.md) | Client setup, first plugin, artefacts |
| [Tool reference](docs/tools.md) | All 10 canonical tools, deprecated aliases, native slash commands, arguments, scaffold types |
| [Configuration](docs/configuration.md) | `apc-mcp.json`, project layout, precedence |
| [Toolchain & SDKs](docs/toolchain.md) | Prerequisites, SDK discovery, platform notes, quirks |
| [Troubleshooting](docs/troubleshooting.md) | FAQ and common errors |
| [Security](docs/security.md) | Threat model, defence layers, the 1.4.0 / 1.5.0 upgrade notice |
| [Development](docs/development.md) | Tests, contributing, release process |
| [Project status](docs/project-status.md) · [Roadmap](docs/roadmap.md) | Verification baseline, what is done, what is left |
| [Changelog](CHANGELOG.md) · [Docs index](docs/README.md) | Release history and the full documentation map |

Version `2.0.0` is current; avoid `1.4.0` / `1.5.0` on untrusted input. See [SECURITY.md](SECURITY.md).

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
