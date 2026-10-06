cmake_minimum_required(VERSION 3.22)

# ── JUCE ─────────────────────────────────────────────────────────────
# Guarded so a multi-plugin repo can add JUCE once from its root CMakeLists
# without this file adding it a second time.
if(NOT TARGET juce::juce_audio_utils)
    if(NOT JUCE_DIR)
        if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE")
        else()
            message(FATAL_ERROR
                "JUCE not found. Either add_subdirectory(JUCE) from the project root before "
                "adding this plugin, or configure with -DJUCE_DIR=/path/to/JUCE.")
        endif()
    endif()
    add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/_tools/JUCE EXCLUDE_FROM_ALL)
endif()

# ── Plugin target ────────────────────────────────────────────────────
juce_add_plugin({{PLUGIN_NAME}}
    VERSION 1.0.0
    FORMATS {{PLUGIN_FORMATS}}
    PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"
    DESCRIPTION "{{PLUGIN_DESCRIPTION}}"
    COMPANY_NAME "{{VENDOR}}"
    COMPANY_WEBSITE "https://{{VENDOR}}.com"
    COMPANY_EMAIL "dev@{{VENDOR}}.com"
    COMPANY_COPYRIGHT "{{VENDOR}} 2026"
    BUNDLE_ID "com.{{VENDOR}}.{{PLUGIN_ID}}"
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

# ── Embedded HTML/CSS/JS UI ──────────────────────────────────────────
# juce_add_binary_data() is the real JUCE API. Its only keywords are the target
# name, NAMESPACE, HEADER_NAME and SOURCES — there is no BINARY_DATA_ID, and
# there is no juce_add_webview_ui() in JUCE at all.
#
# NAMESPACE must match the forward declaration in Source/WebViewEditor.cpp:
#     namespace {{PLUGIN_ID}}_UI { extern const char *index_html; ... }
# juceaide derives each symbol from the filename, so Source/UI/index.html becomes
# {{PLUGIN_ID}}_UI::index_html / index_html_size.
juce_add_binary_data({{PLUGIN_ID}}_WebData
    NAMESPACE {{PLUGIN_ID}}_UI
    SOURCES
        Source/UI/index.html
        Source/UI/style.css
        Source/UI/app.js
)

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    # Must be 1 — WebViewEditor uses juce::WebBrowserComponent.
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_DISPLAY_SCALE_ENABLED=1
)

target_link_libraries({{PLUGIN_NAME}}
    PRIVATE
        {{PLUGIN_ID}}_WebData
        juce::juce_audio_utils
        juce::juce_gui_extra      # juce::WebBrowserComponent
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
