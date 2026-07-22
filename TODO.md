# TODO

## ~~WebView UI Template~~ ✅ DONE

`audio_plugin_create(name="X", type="juce", ui="webview")` now scaffolds a complete JUCE plugin with:
- `WebViewEditor` — `juce::WebBrowserComponent` with JS↔C++ message bridge
- Embedded HTML/CSS/JS UI via `juce_add_webview_ui()` BinaryData
- Gain slider control with bidirectional parameter sync
- Dark theme matching common DAW aesthetics
- `ui` parameter: `generic` (default) or `webview`

---

## Template Expansion

### ARA template

**Goal:** `audio_plugin_create(name="X", type="ara")` scaffolds a JUCE ARA plugin.

ARA plugins have a different base class (`juce::ARAAudioProcessor`) and need:
- `Source/PluginProcessor.h` — extends `ARAAudioProcessor` with `ARADocument`/`ARARegion` support
- `Source/PluginProcessor.cpp` — ARA lifecycle methods
- `Source/ARAEditor.h` — ARA-aware editor stub
- `CMakeLists.txt` — adds `JuceHeader` with `JUCE_ARRA_MODULE` enabled

### LV2 template

**Goal:** `audio_plugin_create(name="X", type="lv2")` scaffolds an LV2 plugin.

LV2 uses a C API with Turtle metadata:
- `Source/lv2/plugin.c` — LV2 descriptor + instantiate/connect_port/run
- `Source/lv2/manifest.ttl` — LV2 Turtle manifest
- `Source/lv2/plugin.ttl` — LV2 Turtle plugin description
- `CMakeLists.txt` — builds as shared lib, installs bundle
- No JUCE dependency — pure LV2

### Standalone template

**Goal:** `audio_plugin_create(name="X", type="standalone")` scaffolds a standalone (non-plugin) audio app.

- `Source/Main.cpp` — `juce::JUCEApplication` or raw audio I/O
- `Source/MainComponent.h/cpp` — Main content component
- `CMakeLists.txt` — builds as executable (not plugin)
- Uses JUCE's `juce::AudioAppComponent` for quick audio i/o

---

## Implementation Order

1. **WebView UI template** (highest value — modern standard for plugin UIs)
2. **`ui` parameter on `audio_plugin_create`** — wires webview vs generic choice
3. **Standalone template** (lowest effort — reuses JUCE scaffold)
4. **ARA template** (medium effort — different base class, ARA SDK dependency)
5. **LV2 template** (highest effort — no JUCE, pure LV2 C API + Turtle)
