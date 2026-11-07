# Tool reference

apc-mcp registers **seven** MCP tools. All of them accept an optional `projectPath`; when omitted, the server walks up from its working directory (max 20 levels) looking for `apc-mcp.json` or `CMakeLists.txt`. A project root must exist and carry one of those markers — see [Configuration](configuration.md#project-root-detection).

Tools fail **honestly**: if the underlying command failed, emitted compiler errors, had failing tests, or a step had to be skipped, the result carries `isError: true` and says why. A skipped validation is never reported as a clean one.

| Tool | What it runs | Key arguments |
|---|---|---|
| [`audio_plugin_configure`](#audio_plugin_configure) | `cmake -B …` | `generator`, `options`, `config` |
| [`audio_plugin_build`](#audio_plugin_build) | `cmake --build …` (auto-configures first) | `config`, `target`, `clean` |
| [`audio_plugin_test`](#audio_plugin_test) | `ctest` | `config`, `testName` |
| [`audio_plugin_lint`](#audio_plugin_lint) | `clang-format` (dry-run by default) | `fix`, `target` |
| [`audio_plugin_plugins`](#audio_plugin_plugins) | Reads the `plugins/` tree | `format` |
| [`audio_plugin_validate`](#audio_plugin_validate) | `pluginval` / `clap-validator` | `config`, `format` |
| [`audio_plugin_create`](#audio_plugin_create) | Copies a scaffold from `templates/` | `name`, `type`, `ui`, `formats`, `vendor`, `description` |

`configure`, `build`, `test` and `lint` work with **any CMake-based C/C++ project**, not just the scaffolds this server generates. Only `create` and `validate` are plugin-format-specific.

### audio_plugin_configure

```text
audio_plugin_configure()
audio_plugin_configure(generator="Ninja")
audio_plugin_configure(options="-DJUCE_DIR=/path/to/JUCE -DLV2_INCLUDE_DIR=/path/to/lv2/include")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `generator` | string, optional | CMake default on Windows, `Unix Makefiles` on POSIX. Common: `Ninja`, `Xcode` |
| `options` | string, optional | Space-separated `-DNAME=VALUE` flags; each becomes its own argv entry |

Only pass `-G` when creating a fresh cache; an existing cache created with a different generator must not be re-issued a `-G` flag, so `audio_plugin_build` handles reconfiguration itself.

### audio_plugin_build

```text
audio_plugin_build()
audio_plugin_build(config="Release", clean=true)
audio_plugin_build(target="MyPlugin_Standalone")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `target` | string, optional | Single CMake target, e.g. `MyPlugin_VST3` |
| `clean` | boolean, `false` | Rebuild from scratch |

Returns structured output with error and warning counts plus the first 20 of each. It configures `build/` automatically when the cache is missing, and reconfigures **single-config** caches (Ninja / Unix Makefiles) when you switch `Debug` ↔ `Release`. Multi-config generators simply receive `--config`.

### audio_plugin_test

```text
audio_plugin_test()
audio_plugin_test(config="Release", testName="MyPluginTest.*")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Falls back to `apc-mcp.json` → `Debug` |
| `testName` | string, optional | ctest `--tests-regex` |

Returns pass / failed / total. If ctest's output cannot be parsed, the tool says so instead of inventing counts.

### audio_plugin_lint

```text
audio_plugin_lint()
audio_plugin_lint(fix=true)
audio_plugin_lint(target="plugins/Foo/Source")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `fix` | boolean, `false` | `true` formats files in place; otherwise a dry-run report |
| `target` | string, optional | File or directory relative to the project root |

`target` is containment-checked: `..` segments, absolute paths outside the project, and symlinks escaping the project are rejected. Directory walks skip the build tree, `_tools/`, `node_modules/`, `CMakeFiles/` and `_deps/`. Requires `clang-format`.

### audio_plugin_plugins

```text
audio_plugin_plugins()
audio_plugin_plugins(format="json")
```

Lists directories under the configured `pluginsDir` that contain a `CMakeLists.txt`, with optional `status.json` metadata. `format` is `text` (default) or `json`. Symlinked `status.json` files are refused.

### audio_plugin_validate

```text
audio_plugin_validate()
audio_plugin_validate(format="VST3")
audio_plugin_validate(format="CLAP")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Auto-detected from CWD |
| `config` | `Debug` \| `Release` | Must match the build you ran |
| `format` | `VST3` \| `CLAP` \| `all` (default) | `all` uses `validateFormats` from `apc-mcp.json` |

Scans `<buildDir>/plugins/<Name>/<Name>_artefacts/<Config>/` and runs:

| Artefact | Validator | Result |
|---|---|---|
| VST3 | `validateCommand` (default `pluginval`) | Validated with `--strictness-level 10` |
| CLAP | `clapValidatorCommand` (default `clap-validator`) | Validated with the `validate` subcommand |
| LV2, AudioUnit, Standalone | none configured | **SKIPPED** — reported, not silently passed |

Skipped artefacts (including a missing validator binary) make the whole run `isError: true` with "Validation is **incomplete**". For LV2 Turtle/spec checks use external tools such as [sord_validate](https://gitlab.com/drobilla/sord) or [lv2lint](https://gitlab.com/OpenMusicKontrollers/lv2lint). `validateFormats` in `apc-mcp.json` may name LV2, AudioUnit or Standalone for artefact discovery, but no validator is run for them.

### audio_plugin_create

```text
audio_plugin_create(name="Phaser9000", type="clap")
audio_plugin_create(name="MyVerb", type="juce", vendor="MyCompany", formats="VST3;AU")
audio_plugin_create(name="MyVerb", type="juce", ui="webview", vendor="MyCompany")
audio_plugin_create(name="Lv2Gain", type="lv2", vendor="MyCompany")
audio_plugin_create(name="ToneGen", type="standalone", vendor="MyCompany")
```

| Argument | Type / default | Notes |
|---|---|---|
| `projectPath` | string, optional | Parent project root; auto-detected from CWD |
| `name` | **required**, `[A-Za-z][A-Za-z0-9_-]*` | Also the CMake target name; reserved names (`all`, `test`, `install`, …) are rejected |
| `type` | `clap` (default), `vst3`, `juce`, `lv2`, `standalone` | See the table below |
| `ui` | `generic` (default), `webview` | JUCE plugin types only; ignored elsewhere |
| `vendor` | `apc-mcp` | Embedded in plugin metadata |
| `description` | `An audio plugin` | Escaped separately for C++, CMake and LV2 Turtle |
| `formats` | JUCE default `VST3;LV2;Standalone` | Semicolon-separated override for `juce` / `vst3`; rejected for `clap`, `lv2`, `standalone` |

**`type` — which template**

| `type` | Template | What you get |
|---|---|---|
| `clap` *(default)* | `templates/clap/` | C++20 `MODULE` plugin against `free-audio/clap` headers, stereo `CLAP_EXT_AUDIO_PORTS`; a `.clap` binary (CFBundle on macOS) |
| `juce` | `templates/juce/` or `templates/juce-webview/` | Full `juce_add_plugin` project; `formats` accepts JUCE's `AU AUv3 AAX LV2 Standalone Unity VST VST3` |
| `vst3` | same JUCE templates | Convenience alias defaulting `formats` to `VST3` |
| `lv2` | `templates/lv2/` | Native **pure C11** LV2 plugin against `lv2/core/lv2.h` with `manifest.ttl` + `plugin.ttl`; unrelated to JUCE's C++ `LV2` format |
| `standalone` | `templates/standalone/` | A standalone GUI audio **application** (`juce_add_gui_app`), not a host-loadable plugin |

> `type="ara"` was removed in 2.0.0: it emitted `FORMATS ARA`, which `juce_add_plugin` does not accept, from a plain `juce::AudioProcessor`, so it reported success for a plugin that could never configure. ARA is a JUCE *effect mode* (`IS_ARA_EFFECT`), not a format. See the [roadmap](roadmap.md).

**`ui` — editor style (JUCE plugin types only)**

| `ui` | What you get |
|---|---|
| `generic` *(default)* | `juce::GenericAudioProcessorEditor` — sliders for every parameter, no UI code |
| `webview` | `juce::WebBrowserComponent` serving embedded HTML/CSS/JS from BinaryData, with a two-way bridge: C++ pushes `window.updateState(...)`, JS calls back via `apc://callback?action=...&data=...`. Edit `Source/UI/{index.html,style.css,app.js}` |

The webview template asks CMake for `NEEDS_WEB_BROWSER TRUE`, `NEEDS_WEBVIEW2 TRUE` and static WebView2 linking — WebView2 on Windows, WebKit on Linux, WKWebView on macOS. `clap` and `lv2` are headless DSP scaffolds; `standalone` ships its own `AudioAppComponent` window. All three ignore `ui`.

`create` also creates a minimal root `CMakeLists.txt` if needed and appends `add_subdirectory(plugins/<Name>)` once (it detects an existing registration and refuses to modify a symlinked root `CMakeLists.txt`). It does **not** install SDKs — see [Toolchain & SDKs](toolchain.md).
