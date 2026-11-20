# Getting started

Go from an empty folder to a built plugin. Two things to know up front:

- apc-mcp **wraps your local toolchain**. It does not bundle or download CMake, compilers, or the JUCE / CLAP / LV2 SDKs. See [Toolchain & SDKs](toolchain.md).
- A project root must already exist before any tool will write to it (`apc-mcp.json` or a root `CMakeLists.txt`). This is deliberate containment, not a bug.

## 1. Add apc-mcp to your MCP client

The server runs over stdio and is spawned by your client. The command is always:

```sh
npx -y github:sgm-audio/apc-mcp
```

A standard `mcpServers` configuration (Claude Desktop, Cursor, Continue, and similar clients):

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

Clients differ in the *envelope*, not the command. VS Code uses a `servers` key in `.vscode/mcp.json` (with `"type": "stdio"`); OpenCode uses an `mcp` key with `"type": "local"` and a `command` array. Translate the same `npx` command into whichever shape your client expects.

### Install from GitHub until 2.0.0 is tagged

`package.json` is at `2.0.0`, but the newest git tag is `v1.5.0` and the npm package is not published yet. Older `1.4.0` / `1.5.0` predate the security fixes and template rewrites, so **do not use them on untrusted input** — see [Security](security.md). Use `github:sgm-audio/apc-mcp` until `v2.0.0` is tagged and `@sgm-audio/apc-mcp` appears on npm.

Useful checks:

```sh
npx -y github:sgm-audio/apc-mcp --version   # should print 2.0.0
npx -y github:sgm-audio/apc-mcp --help
```

`npx` caches what it installs. If `--version` is stale, clear `~/.npm/_npx` (macOS/Linux) or `%LocalAppData%\npm-cache\_npx` (Windows) and restart your MCP client.

`github:sgm-audio/apc-mcp` resolves `main` **at install time** and installs the runtime dependencies by semver range rather than by this repository's lockfile — you get whatever the branch and the registry hold that day. To pin what you run, name a commit or tag:

```sh
npx -y github:sgm-audio/apc-mcp#v2.0.0 --version
```

Once `@sgm-audio/apc-mcp` is published, prefer `npx -y @sgm-audio/apc-mcp@2.0.0`: registry installs are immutable and carry a provenance attestation from the release workflow.

## 2. Install the prerequisites

Minimum for any build:

| Need | Why |
|---|---|
| [Node.js 22+](https://nodejs.org/) | Runs the MCP server (Node 18 and 20 are EOL) |
| [CMake 3.22+](https://cmake.org/download/) | `cmake` + `ctest`; optional [Ninja](https://ninja-build.org/) for faster builds |
| C11 / C++20 compiler | Xcode Command Line Tools, Visual Studio Build Tools, or GCC / Clang |

Then the SDK for the scaffold you build, and optionally `clang-format`, `pluginval` and `clap-validator` for lint/validate. ARA projects additionally require an external ARA SDK (not bundled with JUCE or apc-mcp); see [Toolchain & SDKs](toolchain.md#sdk-discovery).

## 3. Bootstrap a project folder

The scaffold templates look for vendored SDKs in `<project>/_tools/`, two directories up from each plugin's `CMakeLists.txt`:

```sh
mkdir my-plugins && cd my-plugins
echo '{}' > apc-mcp.json                 # root marker (or write a root CMakeLists.txt yourself)

# Vendor the SDK(s) for the formats you intend to use — pick one or more:
git clone --depth 1 https://github.com/free-audio/clap.git _tools/clap
# git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git _tools/JUCE
# git clone --depth 1 https://github.com/lv2/lv2.git _tools/lv2
```

Installed SDKs work too: CLAP via `clap-config.cmake` on `CMAKE_PREFIX_PATH`, JUCE via `-DJUCE_DIR=...`, LV2 via `-DLV2_INCLUDE_DIR=...` or system headers. See [SDK discovery](toolchain.md#sdk-discovery).

## 4. Scaffold, build, validate

Ask your agent, or call the tools directly:

```text
audio_plugin_create(projectPath="/path/to/my-plugins", name="MyGain", type="clap", vendor="Acme")
audio_plugin_build(projectPath="/path/to/my-plugins", config="Release")
audio_plugin_validate(projectPath="/path/to/my-plugins", format="CLAP")
```

`audio_plugin_create` writes `plugins/MyGain/` and registers `add_subdirectory(plugins/MyGain)` in the root `CMakeLists.txt` (creating a minimal one if you started from `apc-mcp.json` alone). `audio_plugin_build` auto-configures `build/` on first use.

For an ARA effect, clone the external SDK with its submodules initialized (JUCE 9 documents ARA SDK 2.1.0) and provide its root path explicitly before building. The root must contain `ARA_Library/PlugIn/ARAPlug.h` and `ARA_API/ARAInterface.h`; `audio_plugin_create` intentionally defers CMake configuration for this type:

```sh
git clone --depth 1 --recurse-submodules --branch releases/2.1.0 \\
  https://github.com/Celemony/ARA_SDK.git /absolute/path/to/ARA_SDK
```

```text
audio_plugin_create(projectPath="/path/to/my-plugins", name="MyAraEffect", type="ara")
audio_plugin_configure(projectPath="/path/to/my-plugins", options="-DAPC_ARA_SDK_PATH=/absolute/path/to/ARA_SDK")
audio_plugin_build(projectPath="/path/to/my-plugins", config="Release")
```

ARA is enabled with `IS_ARA_EFFECT TRUE` and actual JUCE formats `VST3 AU`. The generated CMake fails with `FATAL_ERROR` if `APC_ARA_SDK_PATH` is unset, empty, or does not point to a complete SDK root.

Artefacts land under `build/plugins/<Name>/<Name>_artefacts/<Config>/`:

| `type` | Artefact |
|---|---|
| `clap` | `CLAP/MyGain.clap` |
| `juce` / `vst3` | `VST3/…vst3`, `LV2/…lv2`, `Standalone/…` (depending on `formats`) |
| `ara` | `VST3/…vst3` and, on macOS, `AU/…component` |
| `lv2` | `LV2/MyGain.lv2/MyGain.so` plus Turtle metadata |
| `standalone` | `Standalone/MyGain` (an executable, not a plugin) |

Builds never copy into your system plug-in folders (`COPY_PLUGIN_AFTER_BUILD FALSE`); copy or symlink the artefact into your DAW's scan path when you are ready.

`audio_plugin_validate` needs `clap-validator` for CLAP and `pluginval` for VST3. LV2, AudioUnit and Standalone artefacts are found but reported as **`NOT CHECKABLE`**: no validator exists for them, so they are not silently counted as passing, and they do not fail the run. See [Tool reference](tools.md#audio_plugin_validate).

## Where to go next

- [All seven tools and their arguments](tools.md)
- [`apc-mcp.json` settings and project layout](configuration.md)
- [Gotchas: empty folders, `_tools` depth, two LV2 paths, Linux dependencies](toolchain.md#good-to-know-quirks)
- [Something went wrong?](troubleshooting.md)
