# TODO

## ~~WebView UI Template~~ ✅ DONE

`audio_plugin_create(name="X", type="juce", ui="webview")` scaffolds a complete JUCE plugin with:
- `WebViewEditor` — `juce::WebBrowserComponent` with a JS↔C++ message bridge
- Embedded HTML/CSS/JS UI as BinaryData via `juce_add_binary_data()`, served to the browser through a JUCE 9 `ResourceProvider`
- Gain slider control with bidirectional parameter sync
- Dark theme matching common DAW aesthetics

## ~~`ui` parameter on `audio_plugin_create`~~ ✅ DONE

`generic` (default) or `webview`. Ignored by `clap` and `standalone`, which ship their own UI.

## ~~Standalone template~~ ✅ DONE

`audio_plugin_create(name="X", type="standalone")` scaffolds a standalone audio
**application** — `templates/standalone/`:

- `Source/Main.cpp` — a `juce::JUCEApplication` subclass plus its `DocumentWindow`,
  and `START_JUCE_APPLICATION()` (which generates `main()`; there is no other)
- `Source/MainComponent.{h,cpp}` — a `juce::AudioAppComponent` driving a 440 Hz
  sine generator with a level slider, sharing the level between the message and
  audio threads through a `std::atomic<float>`
- `CMakeLists.txt` — `juce_add_gui_app()`, which builds an **executable**
  (`add_executable` + `JUCE_STANDALONE_APPLICATION=1`), not a plugin library

Two JUCE 9 details the template gets right and older example code does not:

1. **`AudioAppComponent` has no `start()` and no `stop()` any more.**
   `setAudioChannels()` both initialises the device and starts the callback, and
   its counterpart is `shutdownAudio()`, which *must* be called from the derived
   destructor — the base class `jassert()`s otherwise ("If you hit this then your
   derived class must call shutdown audio in destructor!"). Most tutorials still
   circulating show `start()`/`stop()` and will not compile.
2. **An app target accepts no plugin keywords.** `juce_add_gui_app()` has no
   `UNPARSED_ARGUMENTS` check, so `FORMATS`, `PLUGIN_CODE` and `IS_SYNTH` would be
   dropped silently rather than reported. They are absent from the template, and
   `audio_plugin_create(type="standalone", formats=...)` is **rejected** rather
   than ignored — silently dropping an argument the user typed is the exact
   failure mode JUCE's CMake API has and this project refuses to copy.

---

## ~~LV2 template~~ ✅ DONE

`audio_plugin_create(name="X", type="lv2")` scaffolds a **native** LV2 plugin —
unrelated to JUCE's `LV2` format string, and with no JUCE dependency at all.
`templates/lv2/`:

- `Source/plugin.c` — the `LV2_Descriptor` plus `instantiate` / `connect_port` /
  `activate` / `run` / `deactivate` / `cleanup` / `extension_data`, and the
  exported `lv2_descriptor()`. A stereo gain stage with one control port.
- `Source/manifest.ttl` + `Source/plugin.ttl` — Turtle metadata
- `CMakeLists.txt` — a `MODULE` library emitted into the same
  `<build>/plugins/<name>/<name>_artefacts/<config>/LV2/<name>.lv2/` bundle layout
  that `audio_plugin_validate` already scans, with the `.ttl` files copied in
  beside the binary so the build output is a loadable bundle

Verified against the real LV2 sources (`lv2/core.lv2/lv2core.ttl` for the
vocabulary, `include/lv2/core/lv2.h` for the struct), and `plugin.c` is compiled
against the **real** upstream headers in CI (`APC_LV2_INCLUDE`), not a stub.

Three invariants that are easy to break silently, now enforced by tests:

1. The plugin URI is derived once in `index.js` and written into all three files,
   so the C descriptor, `manifest.ttl` and `plugin.ttl` cannot disagree.
2. Every `lv2:index`/`lv2:symbol` pair in `plugin.ttl` is checked against the
   enum and the `connect_port()` switch in `plugin.c` — a mismatch makes the host
   connect the gain value to an audio buffer, with no error anywhere.
3. `manifest.ttl`'s `rdfs:seeAlso` must name a file that was actually scaffolded.
   The first version of this template pointed at `<name>.ttl` while shipping
   `plugin.ttl`, so a host would have loaded the plugin with no metadata and
   reported nothing wrong; the test caught it.

---

---

## Template Expansion — remaining

Only one item is left.

### ARA template

**Goal:** `audio_plugin_create(name="X", type="ara")` scaffolds a JUCE ARA plugin.

`type: 'ara'` was **removed in 2.0.0** because it emitted `FORMATS ARA` — not a
valid `juce_add_plugin` format — from a plain `juce::AudioProcessor`, so it
reported success while scaffolding a plugin that could never configure. Do not
restore the enum value until the template below exists.

Verified against JUCE 9.0.3 (`extras/Build/CMake/JUCEUtils.cmake`,
`extras/Build/CMake/JUCEModuleSupport.cmake`,
`modules/juce_audio_processors_headless/utilities/ARA/`):

- **ARA is an effect mode, not a format.** Pass `IS_ARA_EFFECT TRUE` to
  `juce_add_plugin` alongside a real `FORMATS` list (typically `VST3;AU`). JUCE
  defaults it to `FALSE`. The related keywords are `ARA_FACTORY_ID`,
  `ARA_DOCUMENT_ARCHIVE_ID`, `ARA_COMPATIBLE_ARCHIVE_IDS`, `ARA_CONTENT_TYPES`
  and `ARA_TRANSFORMATION_FLAGS`; they become the `JucePlugin_ARA*` definitions.
- **There is no `juce::ARAAudioProcessor` and no `JUCE_ARRA_MODULE`** — both names
  appeared in this file before it was checked against the source, and neither
  exists. The real API is in `juce_AudioProcessor_ARAExtensions.h`: the processor
  derives from `juce::AudioProcessorARAExtension` (itself an
  `ARA::PlugIn::PlugInExtension`), the editor from
  `juce::AudioProcessorEditorARAExtension`, and you also provide an
  `ARADocumentControllerSpecialisation`. `ARAPlaybackRenderer`,
  `ARAEditorRenderer` and `ARAEditorView` are the roles to implement.
- **ARA needs an external SDK.** `juce_set_ara_sdk_path(<path>)` must be called
  *before* `juce_add_plugin`, or JUCE raises a fatal
  "Use juce_set_ara_sdk_path to specify the ARA SDK location." So the template
  needs an SDK-discovery block with a clear `FATAL_ERROR` message, mirroring how
  `templates/juce/CMakeLists.txt` handles `JUCE_DIR`.
- **Consequence for CI:** `scaffold-juce` cannot validate an ARA template without
  the ARA SDK present, so either the job fetches it or the ARA case is skipped
  with a reason. Plan for that before writing the template.

## Implementation order

1. ~~WebView UI template~~ ✅
2. ~~`ui` parameter~~ ✅
3. ~~Standalone application template~~ ✅
4. ~~LV2 template~~ ✅ — done, and compile-checked against the real headers
5. **ARA template** — the only one left. Blocked on an external SDK for both the
   template and its CI job, and on a large extension to
   `tests/fixtures/juce-api-stub` before it can be compile-checked at all

## Standing constraint on all template work

Every claim about a CMake keyword or a C++ API in a template must be checked
against real source, not memory. Two of this project's worst defects were
APIs that sound right and do not exist (`juce_add_webview_ui()`,
`WebBrowserComponent::loadHTMLString`). `HANDOFF.md` §3 has the clone commands
and §4 the red-phase method; `AUDIT.md` Phase 2 records what was wrong before.
