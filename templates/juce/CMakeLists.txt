cmake_minimum_required(VERSION 3.22)
enable_language(C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

# ── Portability & Packaging options ──────────────────────────────────
# Statically link the MSVC runtime (/MT in Release, /MTd in Debug) so shipped
# Windows plugins do not depend on a matching Visual C++ Redistributable.
if(POLICY CMP0091)
    cmake_policy(SET CMP0091 NEW)
endif()
if(MSVC AND NOT DEFINED CMAKE_MSVC_RUNTIME_LIBRARY)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# Support universal macOS binaries (arm64;x86_64) when targeting distribution,
# either via -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" or -DAPC_MACOS_UNIVERSAL=ON.
option(APC_MACOS_UNIVERSAL
    "Build universal arm64;x86_64 binaries on macOS for distribution" OFF)
if(APPLE AND APC_MACOS_UNIVERSAL AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING
        "macOS target architectures" FORCE)
endif()

# Plain JUCE scaffolds do not enable JIVE (never fetched, linked, or added to
# include paths). Avoid caching a global APC_USE_JIVE=OFF here so sibling
# ui="jive" plugins in a multi-plugin repository keep their own APC_USE_JIVE=ON.

# ── Global dependency cache (~/.apc-mcp/deps/) ───────────────────────
if(DEFINED ENV{HOME} AND NOT "$ENV{HOME}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{HOME}/.apc-mcp/deps" APC_DEFAULT_DEPS_CACHE)
elseif(DEFINED ENV{USERPROFILE} AND NOT "$ENV{USERPROFILE}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{USERPROFILE}/.apc-mcp/deps" APC_DEFAULT_DEPS_CACHE)
else()
    set(APC_DEFAULT_DEPS_CACHE "${CMAKE_BINARY_DIR}/_deps")
endif()
set(APC_DEPS_CACHE_DIR "${APC_DEFAULT_DEPS_CACHE}" CACHE PATH
    "Global user cache directory for JUCE and JIVE dependencies")

# ── JUCE ─────────────────────────────────────────────────────────────
# A multi-plugin repo adds JUCE once from the root CMakeLists, so guard on the
# module target. Resolution order:
#   1. Already-defined juce::juce_audio_utils target
#   2. -DJUCE_DIR=... or $ENV{JUCE_DIR}
#   3. Explicit project _tools/JUCE
#   4. Global user cache ~/.apc-mcp/deps/JUCE (or juce-src)
#   5. Pinned FetchContent fallback (populated into ~/.apc-mcp/deps/)
if(NOT TARGET juce::juce_audio_utils)
    if(NOT JUCE_DIR AND DEFINED ENV{JUCE_DIR} AND EXISTS "$ENV{JUCE_DIR}/CMakeLists.txt")
        set(JUCE_DIR "$ENV{JUCE_DIR}")
    endif()
    if(NOT JUCE_DIR)
        if(EXISTS "${CMAKE_SOURCE_DIR}/_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_SOURCE_DIR}/_tools/JUCE")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_tools/JUCE")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JUCE")
        elseif(EXISTS "${APC_DEPS_CACHE_DIR}/JUCE/CMakeLists.txt")
            set(JUCE_DIR "${APC_DEPS_CACHE_DIR}/JUCE")
        elseif(EXISTS "${APC_DEPS_CACHE_DIR}/juce-src/CMakeLists.txt")
            set(JUCE_DIR "${APC_DEPS_CACHE_DIR}/juce-src")
        endif()
    endif()
    if(JUCE_DIR)
        add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/_tools/JUCE" EXCLUDE_FROM_ALL)
    else()
        if(NOT FETCHCONTENT_BASE_DIR)
            set(FETCHCONTENT_BASE_DIR "${APC_DEPS_CACHE_DIR}" CACHE PATH
                "FetchContent cache directory (~/.apc-mcp/deps)" FORCE)
        endif()
        include(FetchContent)
        set(APC_JUCE_GIT_TAG "be29c81492b6151c8ea8d14c840e1311963b3a83" CACHE STRING
            "Pinned JUCE commit SHA (v9.0.3)")
        FetchContent_Declare(
            JUCE
            GIT_REPOSITORY "https://github.com/juce-framework/JUCE.git"
            GIT_TAG "${APC_JUCE_GIT_TAG}"
            SOURCE_DIR "${FETCHCONTENT_BASE_DIR}/JUCE"
        )
        if(FETCHCONTENT_FULLY_DISCONNECTED
            AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/JUCE/CMakeLists.txt"
            AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/juce-src/CMakeLists.txt"
            AND NOT FETCHCONTENT_SOURCE_DIR_JUCE)
            message(FATAL_ERROR
                "JUCE not found and FETCHCONTENT_FULLY_DISCONNECTED is ON. "
                "Provide -DJUCE_DIR=/path/to/JUCE, vendor _tools/JUCE, "
                "or populate ~/.apc-mcp/deps/JUCE.")
        endif()
        FetchContent_MakeAvailable(JUCE)
    endif()
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
    IS_SYNTH {{PLUGIN_IS_SYNTH_CMAKE}}
    NEEDS_MIDI_INPUT {{PLUGIN_NEEDS_MIDI_CMAKE}}
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

