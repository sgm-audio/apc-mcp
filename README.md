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

## Creating and Shipping a JUCE + JIVE Plugin

`audio_plugin_create` supports [JIVE](https://github.com/ImJimmi/JIVE) (declarative XML layouts + JSON stylesheets for JUCE) as a first-class UI option on `type="juce"` and `type="vst3"`.

### 1. Prerequisites & SDK paths

- **CMake 3.22+** (with Ninja or your platform generator) and a **C++20 compiler** (GCC 12+, Clang, MSVC 2022+, or Xcode).
- **JUCE 9.0.3** (`be29c81492b6151c8ea8d14c840e1311963b3a83`) and **JIVE v2.0.1** (`693788a539eb42b9c15848706f9ceae43ee60084`):
  - **Automatic:** CMake `FetchContent` fetches these exact pinned commit SHAs automatically if no local checkout is present.
  - **Local / offline override:** vendor into `_tools/JUCE` and `_tools/JIVE`, or pass `-DJUCE_DIR=/path/to/JUCE -DJIVE_DIR=/path/to/JIVE` (or `JUCE_DIR` / `JIVE_DIR` environment variables) alongside `-DFETCHCONTENT_FULLY_DISCONNECTED=ON`.

```sh
mkdir my-jive-plugin && cd my-jive-plugin
echo '{}' > apc-mcp.json

# Optional local vendoring (pinned SHAs):
git clone https://github.com/juce-framework/JUCE.git _tools/JUCE && git -C _tools/JUCE checkout be29c81492b6151c8ea8d14c840e1311963b3a83
git clone https://github.com/ImJimmi/JIVE.git _tools/JIVE && git -C _tools/JIVE checkout 693788a539eb42b9c15848706f9ceae43ee60084
```

### 2. Scaffold with `audio_plugin_create`

```text
audio_plugin_create(
  projectPath="/path/to/my-jive-plugin",
  name="MyGain",
  type="juce",
  ui="jive",
  vendor="Acme Audio",
  description="Declarative JIVE gain plugin",
  formats="VST3;AU"
)
```

- Omit `ui` (or pass `ui="generic"`) for standard `juce::GenericAudioProcessorEditor` with `-DAPC_USE_JIVE=OFF`.
- Generated C++20 sources compile under `-Wall -Wextra -Werror` (GCC/Clang) and `/W4 /WX` (MSVC), with `/MT` static MSVC runtime on Release Windows builds and `CMAKE_OSX_ARCHITECTURES="arm64;x86_64"` (or `-DAPC_MACOS_UNIVERSAL=ON`) support on macOS.
- Pass `-DAPC_USE_JIVE=OFF` at configure time on a `ui="jive"` project to skip fetching/linking JIVE and fall back to `juce::GenericAudioProcessorEditor`.

### 3. Debug hot-reload vs. Release embedded assets

- **Debug (`JUCE_DEBUG=1`):** `jive::SourceRoot` points to `Source/UI` on disk, so editing `Source/UI/MainView.xml` or `Source/UI/Styles.json` updates the open plugin window live without recompiling.
- **Release (`CMAKE_BUILD_TYPE=Release`):** `MainView.xml` and `Styles.json` are embedded via `juce_add_binary_data`, so the shipped `.vst3` / `.component` / `.lv2` bundle has zero external file dependencies.

### 4. Build, package (`dist/`), and validate

```sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --target package --parallel
```

The `package` target writes self-contained bundles and `INSTALL.txt` into `build/dist/<PluginName>-1.0.0-<OS>/` (and runs `codesign --force --deep -s -` on macOS):

```text
build/dist/MyGain-1.0.0-<OS>/
  MyGain.vst3
  MyGain.component   # macOS when AU is in formats
  INSTALL.txt
```

Validate with `pluginval` (wrap in `xvfb-run -a` on headless Linux):

```sh
pluginval --strictness-level 5 --validate-in-process --validate build/dist/MyGain-1.0.0-<OS>/MyGain.vst3
```

### 5. End-user installation paths

| OS | Format | Destination |
|---|---|---|
| macOS | VST3 | `~/Library/Audio/Plug-Ins/VST3/` (or `/Library/Audio/Plug-Ins/VST3/`) |
| macOS | AU | `~/Library/Audio/Plug-Ins/Components/` |
| Windows | VST3 | `C:\Program Files\Common Files\VST3\` |
| Linux | VST3 | `~/.vst3/` |
| Linux | LV2 | `~/.lv2/` |

### 6. Current limitations

- **ARA2:** Not offered yet (removed in 2.0.0; requires a dedicated `IS_ARA_EFFECT` template).
- **Public distribution signing:** Packaging applies ad-hoc codesigning (`codesign --force --deep -s -`) on macOS for local loading. Commercial distribution requires Developer ID signing + Apple notarization on macOS and Authenticode signing on Windows.
- **Headless Linux:** `pluginval` is a GUI application and requires a display (`xvfb-run -a`). JUCE builds automatically set `JUCE_ALSA=0` when `libasound2-dev` is absent.

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
