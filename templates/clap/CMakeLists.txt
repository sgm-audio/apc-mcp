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
# Literal target name, not ${PROJECT_NAME}: this file is a subdirectory of the
# host project, so PROJECT_NAME belongs to that project and every scaffolded
# plugin would otherwise collide on the same target name.
add_library({{PLUGIN_NAME}} MODULE
    Source/PluginEntry.cpp
    Source/PluginProcessor.cpp
)

target_link_libraries({{PLUGIN_NAME}} PRIVATE clap)
target_include_directories({{PLUGIN_NAME}} PRIVATE Source)

set_target_properties({{PLUGIN_NAME}} PROPERTIES
    OUTPUT_NAME "{{PLUGIN_NAME}}"
)

if(APPLE)
    # A macOS CLAP is a bundle. Keep its output directory distinct; producing
    # the final Contents/MacOS layout requires platform bundle packaging.
    set_target_properties({{PLUGIN_NAME}} PROPERTIES
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/CLAP/{{PLUGIN_NAME}}.clap"
    )
else()
    # On Linux and Windows a .clap plugin is the shared library itself, not a
    # directory containing lib<name>.so or <name>.dll. Remove CMake's platform
    # prefix/suffix so validation and hosts discover exactly <name>.clap.
    set_target_properties({{PLUGIN_NAME}} PROPERTIES
        PREFIX ""
        SUFFIX ".clap"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/CLAP"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/CLAP"
    )
endif()

# NOTE: packaging a macOS bundle correctly needs an extra POST_BUILD step — see
# the CLAP docs before shipping a macOS build.
