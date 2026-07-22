<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sgm-audio/apc-mcp/main/assets/logo-dark.svg">
    <img alt="apc-mcp" src="https://raw.githubusercontent.com/sgm-audio/apc-mcp/main/assets/logo.svg" width="520">
  </picture>
</p>

<p align="center">
  <a href="#quick-start"><b>Quick Start</b></a> •
  <a href="#tools"><b>Tools</b></a> •
  <a href="#configuration"><b>Configuration</b></a> •
  <a href="#development"><b>Development</b></a>
</p>

<p align="center">
  <a href="https://github.com/sgm-audio/apc-mcp/actions"><img src="https://img.shields.io/github/actions/workflow/status/sgm-audio/apc-mcp/publish.yml?branch=main&logo=github&label=CI" alt="CI"></a>
  <a href="https://github.com/sgm-audio/apc-mcp/releases"><img src="https://img.shields.io/github/v/release/sgm-audio/apc-mcp?logo=github&label=Release" alt="Release"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-18+-339933?logo=node.js&logoColor=white" alt="Node"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sgm-audio/apc-mcp" alt="License"></a>
</p>

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server for audio plugin development. It wraps the tools you already use — **CMake**, **ctest**, **clang-format**, **pluginval**, **clap-validator** — into a clean MCP tool interface for building, testing, linting, validating, and scaffolding plugin projects across JUCE, CLAP, VST3, and ARA formats.

Works with any MCP client: Claude Code, OpenCode, VS Code with MCP, Continue.dev, and more.

---

## Quick Start

Add one entry to your MCP config — no npm, no clone, no setup:

```json
{
  "mcp": {
    "apc-mcp": {
      "type": "local",
      "command": ["npx", "-y", "github:sgm-audio/apc-mcp"],
      "enabled": true
    }
  }
}
```

That's it. `npx` handles fetching and caching. Updates automatically when you restart your client.

### Requirements

- **Node.js 18+**
- **CMake 3.22+** — required for build/configure tools
- **clang-format** — required for lint tool
- **pluginval** — required for VST3 validation
- **clap-validator** — required for CLAP validation
- A JUCE/CLAP/VST3 audio plugin project with a `plugins/` directory

---

## Tools

| Tool | Description |
|------|-------------|
| [`audio_plugin_build`](#build) | CMake configure + build with parsed error/warning counts |
| [`audio_plugin_configure`](#configure) | CMake configure with custom generator and flags |
| [`audio_plugin_test`](#test) | ctest runner with pass/fail/total summary |
| [`audio_plugin_lint`](#lint) | clang-format check (dry-run) or auto-fix on C++ sources |
| [`audio_plugin_plugins`](#list-plugins) | Discover plugins with metadata — text or JSON output |
| [`audio_plugin_validate`](#validate) | Run pluginval (VST3) or clap-validator on built binaries |
| [`audio_plugin_create`](#scaffold) | Scaffold a new CLAP or JUCE plugin from production templates |

### Build

```
audio_plugin_build()
audio_plugin_build(config="Release", clean=true)
audio_plugin_build(projectPath="/path/to/project", target="MyPlugin_Standalone")
```

Returns structured output with error count, warning count, and the first 20 of each.

### Configure

```
audio_plugin_configure(generator="Ninja")
audio_plugin_configure(options="-DAPC_ENABLE_VISAGE=ON")
```

### Test

```
audio_plugin_test()
audio_plugin_test(config="Release", testName="MyPluginTest")
```

Returns pass/failed/total summary.

### Lint

```
audio_plugin_lint()
audio_plugin_lint(fix=true)
audio_plugin_lint(target="plugins/Foo/Source")
```

Dry-run by default. Pass `fix=true` to format in place.

### List plugins

```
audio_plugin_plugins(format="json")
```

Omitting `format` returns human-readable text. Use `format="json"` for programmatic consumption.

### Validate

```
audio_plugin_validate()
audio_plugin_validate(format="VST3")
audio_plugin_validate(format="CLAP")
```

Scans the build directory for plugin binaries and runs the appropriate validator on each.

### Scaffold

```
audio_plugin_create(name="Phaser9000", type="clap")
audio_plugin_create(name="MyVerb", type="juce", vendor="MyCompany", formats="VST3;AU")
audio_plugin_create(name="SimpleDelay", type="clap", vendor="MyCompany", description="A simple delay effect")
```

Generates a working plugin stub with CMakeLists.txt, source files, and proper CLAP entry point or JUCE AudioProcessor structure.

---

## Configuration

### Per-project config

Drop an `apc-mcp.json` in your project root. When this file is present, `projectPath` is optional — the server detects your project from the working directory.

```json
{
  "generator": "Ninja",
  "config": "Release",
  "buildDir": "build",
  "pluginsDir": "plugins",
  "validateFormats": ["VST3", "CLAP"],
  "validateCommand": "pluginval",
  "clapValidatorCommand": "clap-validator"
}
```

### Expected layout

```
my-plugin/
├── apc-mcp.json             # Per-project config (optional)
├── CMakeLists.txt           # Root CMake project
├── plugins/
│   ├── MyPlugin/
│   │   ├── CMakeLists.txt   # Per-plugin CMake target
│   │   ├── Source/
│   │   └── status.json      # Optional metadata (type, version, etc.)
│   └── ...
├── common/                  # Shared sources (optional)
└── build/                   # Build directory (auto-created)
```

---

## Development

```sh
git clone https://github.com/sgm-audio/apc-mcp.git
cd apc-mcp
npm install
npm test          # 11 tests, node:test, zero deps
npm run lint      # syntax check on the server code itself
```

### Project structure

```
apc-mcp/
├── index.js                    # MCP server — single file, 7 tools
├── templates/
│   ├── clap/                   # CLAP plugin scaffold template
│   └── juce/                   # JUCE plugin scaffold template
├── tests/
│   └── server.test.js          # 11 integration tests
├── .github/
│   ├── workflows/
│   │   ├── publish.yml         # CI: test on push/PR, publish on tag
│   │   └── codeql.yml          # CodeQL security analysis
│   ├── dependabot.yml          # Automated dependency updates
│   └── ISSUE_TEMPLATE/         # Bug report + feature request templates
├── .editorconfig               # Editor consistency
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

### Versioning

This project follows [Semantic Versioning](https://semver.org). Breaking changes to any tool's input schema or output format increment the major version.

---

## FAQ / Troubleshooting

**Q: I get "command not found: cmake"**  
A: apc-mcp uses your system's existing toolchain. Install CMake via your package manager: `brew install cmake`, `apt install cmake`, or download from [cmake.org](https://cmake.org).

**Q: Does it work with VS Code / Cursor / Continue.dev?**  
A: Yes — any MCP client works. Point it at `npx github:sgm-audio/apc-mcp` using whatever MCP config format that client uses.

**Q: How do I update to a new version?**  
A: If using `npx github:...`, clear the npx cache: `npx --cache clear github:sgm-audio/apc-mcp` — or just restart your MCP client, npx checks for updates automatically.

**Q: Can I use this with non-JUCE projects?**  
A: Yes. `audio_plugin_build`, `audio_plugin_configure`, `audio_plugin_test`, and `audio_plugin_lint` work with any CMake-based C++ project. Only `audio_plugin_create` and `audio_plugin_validate` are plugin-format-specific.

---

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
