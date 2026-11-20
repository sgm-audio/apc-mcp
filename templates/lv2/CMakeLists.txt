cmake_minimum_required(VERSION 3.22)
enable_language(C)

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
    if(DEFINED ENV{HOME} AND NOT "$ENV{HOME}" STREQUAL "")
        file(TO_CMAKE_PATH "$ENV{HOME}/.apc-mcp/deps" APC_LV2_DEPS_CACHE)
    elseif(DEFINED ENV{USERPROFILE} AND NOT "$ENV{USERPROFILE}" STREQUAL "")
        file(TO_CMAKE_PATH "$ENV{USERPROFILE}/.apc-mcp/deps" APC_LV2_DEPS_CACHE)
    endif()
    # Fall back to a vendored copy or ~/.apc-mcp/deps/lv2, mirroring templates/clap.
    if(EXISTS "${CMAKE_SOURCE_DIR}/_tools/lv2/include/lv2/core/lv2.h")
        set(LV2_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/_tools/lv2/include")
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/lv2/include/lv2/core/lv2.h")
        set(LV2_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/lv2/include")
    elseif(APC_LV2_DEPS_CACHE AND EXISTS "${APC_LV2_DEPS_CACHE}/lv2/include/lv2/core/lv2.h")
        set(LV2_INCLUDE_DIR "${APC_LV2_DEPS_CACHE}/lv2/include")
    else()
        message(FATAL_ERROR
            "LV2 headers not found. Install them (Debian/Ubuntu: apt install lv2-dev; "
            "Arch: pacman -S lv2; macOS: brew install lv2), vendor lv2/lv2 at _tools/lv2 "
            "in the project root, populate ~/.apc-mcp/deps/lv2, or configure with "
            "-DLV2_INCLUDE_DIR=/path/containing/lv2.")
    endif()
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

# SYSTEM for the LV2 headers only: they are third-party code, and with
# -Werror below a warning inside them would stop the build. Our own Source/
# stays non-system so its warnings are ours to fix.
target_include_directories({{PLUGIN_NAME}} SYSTEM PRIVATE ${LV2_INCLUDE_DIR})
target_include_directories({{PLUGIN_NAME}} PRIVATE Source)

# ── Warning flags ────────────────────────────────────────────────────
# These compile clean today under -Wall -Wextra -Wpedantic (CI builds this
# template with the real headers on every push), and -Werror is what keeps that
# true: a scaffold that emits warnings on day one teaches its owner to ignore
# warnings on day two. Third-party headers are included as SYSTEM above, so a
# warning inside CLAP/LV2 itself is reported but never promoted to an error.
#
# If you find yourself wanting to switch -Werror off, prefer silencing the one
# diagnostic you have actually read: target_compile_options(... -Wno-<name>).
if(MSVC)
    target_compile_options({{PLUGIN_NAME}} PRIVATE /W4 /WX)
else()
    target_compile_options({{PLUGIN_NAME}} PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

# The artefact directory, split over two lines so the paths stay readable (and
# under cmake-lint's line limit). Mirrors CLAP_ARTEFACTS_DIR in templates/clap.
set(LV2_ARTEFACTS_DIR
    "${CMAKE_BINARY_DIR}/{{PLUGINS_DIR}}/{{PLUGIN_NAME}}/{{PLUGIN_NAME}}_artefacts/$<CONFIG>/LV2")
set(LV2_BUNDLE_DIR "${LV2_ARTEFACTS_DIR}/{{PLUGIN_NAME}}.lv2")

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
    # Emit into the same <build>/<pluginsDir>/<name>/<name>_artefacts/<config>/LV2
    # layout that audio_plugin_validate scans, so a scaffolded plugin can be
    # validated without the layout being hand-edited. LIBRARY_OUTPUT_DIRECTORY
    # is what applies to a MODULE library.
    LIBRARY_OUTPUT_DIRECTORY "${LV2_BUNDLE_DIR}"
    RUNTIME_OUTPUT_DIRECTORY "${LV2_BUNDLE_DIR}"
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
# LV2 hosts search a fixed set of directories; ${CMAKE_INSTALL_PREFIX}/lib/lv2
# (i.e. /usr/local/lib/lv2) and ~/.lv2 are the usual targets.
#
# DESTINATION must stay RELATIVE. An absolute DESTINATION is baked into
# cmake_install.cmake at configure time, so `cmake --install build --prefix X`
# silently installs into the configure-time path instead of X — this template
# used to expand ${CMAKE_INSTALL_PREFIX} here and did exactly that. With
# ${CMAKE_INSTALL_LIBDIR}/lv2 (lib on Debian, lib64 on Fedora) both the prefix
# option and -DCMAKE_INSTALL_PREFIX work. Override LV2_INSTALL_DIR only if you
# really want to defeat that, e.g. -DLV2_INSTALL_DIR=~/.lv2.
if(NOT DEFINED LV2_INSTALL_DIR)
    include(GNUInstallDirs)
    set(LV2_INSTALL_DIR "${CMAKE_INSTALL_LIBDIR}/lv2")
endif()

install(DIRECTORY "$<TARGET_FILE_DIR:{{PLUGIN_NAME}}>"
        DESTINATION "${LV2_INSTALL_DIR}"
        USE_SOURCE_PERMISSIONS)
