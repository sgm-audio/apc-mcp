# Tool reference

apc-mcp registers **ten** canonical MCP tools plus deprecated `audio_plugin_*` compatibility aliases, and **four** native MCP Prompts (`prompts/list` & `prompts/get` slash commands). Use the short names in new clients and workflows; aliases delegate to the same schemas and handlers. All tools accept an optional `projectPath`; when omitted, the server walks up from its working directory (max 20 levels) looking for `apc-mcp.json` or `CMakeLists.txt`. A project root must exist and carry one of those markers — see [Configuration](configuration.md#project-root-detection).

Tools fail **honestly**: if the underlying command failed, emitted compiler errors, had failing tests, or a build/test step had to be skipped, the result carries `isError: true` and says why. A skipped validation is never reported as a clean one, and a check that was never attempted is reported as `NOT CHECKABLE` rather than passed off as success (see [`apc-val`](#apc-val)).

| Tool | What it runs | Key arguments |
|---|---|---|
| [`apc`](#apc) | Copies a scaffold from `templates/` (defaults to `type="juce"`, `ui="jive"`, `style="fx"`) | `name`, `type`, `ui`, `style`, `formats`, `vendor`, `description` |
| [`apc-add-param`](#apc-add-param) | Atomically updates C++ APVTS + `MainView.xml` + `Styles.json` | `pluginName`, `id`, `name`, `min`, `max`, `default`, `unit`, `controlType` |
| [`apc-ship`](#apc-ship) | `Release Build → Lint → pluginval (strictness 5) → dist/ Package → Local Install` | `version`, `installLocal` |
| [`apc-doctor`](#apc-doctor) | Diagnoses CMake, C++20 compiler, JUCE, JIVE, `pluginval`, `~/.apc-mcp/deps/`, and OS plugin directories | `projectPath` |
| [`apc-cfg`](#apc-cfg) | `cmake -B …` | `generator`, `options`, `config` |
| [`apc-build`](#apc-build) | `cmake --build …` (auto-configures first) | `config`, `target`, `clean` |
| [`apc-test`](#apc-test) | `ctest` | `config`, `testName` |
| [`apc-lint`](#apc-lint) | `clang-format` (dry-run by default) | `fix`, `target` |
| [`apc-list`](#apc-list) | Reads the `plugins/` tree | `format` |
| [`apc-val`](#apc-val) | `pluginval` / `clap-validator` | `config`, `format` |

`apc-cfg`, `apc-build`, `apc-test` and `apc-lint` work with **any CMake-based C/C++ project**, not just the scaffolds this server generates. Only `apc`, `apc-add-param`, `apc-ship`, and `apc-val` are plugin-format-specific.

### Native MCP Slash Commands (`prompts/list` & `prompts/get`)

| Prompt | Arguments | Workflow |
|---|---|---|
| `apc:new` | `name` *(required)*, `style` *(optional: `fx` \| `synth` \| `utility`)* | Runs `apc-doctor` if cache is cold, then `apc` scaffolds `type="juce", ui="jive"`, and summarizes APVTS parameters and Debug hot-reload paths. |
| `apc:ui` | `design` *(required)* | Uses `apc-add-param` to add parameters, updates JIVE layout/styles using `Source/UI/Presets/` primitives, and runs a `Debug` compile check. |
| `apc:ship` | `version` *(optional, default `"0.1.0"`)* | Runs `apc-ship(installLocal=true)` and self-heals C++/XML/JSON errors up to 3 times before reporting the `dist/` path and DAW rescan instructions. |
| `apc:doctor` | *(none)* | Runs `apc-doctor`, initializes `~/.apc-mcp/deps/`, and outputs a concise readiness matrix. |

### apc-cfg

```text
apc-cfg()
apc-cfg(generator="Ninja")
apc-cfg(options="-DJUCE_DIR=/path/to/JUCE -DLV2_INCLUDE_DIR=/path/to/lv2/include")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `generator` | string, optional | CMake default on Windows, `Unix Makefiles` on POSIX. Common: `Ninja`, `Xcode` |
| `options` | string, optional | `-DNAME=VALUE` cache flags; each token becomes its own argv entry. Allowed grammar (anything else is rejected before `cmake` runs): `-D<NAME>[:<TYPE>]=<VALUE>` (NAME starts with a letter or `_`; VALUE may contain letters, digits, `_ = / . \ - + : @ ,` and spaces), `-U<NAME>`, and `-Wdev` / `-Wno-dev` / `-Wdeprecated` / `-Wno-deprecated` / `-Werror=dev` / `-Werror=deprecated`. Neither a flag nor a `-D` value may contain a `..` path segment — use absolute paths for SDK locations (e.g. `-DJUCE_DIR=/opt/JUCE`). Variables whose value CMake would load or execute (project includes, toolchain, compilers, launchers, `*_FLAGS`, …) are rejected outright. |

Separate flags with `;` when a value itself contains a space:
`options="-DCMAKE_PREFIX_PATH=/Users/me/My Plugins;-DJUCE_DIR=/path/to/JUCE"`. A space-only
string still works for the common case, but it cannot tell `-DNAME=a b` from
two flags, so it splits there — use `;` whenever a value has a space in it.

A `generator` you pass explicitly is always forwarded as `-G`, including onto an existing cache — that is how you switch generators on purpose. Only the *default* (`Unix Makefiles` on POSIX, CMake's platform default on Windows) is suppressed when `CMakeCache.txt` already exists, because re-issuing it onto a cache built with a different generator makes CMake abort with a generator mismatch. `apc-build` applies the same rule when it auto-configures.

### apc-build

```text
apc-build()
apc-build(config="Release", clean=true)
apc-build(target="MyPlugin_Standalone")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `target` | string, optional | Single CMake target, e.g. `MyPlugin_VST3` |
| `clean` | boolean, `false` | Rebuild from scratch |

Returns structured output with error and warning counts plus the first 20 of each. It configures `build/` automatically when the cache is missing, and reconfigures **single-config** caches (Ninja / Unix Makefiles) when you switch `Debug` ↔ `Release`. Multi-config generators simply receive `--config`.

### apc-test

```text
apc-test()
apc-test(config="Release", testName="MyPluginTest.*")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `testName` | string, optional | ctest `--tests-regex` |

Returns pass / failed / total. If ctest's output cannot be parsed, the tool says so instead of inventing counts.

### apc-lint

```text
apc-lint()
apc-lint(fix=true)
apc-lint(target="plugins/Foo/Source")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `fix` | boolean, `false` | `true` formats files in place; otherwise a dry-run report |
| `target` | string, optional | File or directory relative to the project root |

`target` is containment-checked: `..` segments, absolute paths outside the project, and symlinks escaping the project are rejected. Directory walks skip the build tree, `_tools/`, `node_modules/`, `CMakeFiles/` and `_deps/`. Requires `clang-format`.

### apc-list

```text
apc-list()
apc-list(format="json")
```

Lists directories under the configured `pluginsDir` that contain a `CMakeLists.txt`, with optional `status.json` metadata. `format` is `text` (default) or `json`. `json` always returns a parseable array — `[]` when the plugins directory does not exist or holds no plugins; the prose explanations (`No plugins/ directory found…`) are text-mode only. Symlinked `status.json` files are refused.

`status.json` is **user-authored**: no tool creates or edits it, so a plugin without one simply has no metadata beyond what is on disk. See the layout note in [configuration](configuration.md).

### apc-val

```text
apc-val()
apc-val(format="VST3")
apc-val(format="CLAP")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Must match the build you ran |
| `format` | `VST3` \| `CLAP` \| `all` (default) | `all` uses `validateFormats` from `apc-mcp.json` |

Scans `<buildDir>/<pluginsDir>/<Name>/<Name>_artefacts/<Config>/` (`pluginsDir` from `apc-mcp.json`, default `plugins`) and runs:

| Artefact | Validator | Result |
|---|---|---|
| VST3 | `validateCommand` (default `pluginval`) | Validated with `--strictness-level 10` |
| CLAP | `clapValidatorCommand` (default `clap-validator`) | Validated with the `validate` subcommand |
| LV2, AudioUnit, Standalone | none integrated in this server | **NOT CHECKABLE** — reported as such |

Three outcomes are distinguished, because they mean different things:

| Status | Meaning | `isError` |
|---|---|---|
| `PASS` / `FAIL` | A validator ran and returned a verdict | `FAIL` ⇒ `true` |
| `MISSING-VALIDATOR` | A validator *is* configured for this format but is not installed | `true` — the run is incomplete, and installing it would fix it |
| `NOT CHECKABLE` | No validator is integrated in this server for this format (LV2, AudioUnit, Standalone) | `false` — nothing was attempted, and no installation would change that |

The third row is the important one: telling a user to "install the missing validator" for an LV2 build is unactionable advice, so it is not treated as a failure. A requested format that produced no artefact at all is not silently omitted either: the report ends with a `**No artefact found**` line naming those formats, since absence is not proof of a broken build but also not coverage. For LV2 Turtle/spec checks use external tools such as [sord_validate](https://gitlab.com/drobilla/sord) or [lv2lint](https://gitlab.com/OpenMusicKontrollers/lv2lint). `validateFormats` in `apc-mcp.json` may name LV2, AudioUnit or Standalone for artefact discovery, but no validator is run for them.

`format` accepts every member of the artefact enum — `VST3`, `CLAP`, `LV2`, `AudioUnit`, `Standalone`, `all` — even where no validator exists, so asking about a format is never itself an error.

### apc

```text
apc(name="TapeEcho")
apc(name="PolyLead", style="synth", vendor="MyCompany")
apc(name="MyVerb", type="juce", ui="generic", vendor="MyCompany", formats="VST3;AU")
apc(name="MyVerb", type="juce", ui="webview", vendor="MyCompany")
apc(name="Phaser9000", type="clap")
apc(name="Lv2Gain", type="lv2", vendor="MyCompany")
apc(name="ToneGen", type="standalone", vendor="MyCompany")
apc(name="AraReverb", type="ara", vendor="MyCompany")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Parent project root; auto-detected from CWD |
| `name` | **required**, `[A-Za-z][A-Za-z0-9_-]*` | Also the CMake target name; reserved names (`all`, `test`, `install`, …) are rejected |
| `type` | `juce` (default), `vst3`, `clap`, `lv2`, `standalone`, `ara` | See the table below. `ara` is a JUCE effect mode with its own template, not a plugin format. |
| `ui` | `jive` (default), `generic`, `juce`, `webview` | JUCE plugin types only; ignored elsewhere |
| `style` | `fx` (default), `synth`, `utility` | Seeds initial DSP and JIVE UI controls (`cutoff` knob + `IS_SYNTH TRUE` for `synth`; `bypass` toggle for `utility`) |
| `vendor` | `apc-mcp` | Embedded in plugin metadata. Any single line of text up to 128 characters, non-ASCII included ("ACME, Inc." and "Café Audio" both work); quotes, backslashes and `&` are escaped per output grammar. Used in sanitized form for bundle IDs, four-character codes and the LV2 URN — which is also the `LV2URI` of the JUCE plugin templates, so a `type="juce"` LV2 build and a `type="lv2"` build name the plugin's identity the same way |
| `description` | `An audio plugin` | Any single line of text up to 512 characters, non-ASCII included. Escaped separately for C++, CMake and LV2 Turtle |
| `formats` | JUCE default `VST3;LV2;Standalone` | Semicolon-separated override for `juce` / `vst3`; rejected for `ara` (fixed VST3/AU), `clap`, `lv2`, and `standalone` |

Control characters (newlines included) are rejected in `vendor` and `description` with an explanatory message: they would terminate the C++, CMake or Turtle construct the value is pasted into, and no amount of escaping makes a newline safe in all three.

**`type` — which template**

| `type` | Template | What you get |
|---|---|---|
| `juce` *(default)* | `templates/juce-jive/`, `templates/juce/`, or `templates/juce-webview/` | Full `juce_add_plugin` project; `formats` accepts JUCE's `AU AUv3 AAX LV2 Standalone Unity VST VST3`; includes `package` target staging bundles to `dist/<Name>-<Version>-<Platform>/` |
| `vst3` | same JUCE templates | Convenience alias defaulting `formats` to `VST3` |
| `clap` | `templates/clap/` | C++20 `MODULE` plugin against `free-audio/clap` headers, stereo `CLAP_EXT_AUDIO_PORTS`; a `.clap` binary (CFBundle on macOS) |
| `lv2` | `templates/lv2/` | Native **pure C11** LV2 plugin against `lv2/core/lv2.h` with `manifest.ttl` + `plugin.ttl`; unrelated to JUCE's C++ `LV2` format |
| `standalone` | `templates/standalone/` | A standalone GUI audio **application** (`juce_add_gui_app`), not a host-loadable plugin |
| `ara` | `templates/ara/` | JUCE ARA effect with `FORMATS VST3 AU`, `IS_ARA_EFFECT TRUE`, an ARA-aware processor/editor, a playback renderer and a document-controller factory. Requires an external ARA SDK. |

ARA is an effect mode, not a format. `apc(type="ara")` does not auto-configure; clone the external [ARA SDK](https://github.com/Celemony/ARA_SDK) with its submodules initialized, then run `apc-cfg(options="-DAPC_ARA_SDK_PATH=/absolute/path/to/ARA_SDK")` before building. The path must name the SDK root containing `ARA_Library/PlugIn/ARAPlug.h` and `ARA_API/ARAInterface.h`. The generated CMake checks that layout with `FATAL_ERROR` and calls `juce_set_ara_sdk_path(...)` before `juce_add_plugin(...)`.

**`ui` — editor style (JUCE plugin types only)**

| `ui` | What you get |
|---|---|
| `jive` *(default)* | Declarative [JIVE](https://github.com/ImJimmi/JIVE) XML/JSON UI (`Source/UI/MainView.xml` + `Source/UI/Styles.json`) with `jive::Interpreter`, APVTS `autoAttachParameters`, Debug disk hot-reload (`jive::SourceRoot`), Release `BinaryData` embedding, and `-DAPC_USE_JIVE=ON\|OFF` toggle |
| `generic` (or `juce`) | `juce::GenericAudioProcessorEditor` — sliders for every parameter, `-DAPC_USE_JIVE=0` |
| `webview` | `juce::WebBrowserComponent` serving embedded HTML/CSS/JS from BinaryData, with a two-way bridge: C++ pushes `window.updateState(...)`, JS calls back via `apc://callback?action=...&data=...`. Edit `Source/UI/{index.html,style.css,app.js}` |

The webview template asks CMake for `NEEDS_WEB_BROWSER TRUE`, `NEEDS_WEBVIEW2 TRUE` and static WebView2 linking — WebView2 on Windows, WebKit on Linux, WKWebView on macOS. `clap` and `lv2` are headless DSP scaffolds; `standalone` ships its own `AudioAppComponent` window. All three ignore `ui`.

`apc` also creates a minimal root `CMakeLists.txt` if needed, appends `add_subdirectory(plugins/<Name>)` once (it detects an existing registration and refuses to modify a symlinked root `CMakeLists.txt`), and initializes the global dependency cache `~/.apc-mcp/deps/`. Newly scaffolded JUCE plugins also copy `common/dsp/` and `common/licensing/` into the project root and link the header-only `apc::dsp` kit by default; pass `-DAPC_USE_DSP_KIT=OFF` to disable it, or `-DAPC_USE_LICENSE_SEAM=ON` to enable the optional licensing seam include path.

### apc-add-param

```text
apc-add-param(id="cutoff", name="Filter Cutoff", min=20, max=20000, default=1000, unit="Hz", controlType="knob")
apc-add-param(id="mix", name="Dry/Wet Mix", min=0, max=100, default=50, unit="%", controlType="slider")
apc-add-param(id="bypass", name="Bypass", min=0, max=1, default=0, controlType="toggle")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `pluginName` | string, optional | Target plugin under `plugins/`; auto-inferred when the project has a single JIVE plugin |
| `id` | **required**, `[a-zA-Z][a-zA-Z0-9_]*` | Unique APVTS parameter ID and JIVE element ID |
| `name` | **required**, string | Display name |
| `min` | number, `0` | Minimum parameter value |
| `max` | number, `1` | Maximum parameter value |
| `default` | number, `0.5` | Initial default value |
| `unit` | string, `""` | Optional unit suffix (`"Hz"`, `"dB"`, `"%"`, `"ms"`) |
| `controlType` | `knob` (default), `slider`, `toggle` | Injects `<Knob>`, `<Slider>`, or `<Checkbox>` (with `AudioParameterBool`) |

Atomically updates `Source/PluginProcessor.cpp` (`createParameterLayout()`), `Source/UI/MainView.xml`, and `Source/UI/Styles.json`, verifying XML well-formedness and JSON validity before writing.

### apc-ship

```text
apc-ship()
apc-ship(version="1.2.0", installLocal=true)
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `version` | string, `"1.0.0"` | Semantic version for `dist/<Name>-<Version>-<OS>/` |
| `installLocal` | boolean, `true` | Copies `.vst3` into `~/Library/Audio/Plug-Ins/VST3`, `%COMMONPROGRAMFILES%\VST3`, or `~/.vst3` |

Runs the complete release pipeline (`Release Build → clang-format Lint → pluginval --strictness-level 5 --validate-in-process → dist/ Package + INSTALL.txt + macOS ad-hoc codesign → Local VST3 Install`) and returns structured compiler/validator diagnostics on any stage failure.

### apc-doctor

```text
apc-doctor()
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Optional project root to check for `_tools/JUCE` and `_tools/JIVE` |

Checks `cmake`, the C++20 compiler, `JUCE`, `JIVE`, `pluginval`, and OS plugin directories, auto-initializing `~/.apc-mcp/deps/` and returning actionable fix commands.
