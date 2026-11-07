# Roadmap

Everything documented here used to live in a root `TODO.md` dominated by completed items. This is the current, rewritten version.

## Completed

| Feature | Where it lives now |
|---|---|
| WebView UI template (`ui="webview"`) with a JS↔C++ bridge and embedded BinaryData UI | `templates/juce-webview/` |
| `ui` parameter on `audio_plugin_create` | [Tool reference](tools.md#audio_plugin_create) |
| Standalone application template (`type="standalone"`, `juce_add_gui_app`) | `templates/standalone/` |
| Native LV2 template (`type="lv2"`, pure C11 + Turtle metadata) | `templates/lv2/` |
| CLAP and JUCE/VST3 scaffolds, security fixes, honest failure reporting, CI and release gates | [Project status](project-status.md), [CHANGELOG.md](../CHANGELOG.md) |

## Remaining: ARA template

**Goal:** `audio_plugin_create(name="X", type="ara")` scaffolds a JUCE ARA plugin.

`type="ara"` was **removed in 2.0.0** because it emitted `FORMATS ARA` — not a valid `juce_add_plugin` format — from a plain `juce::AudioProcessor`, so it reported success while scaffolding a plugin that could never configure. Do not restore the enum value until the template below exists.

Verified against JUCE 9.0.3 (`extras/Build/CMake/JUCEUtils.cmake`, `JUCEModuleSupport.cmake`, `modules/juce_audio_processors_headless/utilities/ARA/`):

- **ARA is an effect mode, not a format.** Pass `IS_ARA_EFFECT TRUE` alongside a real `FORMATS` list (typically `VST3;AU`). Related keywords: `ARA_FACTORY_ID`, `ARA_DOCUMENT_ARCHIVE_ID`, `ARA_COMPATIBLE_ARCHIVE_IDS`, `ARA_CONTENT_TYPES`, `ARA_TRANSFORMATION_FLAGS`.
- **There is no `juce::ARAAudioProcessor` and no `JUCE_ARRA_MODULE`.** The real API is in `juce_AudioProcessor_ARAExtensions.h`: the processor derives from `juce::AudioProcessorARAExtension`, the editor from `juce::AudioProcessorEditorARAExtension`, and you provide an `ARADocumentControllerSpecialisation`. `ARAPlaybackRenderer`, `ARAEditorRenderer` and `ARAEditorView` are the roles to implement.
- **ARA needs an external SDK.** `juce_set_ara_sdk_path(<path>)` must run *before* `juce_add_plugin` or JUCE raises a fatal error. The template therefore needs an SDK-discovery block with a clear `FATAL_ERROR`, mirroring `templates/juce/CMakeLists.txt`'s `JUCE_DIR` handling.
- **CI consequence:** `scaffold-juce` cannot validate an ARA template without the ARA SDK. Either fetch it in CI or skip the ARA case with an explicit reason — a silent skip must never read as a pass.
- **Test consequence:** `tests/fixtures/juce-api-stub/` needs a substantial ARA surface before the generated C++ can be compile-checked.

Implementation order: SDK discovery → template + `IS_ARA_EFFECT` wiring → fixture + compile checks → enum value + docs → CI case.

## Standing constraint

Every claim about a CMake keyword or C++ API in a template must be checked against real source, not memory. Two of this project's worst defects were APIs that sound right and do not exist (`juce_add_webview_ui()`, `WebBrowserComponent::loadHTMLString`). Write the failing test first — see [Development](development.md#adding-a-tool) and [Maintainer traps](project-status.md#maintainer-traps). The original findings are preserved in [archive/AUDIT.md](archive/AUDIT.md).
