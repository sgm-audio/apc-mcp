# Troubleshooting / FAQ

**A tool says `'cmake' not found on PATH` (or `clang-format`, `pluginval`, `clap-validator`).**
apc-mcp drives your system's toolchain rather than shipping one. The error names the binary, its purpose and an install hint. Install it and make sure it is on the `PATH` the MCP client passes to the server. See [Prerequisites](toolchain.md#prerequisites).

**A tool now reports failure where it used to report success.**
That is deliberate, and it is the 2.0.0 breaking change. Previously `apc-build`, `apc-lint`, `apc-test` and `apc-val` returned `isError: false` whenever the process *exited 0* — so a build that emitted compiler errors, or a validation that silently skipped because the validator was missing, reached the model as a success. They now return `isError: true` when the output shows errors or a step was skipped, and say which. Update any automation that branched on the old behaviour.

**`apc` said success — why does `apc-build` fail?**
`apc` registers `add_subdirectory(plugins/<Name>)` in the root `CMakeLists.txt` (creating one if needed) but does not install SDKs. Supply the matching SDK under `_tools/` or via a CMake flag. See [SDK discovery](toolchain.md#sdk-discovery). The generated `CMakeLists.txt` prints a clear `FATAL_ERROR` naming what it could not find.

**Why is an empty folder rejected?**
A project root must contain `apc-mcp.json` or `CMakeLists.txt` before anything is written, so a typo'd or injected `projectPath` cannot create a tree outside a real project. `echo '{}' > apc-mcp.json` is enough. See [Project root detection](configuration.md#project-root-detection).

**`apc-val` says a validator is missing.**
A validator *is* configured for the format (VST3 → `pluginval`, CLAP → `clap-validator`) but the binary is not on `PATH`. That is reported as `MISSING-VALIDATOR` with `isError: true`, because installing it would change the outcome. Install it, point `validateCommand` / `clapValidatorCommand` at it, or narrow `validateFormats` in `apc-mcp.json`.

**`apc-val` says "NOT CHECKABLE".**
No validator exists for that format (LV2, AudioUnit, Standalone). Nothing was attempted, so this is reported explicitly but does *not* set `isError` — there is no installation that would fix it. See [validator coverage](tools.md#apc-val).

**No plugin binaries found, or the SDK cannot be found under `_tools/`.**
The `_tools/` fallback assumes the default `pluginsDir`. If you moved it (e.g. `src/audio/plugins`), pass `-DJUCE_DIR=…` / `-DLV2_INCLUDE_DIR=…` via `apc-cfg`, or call `add_subdirectory()` from the root `CMakeLists.txt`. Also check that `config` matches the build you ran. See [Good-to-know quirks](toolchain.md#good-to-know-quirks).

**Does it work with VS Code / Cursor / Continue / Claude Code / OpenCode?**
Yes — any MCP client that can spawn a stdio server. Point it at `npx -y github:sgm-audio/apc-mcp` using that client's configuration shape; see [Getting started](getting-started.md#1-add-apc-mcp-to-your-mcp-client).

**How do I update to a new version?**
`npx` caches installs. Clear `~/.npm/_npx` (macOS/Linux) or `%LocalAppData%\npm-cache\_npx` (Windows), restart your MCP client, then check `npx -y github:sgm-audio/apc-mcp --version`.

**Which version should I use?**
Install from `github:sgm-audio/apc-mcp` (2.0.0) until it is tagged and published. `1.4.0` and `1.5.0` contain a path-traversal flaw in `apc-lint` and should not be used on untrusted inputs. See [Security](security.md).

**Can I use this with a non-JUCE / non-plugin project?**
Yes. `apc-cfg`, `apc-build`, `apc-test` and `apc-lint` work with any CMake-based C/C++ project. Only `apc` and `apc-val` are plugin-format-specific.

**A JUCE build fails on headless Linux while generating LV2 metadata.**
JUCE's `juce_lv2_helper` initialises GUI context during `POST_BUILD`. Run the build under `xvfb-run -a` and install JUCE's [Linux dependencies](https://github.com/juce-framework/JUCE/blob/9.0.3/docs/Linux%20Dependencies.md). See [Platform notes](toolchain.md#platform-notes).
