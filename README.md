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
  <a href="https://github.com/sgm-audio/apc-mcp/releases"><img src="https://img.shields.io/github/v/release/sgm-audio/apc-mcp?logo=github&label=Release" alt="Release"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22+-339933?logo=node.js&logoColor=white" alt="Node"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sgm-audio/apc-mcp" alt="License"></a>
</p>

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server for audio plugin development. It wraps the tools you already use — **CMake**, **ctest**, **clang-format**, **pluginval**, **clap-validator** — into a clean MCP tool interface for building, testing, linting, validating, and scaffolding plugin projects across JUCE, CLAP and VST3 formats.

Works with any MCP client: Claude Code, OpenCode, VS Code with MCP, Continue.dev, and more.

> **Project status.** A full build/QA/security audit found **36 defects** —
> including a path traversal in `audio_plugin_lint` that allowed arbitrary writes
> outside the project, scaffold templates that could neither configure nor
> compile, and tools that reported success when the underlying command had failed.
> `package.json` on `main` is version **2.0.0**, but there is no `v2.0.0` tag or
> release (latest tag: `v1.5.0`) and it is not on npm.
>
> Checked 2026-10-31 on Linux, Node 24: `npm test` runs 147 tests — 141 pass,
> 2 skip, 4 fail. The 4 failures are the C++ compile checks; with no system
> C++ compiler they cannot pass, and with the zig-clang wrapper used for this
> check they failed on a toolchain cache error, so those checks remain
> unverified. `npm run lint` passes.
>
> CI: GitHub Actions does run on this repo (100 most recent runs: 64 success,
> 36 failure). The recent `CI` and `CodeQL` runs since 2026-10-20 have failed.
>
> Releases: `v1.4.0`, `v1.4.1` and `v1.5.0` exist as git tags.
> [`SECURITY.md`](SECURITY.md) states that 1.4.0 and 1.5.0 have the path traversal.
> `@sgm-audio/apc-mcp` is not on npm. An npm package named `apc-mcp`
> exists (0.1.0, 0.2.0); its link to this repo was not checked.
>
> [`AUDIT.md`](AUDIT.md) has the findings and evidence;
> [`HANDOFF.md`](HANDOFF.md) has what remains and how to verify it;
> [`TODO.md`](TODO.md) has the unbuilt feature scope (ARA, LV2).

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

`npx` fetches the repo and caches it.

### Requirements

- **Node.js 22+** (Node 18 and 20 are both end of life)
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
audio_plugin_create(name="MyVerb", type="juce", ui="webview", vendor="MyCompany")
audio_plugin_create(name="ToneGen", type="standalone", vendor="MyCompany")
```

Generates a working plugin stub: `CMakeLists.txt`, source files, and either a
modern CLAP entry (the `clap_entry` → plugin-factory chain) or a JUCE
`AudioProcessor` structure.

**`type`** — which template to scaffold:

| `type` | Template | Notes |
|---|---|---|
| `clap` *(default)* | `templates/clap/` | Plain C++ against the free-audio/clap headers. Vendors CLAP at `_tools/clap` or finds an installed `clap-config.cmake`. |
| `juce` | `templates/juce/` or `templates/juce-webview/` | Full `juce_add_plugin` project. `formats` accepts any of JUCE's: `AU AUv3 AAX LV2 Standalone Unity VST VST3`. |
| `vst3` | same JUCE templates | Convenience alias that defaults `formats` to VST3. |
| `standalone` | `templates/standalone/` | A standalone audio **application**, not a plugin: `juce_add_gui_app` builds one executable that owns its audio device via `AudioAppComponent`. Scaffolds `Source/Main.cpp` (a `JUCEApplication` plus its `DocumentWindow`) and `Source/MainComponent.{h,cpp}` (a 440 Hz sine generator with a level slider). Has no `FORMATS`, so passing `formats` with this type is rejected rather than silently ignored. |

> `type="ara"` was removed in 2.0.0. It emitted `FORMATS ARA`, which
> `juce_add_plugin` does not accept, from a plain `juce::AudioProcessor` rather
> than `juce::ARAAudioProcessor` — so it reported success while scaffolding a
> plugin that could never configure. ARA is a JUCE *effect mode*
> (`IS_ARA_EFFECT`), not a format; it will return with a real template.

**`ui`** — editor style, for the JUCE templates only:

| `ui` | What you get |
|---|---|
| `generic` *(default)* | `juce::GenericAudioProcessorEditor` — sliders for every parameter, no UI code to write. |
| `webview` | A `juce::WebBrowserComponent` editor serving an embedded HTML/CSS/JS UI from BinaryData, with a two-way bridge: C++ pushes state via `window.updateState(...)`, and JS calls back by navigating to `apc://callback?action=...&data=...`. Edit `Source/UI/{index.html,style.css,app.js}`. |

`ui` applies to the JUCE *plugin* types only. `clap` ships its own editor and
`standalone` ships its own window, so both ignore it.

