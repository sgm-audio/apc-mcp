cmake_minimum_required(VERSION 3.22)
enable_language(C CXX)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

# ── JUCE ─────────────────────────────────────────────────────────────
# A multi-plugin repo adds JUCE once from the root CMakeLists, so guard on the
# module target. Without this guard, a second scaffolded plugin would call
# add_subdirectory(JUCE) again and fail with duplicate juce::* target errors
# (and a colliding binary directory).
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
# The target name is literal rather than ${PROJECT_NAME}: this file is a
# subdirectory of the host project, so PROJECT_NAME belongs to that project and
# every scaffolded plugin would otherwise collide on the same target name.
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
    # the native LV2 template uses (`audio_plugin_create type="lv2"`), so both LV2
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

target_compile_features({{PLUGIN_NAME}} PRIVATE cxx_std_20)

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    JUCE_WEB_BROWSER=0
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
