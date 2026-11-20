# Roadmap

Everything documented here used to live in a root `TODO.md` dominated by completed items. This is the current, rewritten version.

## Completed

| Feature | Where it lives now |
|---|---|
| WebView UI template (`ui="webview"`) with a JS↔C++ bridge and embedded BinaryData UI | `templates/juce-webview/` |
| `ui` parameter on `audio_plugin_create` | [Tool reference](tools.md#audio_plugin_create) |
| Standalone application template (`type="standalone"`, `juce_add_gui_app`) | `templates/standalone/` |
| Native LV2 template (`type="lv2"`, pure C11 + Turtle metadata) | `templates/lv2/` |
| JUCE ARA effect scaffold (`type="ara"`, `IS_ARA_EFFECT TRUE`, external SDK guard, ARA processor/editor extensions, playback renderer and document-controller factory) | `templates/ara/` |
| CLAP and JUCE/VST3 scaffolds, security fixes, honest failure reporting, CI and release gates | [Project status](project-status.md), [CHANGELOG.md](../CHANGELOG.md) |

The ARA type is a JUCE **effect mode**, not a plugin format. It emits actual `VST3 AU` formats and rejects a caller-supplied `formats` override. The generated CMake requires `APC_ARA_SDK_PATH` to point to an initialized SDK root containing the `ARA_Library` and `ARA_API` headers, calls `juce_set_ara_sdk_path(...)` before `juce_add_plugin(...)`, and exits early with `FATAL_ERROR` when the SDK path is unset, empty, or incomplete.

The generated pass-through renderer reads ARA audio-source regions, uses JUCE's buffered reader for realtime playback, and linearly resamples source samples to the host playback rate. The external SDK is not bundled; full platform CMake configure/build validation requires a local ARA SDK and JUCE's system build dependencies.

## Standing constraint

Every claim about a CMake keyword or C++ API in a template must be checked against real source, not memory. Two of this project's worst defects were APIs that sound right and do not exist (`juce_add_webview_ui()`, `WebBrowserComponent::loadHTMLString`). Write the failing test first — see [Development](development.md#adding-a-tool) and [Maintainer traps](project-status.md#maintainer-traps). The original findings are preserved in [archive/AUDIT.md](archive/AUDIT.md).