The webview template needs a browser backend, so its `CMakeLists.txt` sets
`NEEDS_WEB_BROWSER TRUE` and `NEEDS_WEBVIEW2 TRUE` — WebView2 on Windows, WebKit
on Linux, WKWebView on macOS.

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
npm test          # 147 tests, node:test (compile checks need g++ or clang++)
npm run lint      # syntax check on the server code itself
```

### Project structure

```
apc-mcp/
├── index.js                    # MCP server — single file, 7 tools
├── templates/
│   ├── clap/                   # CLAP scaffold (modern factory/entry API)
│   ├── juce/                   # JUCE scaffold, generic editor
│   ├── juce-webview/           # JUCE scaffold + WebBrowserComponent UI
│   │   └── Source/UI/          # the HTML/CSS/JS you edit
│   └── standalone/             # JUCE *application* (juce_add_gui_app), not a plugin
├── tests/                      # 147 tests, node:test, no framework
│   ├── helpers/mcp-client.mjs  # shared MCP stdio client (full handshake)
│   ├── fixtures/juce-api-stub/ # transcribed JUCE 9 API, for compile checks
│   ├── server.test.js          # happy path
│   ├── security.test.js        # negative / rejection tests
│   ├── tool-output.test.js     # config precedence, parsers, failure reporting
│   ├── templates.test.js       # generated-project structure (no toolchain)
│   ├── artefacts.test.js       # build-artefact discovery per JUCE's real layout
│   ├── cpp-api.test.js         # real g++/clang++ over generated sources
│   └── release.test.js         # versioning, CI pins, release guards
├── scripts/
│   ├── smoke-scaffold.mjs      # npm run smoke — scaffold every type x ui
│   ├── check-licenses.mjs      # npm run licenses — lockfile license gate
│   └── ship.mjs                # npm run ship — guarded tag + push
├── .github/
│   ├── workflows/
│   │   ├── publish.yml         # CI: test, compile-scaffold, scaffold-{clap,juce},
│   │   │                       #     license, publish on v* tags
│   │   └── codeql.yml          # CodeQL security analysis
│   ├── dependabot.yml          # Automated dependency updates
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/         # Bug report + feature request templates
├── eslint.config.js            # npm run lint
├── license_decisions.yml       # the license allowlist
├── .editorconfig               # Editor consistency
├── AUDIT.md                    # full build/QA/security audit + evidence
├── HANDOFF.md                  # what remains, how to verify it, and the traps
├── SECURITY.md                 # threat model and defence layers
├── CHANGELOG.md
├── CONTRIBUTING.md
├── TODO.md                     # unbuilt feature scope
└── LICENSE
```

### Versioning

This project follows [Semantic Versioning](https://semver.org). Breaking changes to any tool's input schema or output format increment the major version.

---

## FAQ / Troubleshooting

**Q: A tool fails with `'cmake' not found on PATH`**  
A: apc-mcp drives your system's existing toolchain rather than shipping one. The message names the missing binary, what it is needed for, and how to install it:

```
## audio_plugin_configure failed
'cmake' not found on PATH (needed for build/configure).
  Install: brew install cmake / apt install cmake / https://cmake.org/download
```

The same applies to `clang-format` (for `audio_plugin_lint`) and `pluginval` /
`clap-validator` (for `audio_plugin_validate`).

**Q: A tool now reports failure where it used to report success**  
A: That is deliberate, and it is the 2.0.0 breaking change. Previously `build`,
`lint`, `test` and `validate` returned `isError: false` whenever the process
*exited 0* — so a build that emitted compiler errors, or a validation that silently
skipped because the validator was missing, was reported to the model as a success.
They now report `isError: true` when the output shows errors or when a step had to
be skipped, and say which. A tool that says it failed is more useful than one that
lies about succeeding; if your own automation branched on the old behaviour, this is
what changed.

**Q: `audio_plugin_create` says success but the project won't configure**  
A: It should not — the templates are verified by `tests/templates.test.js`,
`tests/cpp-api.test.js` and `npm run smoke`. If you hit this, please open an issue
with the tool's full output. For JUCE projects specifically, the generated
`CMakeLists.txt` expects JUCE to be available (a `JUCE` submodule or
`CMAKE_PREFIX_PATH`); that is a prerequisite of the project, not something the
scaffold can supply.

**Q: Does it work with VS Code / Cursor / Continue.dev?**  
A: Yes — any MCP client works. Point it at `npx github:sgm-audio/apc-mcp` using whatever MCP config format that client uses.

**Q: How do I update to a new version?**  
A: `npx` may reuse its cached copy. Delete the cache (`rm -rf ~/.npm/_npx` on macOS/Linux, `%LocalAppData%\npm-cache\_npx` on Windows) and restart your MCP client.

**Q: Can I use this with non-JUCE projects?**  
A: Yes. `audio_plugin_build`, `audio_plugin_configure`, `audio_plugin_test`, and `audio_plugin_lint` work with any CMake-based C++ project. Only `audio_plugin_create` and `audio_plugin_validate` are plugin-format-specific.

---

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
