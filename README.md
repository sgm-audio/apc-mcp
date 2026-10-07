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
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22+-339933?logo=node.js&logoColor=white" alt="Node"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sgm-audio/apc-mcp" alt="License"></a>
</p>

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server for audio plugin development. It wraps the tools you already use — **CMake**, **ctest**, **clang-format**, **pluginval**, **clap-validator** — into a clean MCP tool interface for building, testing, linting, validating, and scaffolding plugin projects across JUCE, CLAP and VST3 formats.

Works with any MCP client: Claude Code, OpenCode, VS Code with MCP, Continue.dev, and more.

> **Project status.** A full build/QA/security audit found **36 defects** —
> including a path traversal in `audio_plugin_lint` that allowed arbitrary writes
> outside the project, scaffold templates that could neither configure nor
> compile, and tools that reported success when the underlying command had failed.
> All five remediation phases are **complete** on branch
> `arena/353ee88c-apc-mcp`, released as **2.0.0** (not yet published):
> `npm run check` exits 0 with 163 tests green, ESLint clean, no known
> vulnerabilities and the license gate passing.
>
> Two caveats, stated plainly rather than buried:
>
> 1. **GitHub Actions on this repo are locked for billing, so the CI badge above
>    does not reflect the state of the code** — and no CI job has ever run, which
>    means `cmake -B build` on a scaffolded plugin is still unverified. See
>    `HANDOFF.md` §7 and `AUDIT.md` Phase 6 item 41.
> 2. **Versions 1.4.0 and 1.5.0 on npm are vulnerable** to that path traversal.
>    Upgrade to 2.0.0 once published — see [`SECURITY.md`](SECURITY.md).
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

That's it. `npx` handles fetching and caching. Updates automatically when you restart your client.

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
audio_plugin_create(name="my-gain", type="lv2", vendor="MyCompany")
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
| `lv2` | `templates/lv2/` | A **native LV2 plugin**: pure C against `lv2/core/lv2.h` plus Turtle metadata (`manifest.ttl`, `plugin.ttl`). A stereo gain stage with one control port. Unrelated to the LV2 that `type="juce"` emits from a C++ `AudioProcessor` — this one has no JUCE dependency at all. |
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
npm test          # 11 tests, node:test, zero deps
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
│   ├── standalone/             # JUCE *application* (juce_add_gui_app), not a plugin
│   └── lv2/                    # native LV2 plugin: C + Turtle metadata, no JUCE
├── tests/                      # 163 tests, node:test, no framework
│   ├── helpers/mcp-client.mjs  # shared MCP stdio client (full handshake)
│   ├── fixtures/juce-api-stub/ # transcribed JUCE 9 API, for compile checks
│   ├── server.test.js          # happy path
│   ├── security.test.js        # negative / rejection tests
│   ├── tool-output.test.js     # config precedence, parsers, failure reporting
│   ├── templates.test.js       # generated-project structure (no toolchain)
│   ├── artefacts.test.js       # build-artefact discovery per JUCE's real layout
│   ├── cpp-api.test.js         # real gcc/g++ over generated C and C++
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
A: If using `npx github:...`, clear the npx cache: `npx --cache clear github:sgm-audio/apc-mcp` — or just restart your MCP client, npx checks for updates automatically.

**Q: Can I use this with non-JUCE projects?**  
A: Yes. `audio_plugin_build`, `audio_plugin_configure`, `audio_plugin_test`, and `audio_plugin_lint` work with any CMake-based C++ project. Only `audio_plugin_create` and `audio_plugin_validate` are plugin-format-specific.

---

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
