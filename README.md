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

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI coding agent seven tools for audio-plugin work: **configure, build, test, lint, validate, list and scaffold** CMake projects for JUCE, CLAP, VST3, LV2 and standalone apps. It speaks stdio, so any MCP client can use it.

> **It wraps your toolchain — it does not ship one.** apc-mcp calls the CMake, C/C++ compiler, `ctest`, `clang-format`, `pluginval` and `clap-validator` binaries already on your `PATH`, and expects *you* to supply the plugin SDKs (JUCE, CLAP, LV2). It never bundles, downloads or auto-installs compilers, CMake or SDKs. [What you need →](docs/toolchain.md)

## Quick Start

### 1. Add the server to your MCP client

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

Install from GitHub until `2.0.0` is tagged and published to npm. Check the running version with `npx -y github:sgm-audio/apc-mcp --version`. [Client config variants →](docs/getting-started.md)

### 2. Have the toolchain and an SDK ready

You need **Node.js 22+**, **CMake 3.22+** (includes `ctest`), a **C11/C++20 compiler**, and the SDK for the format you want to scaffold. `clang-format`, `pluginval` and `clap-validator` are only needed for lint and validate. [Prerequisites and SDK table →](docs/toolchain.md)

### 3. Create a project and build

```sh
mkdir my-plugins && cd my-plugins
echo '{}' > apc-mcp.json                              # marks the project root
git clone --depth 1 https://github.com/free-audio/clap.git _tools/clap
```

Then ask your agent — or call the tools directly:

```text
audio_plugin_create(projectPath="/path/to/my-plugins", name="MyGain", type="clap", vendor="Acme")
audio_plugin_build(projectPath="/path/to/my-plugins", config="Release")
audio_plugin_validate(projectPath="/path/to/my-plugins", format="CLAP")
```

Your binary lands at `build/plugins/MyGain/MyGain_artefacts/Release/CLAP/MyGain.clap`.

The [getting started guide](docs/getting-started.md) covers the other formats, artefact paths and the few gotchas.

## Using JIVE with apc-mcp

`audio_plugin_create` supports [JIVE](https://github.com/ImJimmi/JIVE) (declarative XML layouts + JSON stylesheets for JUCE) as a first-class UI option on `type="juce"` and `type="vst3"`.

### 1. Scaffold a JUCE + JIVE plugin

```sh
mkdir my-jive-plugin && cd my-jive-plugin
echo '{}' > apc-mcp.json

# Optional: vendor pinned checkouts locally (otherwise CMake FetchContent
# fetches these exact commit SHAs automatically unless FETCHCONTENT_FULLY_DISCONNECTED=ON)
git clone https://github.com/juce-framework/JUCE.git _tools/JUCE && git -C _tools/JUCE checkout be29c81492b6151c8ea8d14c840e1311963b3a83
git clone https://github.com/ImJimmi/JIVE.git _tools/JIVE && git -C _tools/JIVE checkout 693788a539eb42b9c15848706f9ceae43ee60084
```

Then scaffold with `ui="jive"`:

```text
audio_plugin_create(projectPath="/path/to/my-jive-plugin", name="MyGain", type="juce", ui="jive", vendor="Acme")
```

This generates:

- `plugins/MyGain/CMakeLists.txt` — pure CMake 3.22+, `-DAPC_USE_JIVE=ON|OFF` toggle, warnings-as-errors (`-Wall -Wextra -Werror` / `/W4 /WX`) on plugin sources, static MSVC runtime (`/MT`) on Windows, macOS universal binary support (`-DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"` or `-DAPC_MACOS_UNIVERSAL=ON`), and a `MyGain_package` target staging bundles into `build/dist/<Config>/`.
- `plugins/MyGain/Source/PluginProcessor.{h,cpp}` — JUCE `AudioProcessor` with `AudioProcessorValueTreeState` (`gain` parameter), smoothed gain DSP, and ValueTree state persistence.
- `plugins/MyGain/Source/PluginEditor.{h,cpp}` — instantiates `jive::Interpreter` with `autoAttachParameters(apvts)`.
- `plugins/MyGain/Source/UI/MainView.xml` and `Styles.json` — declarative XML layout and external JSON stylesheet.

### 2. Debug hot-reload vs. Release BinaryData

- **Debug builds (`JUCE_DEBUG=1`):** `jive::SourceRoot` points to `Source/UI` on disk, so editing `MainView.xml` or `Styles.json` hot-reloads the live editor window without recompiling.
- **Release builds:** `MainView.xml` and `Styles.json` are embedded via `juce_add_binary_data`, so the shipped `.vst3` / `.component` / `.lv2` bundle has zero external file dependencies.
- **Disabling JIVE:** pass `-DAPC_USE_JIVE=OFF` at configure time to skip fetching/linking JIVE completely and fall back to `juce::GenericAudioProcessorEditor`.

### 3. Build, package, and validate

```sh
# Debug (hot-reload enabled) and Release (embedded BinaryData)
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --parallel

# Clean packaged bundles are staged automatically in:
#   build/dist/Release/MyGain.vst3
#   build/dist/Release/MyGain.lv2
#   build/dist/Release/MyGain.component   (macOS when AU is in formats)

# Validate VST3 (wrap in `xvfb-run -a` on headless Linux)
pluginval --strictness-level 5 --validate-in-process --validate build/dist/Release/MyGain.vst3
```

**Limitations:** `pluginval` is required for VST3 validation and needs a display (`xvfb-run -a` on headless Linux). On offline machines set `-DFETCHCONTENT_FULLY_DISCONNECTED=ON` alongside vendored `_tools/JUCE` + `_tools/JIVE` or `-DJUCE_DIR=... -DJIVE_DIR=...`.

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](docs/getting-started.md) | Client setup, first plugin, artefacts |
| [Tool reference](docs/tools.md) | All seven tools, arguments, scaffold types |
| [Configuration](docs/configuration.md) | `apc-mcp.json`, project layout, precedence |
| [Toolchain & SDKs](docs/toolchain.md) | Prerequisites, SDK discovery, platform notes, quirks |
| [Troubleshooting](docs/troubleshooting.md) | FAQ and common errors |
| [Security](docs/security.md) | Threat model, defence layers, the 1.4.0 / 1.5.0 upgrade notice |
| [Development](docs/development.md) | Tests, contributing, release process |
| [Project status](docs/project-status.md) · [Roadmap](docs/roadmap.md) | Verification baseline, what is done, what is left |
| [Changelog](CHANGELOG.md) · [Docs index](docs/README.md) | Release history and the full documentation map |

Version `2.0.0` is current but not yet tagged or published; avoid `1.4.0` / `1.5.0` on untrusted input. See [SECURITY.md](SECURITY.md).

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
