cmake_minimum_required(VERSION 3.22)

# ── JUCE ─────────────────────────────────────────────────────────────
# A multi-plugin repo adds JUCE once from the root CMakeLists, so guard on the
# module target. Without this guard, a second scaffolded plugin would call
# add_subdirectory(JUCE) again and fail with duplicate juce::* target errors
# (and a colliding binary directory).
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
# The target name is literal rather than ${PROJECT_NAME}: this file is a
# subdirectory of the host project, so PROJECT_NAME belongs to that project and
# every scaffolded plugin would otherwise collide on the same target name.
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
    NEEDS_WEB_BROWSER FALSE
    NEEDS_CURL FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
)

# Generates JuceHeader.h into the build tree and puts it on this target's
# include path, which is what `#include <JuceHeader.h>` in Source/ resolves to.
juce_generate_juce_header({{PLUGIN_NAME}})

target_sources({{PLUGIN_NAME}} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
)

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_DISPLAY_SCALE_ENABLED=1
)

# Without this the target has no JUCE modules attached and every juce:: symbol
# in Source/ is undefined at compile time. Inter-module dependencies (juce_core,
# juce_events, juce_graphics, juce_data_structures, juce_audio_processors, ...)
# are resolved automatically from juce_audio_utils.
target_link_libraries({{PLUGIN_NAME}}
    PRIVATE
        juce::juce_audio_utils
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