# Enforce warnings-as-errors on generated plugin sources without promoting
# third-party JUCE module warnings into build failures.
if(MSVC)
    set_source_files_properties(
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        PROPERTIES COMPILE_OPTIONS "/W4;/WX"
    )
else()
    set_source_files_properties(
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Werror"
    )
endif()

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    APC_USE_JIVE=0
    # NOT setting JUCE_MODAL_LOOPS_PERMITTED (JUCE default: 0) is the point:
    # the synchronous dialog helpers then refuse to compile, which is the
    # correct outcome for plugin code — a nested event loop started from a
    # host callback deadlocks the host. Use the ...Async variants.
    #
    # JUCE_DISPLAY_SCALE_ENABLED was deleted rather than kept: it stopped
    # existing in JUCE (0 references in the current tree), so defining it
    # only implied a behaviour that no longer exists.
)

# On minimal/headless Linux environments without libasound2-dev, disable ALSA
# automatically so VST3/LV2 plugin builds do not fail on missing alsa/asoundlib.h.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(APC_ALSA QUIET alsa)
    endif()
    if(NOT APC_ALSA_FOUND)
        target_compile_definitions({{PLUGIN_NAME}} PUBLIC JUCE_ALSA=0)
    endif()
endif()

# Promote third-party JUCE headers to SYSTEM privately on this target so
# warnings inside JUCE modules never fail -Werror on generated plugin sources.
get_target_property(APC_JUCE_INCLUDES juce::juce_core INTERFACE_INCLUDE_DIRECTORIES)
if(APC_JUCE_INCLUDES)
    target_include_directories({{PLUGIN_NAME}} SYSTEM PRIVATE ${APC_JUCE_INCLUDES})
endif()

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

# ── Distribution Packaging (dist/) ───────────────────────────────────
get_target_property(APC_PLUGIN_VERSION {{PLUGIN_NAME}} JUCE_VERSION)
if(NOT APC_PLUGIN_VERSION)
    set(APC_PLUGIN_VERSION "${PROJECT_VERSION}")
endif()
if(NOT APC_PLUGIN_VERSION)
    set(APC_PLUGIN_VERSION "0.1.0")
endif()

if(APPLE)
    set(APC_DIST_PLATFORM "macOS")
elseif(WIN32)
    set(APC_DIST_PLATFORM "Windows")
else()
    set(APC_DIST_PLATFORM "Linux")
endif()

set(APC_DIST_DIR
    "${CMAKE_SOURCE_DIR}/dist/{{PLUGIN_NAME}}-${APC_PLUGIN_VERSION}-${APC_DIST_PLATFORM}")
set(APC_BUILD_DIST_DIR
    "${CMAKE_BINARY_DIR}/dist/{{PLUGIN_NAME}}-${APC_PLUGIN_VERSION}-${APC_DIST_PLATFORM}")

