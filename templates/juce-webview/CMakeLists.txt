cmake_minimum_required(VERSION 3.22)
enable_language(C CXX)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

# ── JUCE ─────────────────────────────────────────────────────────────
# Guarded so a multi-plugin repo can add JUCE once from its root CMakeLists
# without this file adding it a second time.
if(NOT TARGET juce::juce_audio_utils)
    if(NOT JUCE_DIR)
        if(EXISTS "${CMAKE_SOURCE_DIR}/_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_SOURCE_DIR}/_tools/JUCE")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE")
        else()
            message(FATAL_ERROR
                "JUCE not found. Either add_subdirectory(JUCE) from the project root before "
                "adding this plugin, or configure with -DJUCE_DIR=/path/to/JUCE.")
        endif()
    endif()
    add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/_tools/JUCE" EXCLUDE_FROM_ALL)
endif()

# ── Plugin target ────────────────────────────────────────────────────
juce_add_plugin({{PLUGIN_NAME}}
    VERSION 1.0.0
    FORMATS {{PLUGIN_FORMATS}}
    PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"
    DESCRIPTION "{{PLUGIN_DESCRIPTION_CMAKE}}"
    # No COMPANY_WEBSITE / COMPANY_EMAIL: the vendor slug is lower-cased from a
    # display name, so any https://<vendor-slug>.com / dev@<vendor-slug>.com pair
    # would be a guess about a domain nobody has checked. Both fields are
    # displayed verbatim in the Windows DLL properties and the VST3/AU metadata,
    # so a wrong guess ships. Add them back once you own a real address.
    COMPANY_NAME "{{VENDOR_CMAKE}}"
    COMPANY_COPYRIGHT "{{VENDOR_CMAKE}} 2026"
    BUNDLE_ID "com.{{BUNDLE_VENDOR}}.{{PLUGIN_ID}}"
    # An LV2 plugin is identified by URI, and JUCE *derives* its default URI from
    # COMPANY_WEBSITE ("<website>/plugins/<name>"). Because this template sets no
    # website, that default is "/plugins/{{PLUGIN_ID}}" — no scheme — and JUCE's LV2
    # wrapper refuses to compile it: "Your configured LV2 URI must include a
    # leading scheme specifier". Set it explicitly, using the same `urn:` identity
    # the native LV2 template uses (`apc type="lv2"`), so both LV2
    # outputs of the scaffolder share one naming scheme.
    #
    # Treat this as permanent: hosts store the URI in saved sessions, and changing
    # it makes existing sessions fail to find the plugin. JUCE appends ":" plus a
    # suffix to it for the UI, state and per-parameter URIs, so it only has to be
    # unique per plugin, which the vendor namespace guarantees. Replace it with an
    # https:// URI if you own a domain you want the plugin to be identified by.
    LV2URI "{{PLUGIN_URI}}"
    PLUGIN_MANUFACTURER_CODE {{MANUFACTURER_CODE}}
    PLUGIN_CODE {{PLUGIN_CODE}}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    # WebView UI needs a browser backend: WebView2 on Windows, WebKit on Linux.
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    NEEDS_CURL FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
)

juce_generate_juce_header({{PLUGIN_NAME}})

target_sources({{PLUGIN_NAME}} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/WebViewEditor.cpp
    Source/WebViewEditor.h
)

target_compile_features({{PLUGIN_NAME}} PRIVATE cxx_std_20)

# ── Embedded HTML/CSS/JS UI ──────────────────────────────────────────
# juce_add_binary_data() is the real JUCE API. Its only keywords are the target
# name, NAMESPACE, HEADER_NAME and SOURCES — there is no BINARY_DATA_ID, and
# there is no juce_add_webview_ui() in JUCE at all.
#
# juce_add_binary_data() generates BinaryData.h onto its INTERFACE include path,
# declaring symbols in NAMESPACE {{PLUGIN_ID}}_UI: Source/UI/index.html becomes
# {{PLUGIN_ID}}_UI::index_html and {{PLUGIN_ID}}_UI::index_htmlSize.
juce_add_binary_data({{PLUGIN_NAME}}_WebData
    NAMESPACE {{PLUGIN_ID}}_UI
    SOURCES
        Source/UI/index.html
        Source/UI/style.css
        Source/UI/app.js
)

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    # Must be 1 — WebViewEditor uses juce::WebBrowserComponent.
    JUCE_WEB_BROWSER=1
    # Required on Windows alongside NEEDS_WEBVIEW2 TRUE so JUCE enables
    # JUCE_USE_WIN_WEBVIEW2 and JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE.
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    # NOT setting JUCE_MODAL_LOOPS_PERMITTED (JUCE default: 0) is the point:
    # the synchronous dialog helpers then refuse to compile, which is the
    # correct outcome for plugin code — a nested event loop started from a
    # host callback deadlocks the host. Use the ...Async variants.
    #
    # JUCE_DISPLAY_SCALE_ENABLED was deleted rather than kept: it stopped
    # existing in JUCE (0 references in the current tree), so defining it
    # only implied a behaviour that no longer exists.
)

target_link_libraries({{PLUGIN_NAME}}
    PRIVATE
        {{PLUGIN_NAME}}_WebData
        juce::juce_audio_utils
        juce::juce_gui_extra      # juce::WebBrowserComponent
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
