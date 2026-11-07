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

**apc-mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) server for audio plugin development. It wraps the tools you already use — **CMake**, **ctest**, **clang-format**, **pluginval**, **clap-validator** — into a clean MCP tool interface for building, testing, linting, validating, and scaffolding plugin projects across JUCE, CLAP, VST3, and LV2 formats.

Works with any MCP client: Claude Code, OpenCode, VS Code with MCP, Continue.dev, and more.

> **Project status.** A full build/QA/security audit and follow-up bug hunt
> hardened security boundaries (including symlink-aware containment and
> C++/CMake/Turtle template escaping), rewrote all five scaffold templates
> (`clap`, `juce`, `juce-webview`, `lv2`, `standalone`) against verified
> upstream JUCE 9, CLAP, and LV2 APIs, and fixed validator/build/lint/test CLI
> handling.
>
> Current baseline on Node 22+: `npm run check` passes cleanly — ESLint (0
> warnings), **215 tests** (`node:test`, including real `gcc`/`g++` compile + link
> checks against JUCE 9, `free-audio/clap`, and `lv2/lv2` headers), `10/10`
> scaffold smoke cases, `0` `npm audit` vulnerabilities, and `163/163`
> allowlisted lockfile licenses.
>
> `package.json` on `main` is version **2.0.0** (not yet tagged/published to
> npm; latest git tag is `v1.5.0`). [`SECURITY.md`](SECURITY.md) documents why
> `1.4.0` and `1.5.0` should not be used on untrusted inputs.
> [`AUDIT.md`](AUDIT.md) has the original audit record, [`HANDOFF.md`](HANDOFF.md)
> has the engineering guide, and [`TODO.md`](TODO.md) tracks the remaining ARA
> template work.

---

## Quick Start

`apc-mcp` produces real, compilable, host-loadable plugins, **but it wraps your local toolchain rather than bundling or auto-downloading compilers and SDKs**. Follow the three steps below to go from an empty folder to a built binary without hitting any surprises.

### 1. Add `apc-mcp` to your MCP client

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

> **Version quirk (`main` vs. npm `1.x`):** Use `github:sgm-audio/apc-mcp` until `v2.0.0` is tagged and published to npm (`@sgm-audio/apc-mcp`). Older `1.4.0` / `1.5.0` tags predate the template rewrites, CMake wiring, and security fixes (see [`SECURITY.md`](SECURITY.md)). Verify the active version with `npx -y github:sgm-audio/apc-mcp --version` (or clear a stale `npx` cache with `rm -rf ~/.npm/_npx` on macOS/Linux, `%LocalAppData%\npm-cache\_npx` on Windows).

### 2. Install toolchain, SDKs & optional validators