add_custom_target({{PLUGIN_NAME}}_package
    COMMENT "Packaging {{PLUGIN_NAME}} into ${APC_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${APC_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E remove_directory "${APC_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${APC_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${APC_BUILD_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E remove_directory "${APC_BUILD_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${APC_BUILD_DIST_DIR}"
)

if(TARGET {{PLUGIN_NAME}}_VST3)
    add_dependencies({{PLUGIN_NAME}}_package {{PLUGIN_NAME}}_VST3)
    get_target_property(
        APC_VST3_BUNDLE {{PLUGIN_NAME}}_VST3 JUCE_PLUGIN_ARTEFACT_FILE)
    if(NOT APC_VST3_BUNDLE)
        set(APC_VST3_BUNDLE "$<TARGET_FILE_DIR:{{PLUGIN_NAME}}_VST3>")
    endif()
    add_custom_command(TARGET {{PLUGIN_NAME}}_package POST_BUILD
        COMMENT "Copying {{PLUGIN_NAME}}.vst3 into ${APC_DIST_DIR}"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory
            "${APC_VST3_BUNDLE}"
            "${APC_DIST_DIR}/{{PLUGIN_NAME}}.vst3"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory
            "${APC_VST3_BUNDLE}"
            "${APC_BUILD_DIST_DIR}/{{PLUGIN_NAME}}.vst3"
    )
endif()

if(APPLE AND TARGET {{PLUGIN_NAME}}_AU)
    add_dependencies({{PLUGIN_NAME}}_package {{PLUGIN_NAME}}_AU)
    get_target_property(
        APC_AU_BUNDLE {{PLUGIN_NAME}}_AU JUCE_PLUGIN_ARTEFACT_FILE)
    if(NOT APC_AU_BUNDLE)
        set(APC_AU_BUNDLE "$<TARGET_FILE_DIR:{{PLUGIN_NAME}}_AU>")
    endif()
    add_custom_command(TARGET {{PLUGIN_NAME}}_package POST_BUILD
        COMMENT "Copying {{PLUGIN_NAME}}.component into ${APC_DIST_DIR}"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory
            "${APC_AU_BUNDLE}"
            "${APC_DIST_DIR}/{{PLUGIN_NAME}}.component"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory
            "${APC_AU_BUNDLE}"
            "${APC_BUILD_DIST_DIR}/{{PLUGIN_NAME}}.component"
    )
endif()

if(APPLE)
    if(TARGET {{PLUGIN_NAME}}_VST3)
        add_custom_command(TARGET {{PLUGIN_NAME}}_package POST_BUILD
            COMMENT "Ad-hoc signing {{PLUGIN_NAME}}.vst3"
            COMMAND codesign --force --deep --sign -
                "${APC_DIST_DIR}/{{PLUGIN_NAME}}.vst3"
            COMMAND codesign --force --deep --sign -
                "${APC_BUILD_DIST_DIR}/{{PLUGIN_NAME}}.vst3"
        )
    endif()
    if(TARGET {{PLUGIN_NAME}}_AU)
        add_custom_command(TARGET {{PLUGIN_NAME}}_package POST_BUILD
            COMMENT "Ad-hoc signing {{PLUGIN_NAME}}.component"
            COMMAND codesign --force --deep --sign -
                "${APC_DIST_DIR}/{{PLUGIN_NAME}}.component"
            COMMAND codesign --force --deep --sign -
                "${APC_BUILD_DIST_DIR}/{{PLUGIN_NAME}}.component"
        )
    endif()
endif()

set(APC_INSTALL_TXT "${CMAKE_CURRENT_BINARY_DIR}/INSTALL.txt")
file(WRITE "${APC_INSTALL_TXT}"
    "Install {{PLUGIN_NAME}} ${APC_PLUGIN_VERSION}\n"
    "Copy the .vst3 (and .component on macOS) into your system plugin folder and rescan:\n\n"
    "macOS:   ~/Library/Audio/Plug-Ins/VST3/  or  /Library/Audio/Plug-Ins/VST3/\n"
    "Windows: C:\\Program Files\\Common Files\\VST3\\\n"
    "Linux:   ~/.vst3/\n\n"
    "These bundles are ad-hoc signed for local testing only.\n"
)

add_custom_command(TARGET {{PLUGIN_NAME}}_package POST_BUILD
    COMMENT "Writing INSTALL.txt into ${APC_DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E copy
        "${APC_INSTALL_TXT}" "${APC_DIST_DIR}/INSTALL.txt"
    COMMAND "${CMAKE_COMMAND}" -E copy
        "${APC_INSTALL_TXT}" "${APC_BUILD_DIST_DIR}/INSTALL.txt"
)

if(NOT TARGET package)
    add_custom_target(package
        COMMENT "Packaging {{PLUGIN_NAME}} into ${APC_DIST_DIR}"
    )
endif()
add_dependencies(package {{PLUGIN_NAME}}_package)
