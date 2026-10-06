cmake_minimum_required(VERSION 3.22)

# ── JUCE ─────────────────────────────────────────────────────────────
# A multi-app repo adds JUCE once from the root CMakeLists, so guard on the
# module target. Without this guard, a second scaffolded app would call
# add_subdirectory(JUCE) again and fail with duplicate juce::* target errors
# (and a colliding binary directory).
if(NOT TARGET juce::juce_audio_utils)
    if(NOT JUCE_DIR)
        if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE")
        else()
            message(FATAL_ERROR
                "JUCE not found. Either add_subdirectory(JUCE) from the project root before "
                "adding this app, or configure with -DJUCE_DIR=/path/to/JUCE.")
        endif()
    endif()
    add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/_tools/JUCE EXCLUDE_FROM_ALL)
endif()

# ── App target ───────────────────────────────────────────────────────
# juce_add_gui_app() creates an *executable* — add_executable() plus
# JUCE_STANDALONE_APPLICATION=1 — not a plugin library. This is a standalone
# audio application: it owns its audio device through AudioAppComponent instead
# of being driven by a host.
#
# The target name is literal rather than ${PROJECT_NAME}: this file is a
# subdirectory of the host project, so PROJECT_NAME belongs to that project and
# every scaffolded app would otherwise collide on the same target name.
#
# Plugin-only keywords are deliberately absent. FORMATS is parsed by
# juce_add_plugin() and never by an app target, and although
# _juce_initialise_target() does parse PLUGIN_CODE / IS_SYNTH /
# NEEDS_MIDI_INPUT, nothing consumes them for an app. JUCE performs no
# UNPARSED_ARGUMENTS check, so a keyword that does not apply is silently
# dropped rather than reported — which is exactly why they are not here.
juce_add_gui_app({{PLUGIN_NAME}}
    VERSION 1.0.0
    PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"
    COMPANY_NAME "{{VENDOR}}"
    COMPANY_WEBSITE "https://{{VENDOR}}.com"
    COMPANY_EMAIL "dev@{{VENDOR}}.com"
    COMPANY_COPYRIGHT "{{VENDOR}} 2026"
    BUNDLE_ID "com.{{VENDOR}}.{{PLUGIN_ID}}"
    NEEDS_WEB_BROWSER FALSE
    NEEDS_CURL FALSE
    # Add these if you read a live input rather than only generating audio:
    #   MICROPHONE_PERMISSION_ENABLED TRUE
    #   MICROPHONE_PERMISSION_TEXT "This app needs microphone access."
)

# Generates JuceHeader.h into the build tree and puts it on this target's
# include path, which is what `#include <JuceHeader.h>` in Source/ resolves to.
# It also defines namespace ProjectInfo { projectName, companyName,
# versionString, versionNumber }, which Source/Main.cpp reads.
juce_generate_juce_header({{PLUGIN_NAME}})

target_sources({{PLUGIN_NAME}} PRIVATE
    Source/Main.cpp
    Source/MainComponent.cpp
    Source/MainComponent.h
)

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_DISPLAY_SCALE_ENABLED=1
)

# Without this the target has no JUCE modules attached and every juce:: symbol
# in Source/ is undefined at compile time. juce_audio_utils provides
# AudioAppComponent and pulls in juce_gui_basics (Component, DocumentWindow,
# Slider, Label), juce_events (JUCEApplication, START_JUCE_APPLICATION) and
# juce_audio_basics (AudioBuffer, AudioSource) through its own module
# dependencies, so no further modules are needed.
target_link_libraries({{PLUGIN_NAME}}
    PRIVATE
        juce::juce_audio_utils
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
