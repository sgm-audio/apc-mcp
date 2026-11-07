cmake_minimum_required(VERSION 3.22)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

# ── CLAP headers ─────────────────────────────────────────────────────
# free-audio/clap installs its package file as `clap-config.cmake` and exports a
# plain INTERFACE target named `clap`. There is no `CLAPConfig.cmake` and no
# `CLAP::clap` namespace, so `find_package(CLAP CONFIG REQUIRED)` fails outright
# on case-sensitive filesystems and `CLAP::clap` never resolves.
find_package(clap CONFIG QUIET)

if(NOT TARGET clap)
    # Fall back to a vendored copy, the usual arrangement for plugin repos.
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/clap/CMakeLists.txt")
        add_subdirectory(
            "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/clap"
            "${CMAKE_BINARY_DIR}/_tools/clap"
            EXCLUDE_FROM_ALL)
    else()
        message(FATAL_ERROR
            "CLAP headers not found. Either vendor free-audio/clap at _tools/clap in the "
            "project root, add_subdirectory() it yourself, or install it so that "
            "clap-config.cmake is on CMAKE_PREFIX_PATH.")
    endif()
endif()

# ── Plugin target ────────────────────────────────────────────────────
# MODULE, not SHARED: a CLAP binary is loaded dynamically (dlopen / LoadLibrary /
# CFBundle) and never linked against.
#
# Literal target name, not ${PROJECT_NAME}: this file is a subdirectory of the
# host project, so PROJECT_NAME belongs to that project and every scaffolded
# plugin would otherwise collide on the same target name.
add_library({{PLUGIN_NAME}} MODULE
    Source/PluginEntry.cpp
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
)

target_link_libraries({{PLUGIN_NAME}} PRIVATE clap)
target_include_directories({{PLUGIN_NAME}} PRIVATE Source)

# Emit into <build>/plugins/<name>/<name>_artefacts/<config>/CLAP/<name>.clap,
# matching the layout audio_plugin_validate scans:
#   - macOS: a CFBundle directory (<name>.clap/Contents/MacOS/<name>)
#   - Linux & Windows: a single shared object renamed <name>.clap
set(CLAP_ARTEFACTS_DIR
    "${CMAKE_BINARY_DIR}/plugins/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/CLAP")

if(APPLE)
    set_target_properties({{PLUGIN_NAME}} PROPERTIES
        OUTPUT_NAME "{{PLUGIN_NAME}}"
        BUNDLE TRUE
        BUNDLE_EXTENSION clap
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.{{VENDOR}}.{{PLUGIN_ID}}"
        MACOSX_BUNDLE_BUNDLE_NAME "{{PLUGIN_DISPLAY_NAME}}"
        LIBRARY_OUTPUT_DIRECTORY "${CLAP_ARTEFACTS_DIR}"
    )
else()
    set_target_properties({{PLUGIN_NAME}} PROPERTIES
        OUTPUT_NAME "{{PLUGIN_NAME}}"
        PREFIX ""
        SUFFIX ".clap"
        LIBRARY_OUTPUT_DIRECTORY "${CLAP_ARTEFACTS_DIR}"
        RUNTIME_OUTPUT_DIRECTORY "${CLAP_ARTEFACTS_DIR}"
    )
endif()
