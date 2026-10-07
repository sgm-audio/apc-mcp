cmake_minimum_required(VERSION 3.22)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

# ── LV2 headers ──────────────────────────────────────────────────────
# LV2 core is header-only: lv2/core/lv2.h defines LV2_Descriptor, LV2_Handle
# and LV2_Feature, and there is no library to link. All that is needed is the
# include directory that *contains* `lv2/`.
#
# On Linux `pkg-config --cflags lv2` usually yields /usr/include, and many
# distros install the headers there already, so the find_path below succeeds with
# no help. Pass -DLV2_INCLUDE_DIR=/path/to/lv2/include to override.
find_path(LV2_INCLUDE_DIR
    NAMES lv2/core/lv2.h
    HINTS ${LV2_DIR} ${LV2_INCLUDE_DIR} ENV APC_LV2_DIR ENV LV2_DIR
    PATH_SUFFIXES include lv2
    DOC "Directory that contains lv2/core/lv2.h")

if(NOT LV2_INCLUDE_DIR)
    # Fall back to a vendored copy, mirroring how templates/clap handles clap.
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/lv2/include/lv2/core/lv2.h")
        set(LV2_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/lv2/include")
    else()
        message(FATAL_ERROR
            "LV2 headers not found. Install them (Debian/Ubuntu: apt install lv2-dev; "
            "Arch: pacman -S lv2; macOS: brew install lv2), vendor lv2/lv2 at _tools/lv2 "
            "in the project root, or configure with -DLV2_INCLUDE_DIR=/path/containing/lv2.")
    endif()
endif()

# ── Language ─────────────────────────────────────────────────────────
# This file may be add_subdirectory()'d into a host whose project() only
# enables CXX (a JUCE host would never enable C), but plugin.c is C — without
# this, configuring under such a host fails with "Cannot determine link
# language for target". CMake normally enables C and CXX from an implicit
# project(), so standalone scaffolds already have C; only the embedded case
# needs the explicit enable_language.
get_property(_lv2_host_langs GLOBAL PROPERTY ENABLED_LANGUAGES)
if(NOT C IN_LIST _lv2_host_langs)
    enable_language(C)
endif()

# ── Plugin target ────────────────────────────────────────────────────
# MODULE, not SHARED: an LV2 binary is dlopen'd by the host and never linked
# against, so there is no import library to produce.
#
# Literal target name, not ${PROJECT_NAME}: this file is a subdirectory of the
# host project, so PROJECT_NAME belongs to that project and every scaffolded
# plugin would otherwise collide on the same target name.
add_library({{PLUGIN_NAME}} MODULE
    Source/plugin.c
)

target_include_directories({{PLUGIN_NAME}} PRIVATE ${LV2_INCLUDE_DIR} Source)

set_target_properties({{PLUGIN_NAME}} PROPERTIES
    OUTPUT_NAME "{{PLUGIN_NAME}}"
    # PREFIX "" and SUFFIX ".so" pin the filename on every platform, because
    # manifest.ttl names it literally as `lv2:binary <{{PLUGIN_NAME}}.so>`. LV2
    # hosts load that file through the platform's dynamic loader (dlopen /
    # LoadLibrary), which does not care about the extension, so a single name
    # keeps the C descriptor, the Turtle metadata and the built file in
    # agreement without a per-platform configure step. Dropping either property
    # would produce lib{{PLUGIN_NAME}}.so on Linux and {{PLUGIN_NAME}}.dylib on
    # macOS, and the bundle would silently fail to load.
    PREFIX ""
    SUFFIX ".so"
    # Emit into the same <build>/plugins/<name>/<name>_artefacts/<config>/LV2
    # layout that audio_plugin_validate scans, so a scaffolded plugin can be
    # validated without the layout being hand-edited. LIBRARY_OUTPUT_DIRECTORY
    # is what applies to a MODULE library.
    LIBRARY_OUTPUT_DIRECTORY
        "${CMAKE_BINARY_DIR}/plugins/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/LV2/{{PLUGIN_NAME}}.lv2"
)

# An LV2 bundle is a *directory*: the binary plus its Turtle metadata, all at
# the bundle root. Copying the .ttl files next to the binary is what makes the
# build output a loadable bundle rather than a stray shared object.
add_custom_command(TARGET {{PLUGIN_NAME}} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/Source/manifest.ttl"
        "${CMAKE_CURRENT_SOURCE_DIR}/Source/plugin.ttl"
        "$<TARGET_FILE_DIR:{{PLUGIN_NAME}}>"
    COMMENT "Copying LV2 metadata into {{PLUGIN_NAME}}.lv2"
    VERBATIM)

# ── Install ──────────────────────────────────────────────────────────
# LV2 hosts search a fixed set of directories; ~/.lv2 and
# ${CMAKE_INSTALL_PREFIX}/lib/lv2 are the usual targets. Override with
# -DLV2_INSTALL_DIR=/usr/local/lib/lv2 (or /Library/Audio/Plug-Ins/LV2 on
# macOS) if your setup differs.
if(NOT DEFINED LV2_INSTALL_DIR)
    set(LV2_INSTALL_DIR "${CMAKE_INSTALL_PREFIX}/lib/lv2")
endif()

install(DIRECTORY "$<TARGET_FILE_DIR:{{PLUGIN_NAME}}>"
        DESTINATION "${LV2_INSTALL_DIR}"
        USE_SOURCE_PERMISSIONS)
