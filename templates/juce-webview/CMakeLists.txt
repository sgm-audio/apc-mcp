cmake_minimum_required(VERSION 3.22)

if(NOT JUCE_DIR)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE/CMakeLists.txt")
        set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE")
    else()
        message(FATAL_ERROR "JUCE_DIR not set. Pass -DJUCE_DIR=/path/to/JUCE")
    endif()
endif()

add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/_tools/JUCE)

juce_add_plugin(${PROJECT_NAME}
    PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"
    FORMATS {{PLUGIN_FORMATS}}
    COMPANY_NAME "{{VENDOR}}"
    COMPANY_WEBSITE "https://{{VENDOR}}.com"
    COMPANY_EMAIL "dev@{{VENDOR}}.com"
    VERSION "1.0.0"
    DESCRIPTION "{{PLUGIN_DESCRIPTION}}"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANT_KEYBOARD_FOCUS FALSE
    COPYRIGHT "{{VENDOR}} 2026"
)

juce_generate_juce_header(${PROJECT_NAME})

target_sources(${PROJECT_NAME} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/WebViewEditor.cpp
    Source/WebViewEditor.h
)

# Embed UI as compiled binary resource
juce_add_webview_ui(${PROJECT_NAME}
    BINARY_DATA_ID {{PLUGIN_ID}}_UI
    SOURCES
        Source/UI/index.html
        Source/UI/style.css
        Source/UI/app.js
)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_DISPLAY_SCALE_ENABLED=1
)