#### Core build prerequisites (always required)
- **[Node.js 22+](https://nodejs.org/)** — runs the MCP server (Node 18 and 20 are EOL).
- **[CMake 3.22+](https://cmake.org/download/)** (includes `ctest`) + optional **[Ninja](https://ninja-build.org/)** for fast parallel builds.
- **C11 / C++20 compiler** — [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) (macOS), [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) (Windows), or GCC / [Clang](https://llvm.org/) (Linux).

#### Third-party audio plugin SDKs (pick the format you are building)

| Scaffold `type` | Required SDK | How CMake finds it |
|---|---|---|
| `clap` | **[CLAP](https://github.com/free-audio/clap)** *(header-only C API)* | Clone to `<project>/_tools/clap`, `add_subdirectory()` it from your root `CMakeLists.txt`, or install it so `clap-config.cmake` is on `CMAKE_PREFIX_PATH`. |
| `juce`, `vst3`, `standalone` | **[JUCE 9](https://github.com/juce-framework/JUCE)** *(C++ framework; bundles VST3 & LV2 wrappers — no separate [Steinberg VST3 SDK](https://github.com/steinbergmedia/vst3sdk) download needed; [Avid AAX SDK](https://developer.avid.com/aax/) only if `formats` includes `AAX`)* | Clone (e.g. `--branch 9.0.3`) to `<project>/_tools/JUCE`, pass `options="-DJUCE_DIR=/path/to/JUCE"` to `audio_plugin_configure`, or `add_subdirectory(JUCE)` from your root `CMakeLists.txt`. For `ui="webview"` on Windows, JUCE uses [Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). |
| `lv2` | **[LV2](https://github.com/lv2/lv2)** *(header-only C11 spec)* | Install via package manager (`brew install lv2` / `apt install lv2-dev`), clone to `<project>/_tools/lv2`, or pass `options="-DLV2_INCLUDE_DIR=/path/to/lv2/include"` (also checks `APC_LV2_DIR` / `LV2_DIR` env vars). |

#### Optional lint & validation tools
- **[clang-format](https://clang.llvm.org/docs/ClangFormat.html)** — required for `audio_plugin_lint`.
- **[pluginval](https://github.com/Tracktion/pluginval/releases)** — required by `audio_plugin_validate` for **VST3** and macOS **AudioUnit** bundles.
- **[clap-validator](https://github.com/free-audio/clap-validator/releases)** — required by `audio_plugin_validate` for **CLAP** binaries.

### 3. Bootstrap a project folder & build in 60 seconds

**Step A — Mark the project root & drop in an SDK** *(one-time shell setup)*:

```sh
mkdir my-plugins && cd my-plugins
echo '{}' > apc-mcp.json   # required root marker (or create a root CMakeLists.txt)

# Pick ONE (or more) SDKs to vendor under _tools/:
git clone --depth 1 https://github.com/free-audio/clap.git _tools/clap
# git clone --depth 1 --branch 9.0.3 https://github.com/juce-framework/JUCE.git _tools/JUCE
# git clone --depth 1 https://github.com/lv2/lv2.git _tools/lv2
```

**Step B — Ask your MCP agent (or call the tools directly)**:

```text
1. audio_plugin_create(projectPath="/path/to/my-plugins", name="MyGain", type="clap", vendor="Acme")
2. audio_plugin_build(projectPath="/path/to/my-plugins", config="Release")
3. audio_plugin_validate(projectPath="/path/to/my-plugins", format="CLAP")
```

Your built binary lands at:
```text
build/plugins/MyGain/MyGain_artefacts/Release/CLAP/MyGain.clap
```
*(Or `.../VST3/My Gain.vst3`, `.../LV2/MyGain.lv2/`, etc. depending on `type`.)*

### Good-to-Know Quirks & Gotchas

- **Empty folders are rejected on purpose:** Every tool (including `audio_plugin_create`) requires `<project>/apc-mcp.json` or `<project>/CMakeLists.txt` to exist first so a typo'd `projectPath` cannot write outside a real project. If `apc-mcp.json` is present without `CMakeLists.txt`, `audio_plugin_create` creates a minimal root `CMakeLists.txt` and appends `add_subdirectory(plugins/<Name>)` automatically.
- **`_tools/` relative path depth:** The built-in `_tools/{JUCE,clap,lv2}` fallback looks two directories up from `<project>/plugins/<Name>/CMakeLists.txt`. If you customize `"pluginsDir"` in `apc-mcp.json` to a deeper path (e.g. `"src/audio/plugins"`), pass `-DJUCE_DIR=...` / `-DLV2_INCLUDE_DIR=...` via `audio_plugin_configure` or `add_subdirectory()` the SDK in your root `CMakeLists.txt`.
- **System plugin folders are never modified during builds:** JUCE templates set `COPY_PLUGIN_AFTER_BUILD FALSE` so builds never silently overwrite `~/Library/Audio/Plug-Ins` or `/Library/Audio/Plug-Ins` (and never fail on CI/sandbox permissions). Copy or symlink from `build/plugins/<Name>/<Name>_artefacts/<Config>/` into your DAW's scan path when ready.
- **JUCE on Linux needs system dev headers (and a display for LV2):** Install the packages listed in JUCE's [`Linux Dependencies.md`](https://github.com/juce-framework/JUCE/blob/9.0.3/docs/Linux%20Dependencies.md) (`libasound2-dev`, `libjack-jackd2-dev`, `ladspa-sdk`, `libcurl4-openssl-dev`, `libfreetype-dev`, `libfontconfig1-dev`, `libx11-dev`, `libxcomposite-dev`, `libxcursor-dev`, `libxext-dev`, `libxinerama-dev`, `libxrandr-dev`, `libxrender-dev`, `libxi-dev`, `libglu1-mesa-dev`, `mesa-common-dev`, `libegl-dev`, plus `libwebkit2gtk-4.1-dev` for `ui="webview"`). On headless Linux CI, wrap builds that include JUCE's `LV2` format in `xvfb-run -a` because JUCE's `juce_lv2_helper` initializes GUI context during `POST_BUILD` `.ttl` generation.
- **Two different LV2 paths:** `type="lv2"` scaffolds a zero-dependency **pure C11** LV2 plugin (`templates/lv2/`, always naming the binary `<Name>.so` inside `<Name>.lv2/` to match `manifest.ttl` across platforms). `type="juce"` (whose default `formats` is `VST3;LV2`) builds a **C++ JUCE** plugin using JUCE's LV2 wrapper.
- **`type="standalone"` vs. `formats="Standalone"`:** `type="standalone"` scaffolds a standalone GUI audio *application* (`juce_add_gui_app`) and rejects `formats=...`. If you want a DAW plugin *plus* a standalone app wrapper from the same processor, use `type="juce"` with `formats="VST3;Standalone"`.
- **Validator coverage:** `audio_plugin_validate` runs `pluginval` on `VST3` and (on macOS) `AudioUnit`, and `clap-validator` on `CLAP`. `LV2` and `Standalone` artefacts are discovered and reported as skipped rather than validated; for LV2 Turtle/spec checks, use external tools such as [`sord_validate`](https://gitlab.com/drobilla/sord) or [`lv2lint`](https://gitlab.com/OpenMusicKontrollers/lv2lint).
- **Single-config vs. multi-config CMake trees:** `audio_plugin_build` auto-configures `build/` on first run, and automatically reconfigures single-config caches (Ninja / Unix Makefiles) when switching between `Debug` and `Release` without clobbering your chosen CMake generator.

---

## Tools

| Tool | Description |
|------|-------------|
| [`audio_plugin_build`](#build) | CMake configure + build with parsed error/warning counts |
| [`audio_plugin_configure`](#configure) | CMake configure with custom generator and flags |
| [`audio_plugin_test`](#test) | ctest runner with pass/fail/total summary |
| [`audio_plugin_lint`](#lint) | clang-format check (dry-run) or auto-fix on C/C++ sources |
| [`audio_plugin_plugins`](#list-plugins) | Discover plugins with metadata — text or JSON output |
| [`audio_plugin_validate`](#validate) | Run pluginval (VST3) or clap-validator on built binaries |
| [`audio_plugin_create`](#scaffold) | Scaffold a new CLAP, JUCE, VST3, LV2, or standalone target |

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
audio_plugin_create(name="Lv2Gain", type="lv2", vendor="MyCompany")
audio_plugin_create(name="ToneGen", type="standalone", vendor="MyCompany")
```

Generates a working plugin or app stub: `CMakeLists.txt`, source files, and a
CLAP factory/entry + `CLAP_EXT_AUDIO_PORTS` plugin, a JUCE `AudioProcessor` /
`AudioAppComponent`, or a native C11 LV2 bundle with Turtle metadata.

**`type`** — which template to scaffold:

| `type` | Template | Notes |
|---|---|---|
| `clap` *(default)* | `templates/clap/` | C++20 `MODULE` plugin against `free-audio/clap` headers with stereo `CLAP_EXT_AUDIO_PORTS` (CFBundle on macOS, single `.clap` DSO on Linux/Windows). Vendors CLAP at `_tools/clap` or finds an installed `clap-config.cmake`. |
| `juce` | `templates/juce/` or `templates/juce-webview/` | Full `juce_add_plugin` project. `formats` accepts any of JUCE's: `AU AUv3 AAX LV2 Standalone Unity VST VST3`. |
| `vst3` | same JUCE templates | Convenience alias that defaults `formats` to VST3. |
| `lv2` | `templates/lv2/` | Native LV2 plugin in pure C11 against `lv2/core/lv2.h` plus `manifest.ttl` and `plugin.ttl` (unrelated to JUCE's C++ `LV2` format target). |
| `standalone` | `templates/standalone/` | A standalone audio **application**, not a plugin: `juce_add_gui_app` builds one executable that owns its audio device via `AudioAppComponent`. Scaffolds `Source/Main.cpp` (a `JUCEApplication` plus its `DocumentWindow`) and `Source/MainComponent.{h,cpp}` (a 440 Hz sine generator with a level slider). Has no `FORMATS`, so passing `formats` with this type is rejected rather than silently ignored. |

> `type="ara"` was removed in 2.0.0. It emitted `FORMATS ARA`, which
> `juce_add_plugin` does not accept, from a plain `juce::AudioProcessor`
> without `juce::AudioProcessorARAExtension` /
> `juce::ARADocumentControllerSpecialisation` — so it reported success while
> scaffolding a plugin that could never configure. ARA is a JUCE *effect mode*
> (`IS_ARA_EFFECT`), not a format; it will return with a dedicated template.

**`ui`** — editor style, for the JUCE templates only:

| `ui` | What you get |
|---|---|
| `generic` *(default)* | `juce::GenericAudioProcessorEditor` — sliders for every parameter, no UI code to write. |
| `webview` | A `juce::WebBrowserComponent` editor serving an embedded HTML/CSS/JS UI from BinaryData, with a two-way bridge: C++ pushes state via `window.updateState(...)`, and JS calls back by navigating to `apc://callback?action=...&data=...`. Edit `Source/UI/{index.html,style.css,app.js}`. |

`ui` applies to the JUCE *plugin* types (`juce`, `vst3`) only. `clap` and `lv2`
are headless DSP scaffolds, and `standalone` ships its own `AudioAppComponent`
window, so all three ignore `ui`.

The webview template needs a browser backend, so its `CMakeLists.txt` sets
`NEEDS_WEB_BROWSER TRUE`, `NEEDS_WEBVIEW2 TRUE`, and
`JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1` — WebView2 on Windows, WebKit on
Linux, WKWebView on macOS.

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
npm test          # 215 tests, node:test (compile + link checks use gcc/g++ or clang/clang++)
npm run lint      # ESLint + syntax check on server, scripts, tests, and WebView JS
npm run check     # Full gate: lint + test + scaffold smoke + npm audit + license check
```

### Project structure

```
apc-mcp/
├── index.js                    # MCP server — single file, 7 tools
├── templates/
│   ├── clap/                   # CLAP scaffold (modern factory/entry + audio-ports API)
│   ├── juce/                   # JUCE scaffold, generic editor
│   ├── juce-webview/           # JUCE scaffold + WebBrowserComponent UI
│   │   └── Source/UI/          # the HTML/CSS/JS you edit
│   ├── lv2/                    # Native C11 LV2 scaffold + Turtle metadata
│   └── standalone/             # JUCE *application* (juce_add_gui_app), not a plugin
├── tests/                      # 215 tests, node:test, no framework
│   ├── helpers/mcp-client.mjs  # shared MCP stdio client (full handshake)
│   ├── fixtures/juce-api-stub/ # transcribed JUCE 9 API, for compile + link checks
│   ├── server.test.js          # happy path + CLI flags + root CMake wiring
│   ├── security.test.js        # negative / traversal / symlink rejection tests
│   ├── tool-output.test.js     # config precedence, parsers, failure reporting
│   ├── templates.test.js       # generated-project structure (no toolchain)
│   ├── artefacts.test.js       # build-artefact discovery per JUCE/CLAP/LV2 layouts
│   ├── cpp-api.test.js         # real gcc/g++/clang compile + link over generated C/C++
│   └── release.test.js         # versioning, CI pins, SPDX license & release guards
├── scripts/
│   ├── smoke-scaffold.mjs      # npm run smoke — scaffold every type x ui
│   ├── check-licenses.mjs      # npm run licenses — lockfile license gate
│   └── ship.mjs                # npm run ship — guarded tag + push
├── .github/
│   ├── workflows/
│   │   ├── publish.yml         # CI: test, compile-scaffold, scaffold-{clap,lv2,juce},
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

**Q: `audio_plugin_create` says success — what SDKs do I need to build?**  
A: `audio_plugin_create` registers `add_subdirectory(plugins/<Name>)` in your root
`CMakeLists.txt` automatically (or creates one if you started with `apc-mcp.json`
alone). To compile and link the target, supply the matching format SDK (`_tools/clap`,
`_tools/JUCE`, or `_tools/lv2` / system LV2 headers) — see the SDK table and
gotchas in [Quick Start](#quick-start).

**Q: Does it work with VS Code / Cursor / Continue.dev?**  
A: Yes — any MCP client works. Point it at `npx github:sgm-audio/apc-mcp` using whatever MCP config format that client uses.

**Q: How do I update to a new version?**  
A: `npx` may reuse its cached copy. Delete the cache (`rm -rf ~/.npm/_npx` on macOS/Linux, `%LocalAppData%\npm-cache\_npx` on Windows) and restart your MCP client.

**Q: Can I use this with non-JUCE projects?**  
A: Yes. `audio_plugin_build`, `audio_plugin_configure`, `audio_plugin_test`, and `audio_plugin_lint` work with any CMake-based C++ project. Only `audio_plugin_create` and `audio_plugin_validate` are plugin-format-specific.

---

## License

MIT © 2026 Scott Mills. See [LICENSE](LICENSE).
