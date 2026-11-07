# Configuration

## `apc-mcp.json`

Drop this file in your project root to set defaults. Every key is optional; unknown keys are ignored (forward-compatible), invalid keys are rejected **individually** with a warning on stderr and fall back to their default, so one typo cannot discard the whole file. Invalid JSON warns and uses defaults.

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

| Key | Default | Allowed values | Used by |
|---|---|---|---|
| `generator` | `Unix Makefiles` on POSIX, CMake's platform default on Windows | CMake generator name | `configure` |
| `config` | `Debug` | `Debug`, `Release` | `configure`, `build`, `test`, `validate` |
| `buildDir` | `build` | Relative path, no `..` | `configure`, `build`, `test`, `validate` |
| `pluginsDir` | `plugins` | Relative path, no `..` | `create`, `plugins`, `validate` |
| `validateFormats` | `["VST3", "CLAP"]` | Non-empty array of `VST3`, `CLAP`, `LV2`, `AudioUnit`, `Standalone` | `validate(format="all")` |
| `validateCommand` | `pluginval` | Binary name (no path separators) | `validate` on VST3 |
| `clapValidatorCommand` | `clap-validator` | Binary name (no path separators) | `validate` on CLAP |

Precedence for `config` and `generator`: explicit tool argument → `apc-mcp.json` → built-in default. Binary names are resolved via `PATH`, never executed as paths — see [Security](security.md#residual-risk).

## Project root detection

Every tool resolves the project root the same way:

1. If `projectPath` is given, it is validated (no shell metacharacters, no `..` escapes) and resolved to an absolute path.
2. Otherwise, the server walks up from its working directory — at most 20 levels — looking for `apc-mcp.json` or `CMakeLists.txt`.
3. The resolved directory must exist, be a directory, and contain one of those markers. Anything else is rejected with an actionable message.

This is why an empty folder is refused rather than created: a typo'd or attacker-supplied `projectPath` must never cause writes outside a real project. The root `CMakeLists.txt` and all generated paths additionally pass through `assertWithinProject()`, which resolves symlinks.

## Expected layout

```text
my-plugin/
├── apc-mcp.json             # Optional per-project config AND a root marker
├── CMakeLists.txt           # Root CMake project (created by audio_plugin_create if absent)
├── _tools/                  # Optional vendored SDKs: JUCE/, clap/, lv2/
├── plugins/
│   ├── MyPlugin/
│   │   ├── CMakeLists.txt   # Per-plugin CMake target
│   │   ├── Source/
│   │   └── status.json      # Optional metadata read by audio_plugin_plugins
│   └── ...
├── common/                  # Optional shared sources
└── build/                   # Auto-created build tree
```

With `apc-mcp.json` present, `projectPath` is optional for every tool — useful when the MCP client starts the server inside the project. `audio_plugin_create` appends `add_subdirectory(plugins/<Name>)` to the root `CMakeLists.txt` (creating it with `cmake_minimum_required(VERSION 3.22)` and `project(AudioPlugins LANGUAGES C CXX)` when it is missing). It will not touch a symlinked root `CMakeLists.txt`.

## SDK-related CMake variables and environment variables

SDK paths are **not** `apc-mcp.json` keys. Pass them as CMake flags, add `add_subdirectory()` to your root `CMakeLists.txt`, or vendor under `_tools/` — see [SDK discovery](toolchain.md#sdk-discovery).

| Variable | Where | Purpose |
|---|---|---|
| `JUCE_DIR` (CMake `-D`) | JUCE templates | Path to a JUCE checkout |
| `LV2_INCLUDE_DIR` (CMake `-D`) | LV2 template | Directory containing `lv2/core/lv2.h` |
| `LV2_DIR` (CMake or env) | LV2 template | Hint for the same headers |
| `APC_LV2_DIR` (env) | LV2 template / smoke script | Hint for LV2 include directory |
| `APC_JUCE_DIR`, `APC_CLAP_DIR`, `APC_LV2_DIR` (env) | `scripts/smoke-scaffold.mjs` | Point `--configure` / `--build` at real SDK checkouts |
| `APC_CLAP_INCLUDE`, `APC_LV2_INCLUDE` (env) | `tests/cpp-api.test.js`, CI | Compile-check generated C/C++ against real upstream headers |

CLAP uses CMake's normal package search (`clap-config.cmake` / `CMAKE_PREFIX_PATH`). These variables are for maintainers running the full smoke suite; day-to-day users only need the vendored SDK or a `-D` flag.
