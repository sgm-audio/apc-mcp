# Changelog

## [1.5.0] — 2026-06-17

### Added
- **WebView UI template**: `audio_plugin_create(name="X", type="juce", ui="webview")` scaffolds a plugin with HTML/CSS/JS UI.
- **`ui` parameter** on `audio_plugin_create`: `generic` (JUCE's GenericAudioProcessorEditor) or `webview` (WebBrowserComponent with embedded UI).
- **JS↔C++ bridge**: `WebViewEditor` uses `pageAboutToLoad` URL interception for JS→C++ and `evaluateJavascript()` for C++→JS.
- **Dark theme UI**: Gain slider, meter visualization, all styled in modern DAW-compatible dark theme.

### Changed
- `mapPluginType()` now accepts `ui` parameter to select between `juce` and `juce-webview` templates.
- TODO.md updated with completion status.

## [1.4.0] — 2026-06-16

### Security (CRITICAL fixes)
- **Eliminated shell injection vector**: replaced all `execSync()` with `spawnSync()` + argument arrays. No user-supplied value ever reaches a shell interpreter. Previously, unquoted user input in `target`, `options`, `testName`, `generator`, and `projectPath` could be exploited via shell metacharacters (`;`, `$()`, backticks) if an attacker controlled tool arguments (e.g. via prompt injection).
- **Input validation**: zod `.regex()` constraints on all user-controlled string parameters (`target`, `options`, `testName`, `generator`, `name`, `vendor`, `projectPath`). Invalid inputs are rejected at the schema level before handlers run.
- **Path traversal protection**: `checkPluginPath()` ensures `audio_plugin_create` writes only within the project boundary. Rejects paths containing `..` that escape the project root.
- **No shell pipeline for lint**: replaced `find | xargs` pipe with Node.js `fs.readdirSync` recursive walk. Eliminates the only remaining shell invocation in the codebase.

### Changed
- All child process execution uses `spawnSync()` with explicit argument arrays — no `/bin/sh` involved
- `maxBuffer` limit on all process output (2MB) prevents memory exhaustion from large build logs
- Test fixtures auto-clean before each run

## [1.3.0] — 2026-06-16

### UX improvements
- **Smart project discovery**: walks up parent directories looking for `apc-mcp.json` or `CMakeLists.txt`. Run from any subdirectory in your project.
- **Prerequisite checking**: when cmake/clang-format/pluginval/clap-validator are missing, the tool tells you exactly how to install them instead of throwing a cryptic error.
- **Better error messages**: `tryRun` distinguishes "command not found" from "command failed" and gives actionable instructions.
- **Safe file finding**: lint uses `find -print0 | xargs -0` to handle filenames with spaces.
- **Richer tool descriptions**: every parameter has a detailed description so the LLM understands what it does without guessing.

### Changed
- Server version bumped to 1.3.0

## [1.2.0] — 2026-06-16

### Added
- **Logo**: SVG banner in README with dark/light mode support
- **.editorconfig**: Standardized editor settings
- **Issue templates**: Bug report + feature request templates in `.github/ISSUE_TEMPLATE/`
- **Dependabot**: Weekly automated dependency updates for npm + GitHub Actions
- **CodeQL**: Security analysis workflow
- **SECURITY.md**: Vulnerability reporting policy
- **CI matrix**: Tests run on Node 18, 20, and 22 in parallel
- **Lint step**: `node --check index.js` in CI to catch syntax errors
- **FAQ / Troubleshooting** section in README
- **Semantic versioning** policy documented

### Changed
- README restructured with banner, badges, nav links, and cleaner tool docs
- CI workflow renamed to "CI" (was "CI / Publish"), publish step uses `continue-on-error`
- package.json: added `lint` script

## [1.1.1] — 2026-06-16

### Changed
- Primary install method now uses `npx github:sgm-audio/apc-mcp` — no npm account needed
- Updated README, AGENTS_REFERENCE, meta-orchestrator to reflect GitHub-based install
- Switched local opencode config to `npx github:` method

## [1.1.0] — 2026-06-16

### Added
- `audio_plugin_create` — Scaffold new CLAP or JUCE plugins from templates
- `audio_plugin_validate` — Run pluginval (VST3) and clap-validator on built binaries
- Config system: `apc-mcp.json` per-project defaults for generator, buildDir, validateFormats, etc.
- CWD auto-detection: `projectPath` optional when `apc-mcp.json` present
- Structured output: parsed error/warning counts, test pass/fail summary, `format=json` for plugins
- Test suite: 11 tests using Node `node:test` — zero dependencies
- CHANGELOG.md, CONTRIBUTING.md
- Updated CI workflow with proper test step

## [1.0.0] — 2026-06-16

### Added
- Initial release
- `audio_plugin_build` — CMake configure + build
- `audio_plugin_configure` — CMake configure with custom generator/flags
- `audio_plugin_test` — ctest runner
- `audio_plugin_lint` — clang-format check/auto-fix
- `audio_plugin_plugins` — List project plugins with metadata
- MIT licensed**
