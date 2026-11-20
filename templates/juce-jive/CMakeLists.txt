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

# Enable or disable the JIVE declarative XML/JSON UI layer. When set to OFF,
# JIVE is never fetched, linked, or added to include paths, and the plugin
# falls back to juce::GenericAudioProcessorEditor.
option(APC_USE_JIVE "Enable JIVE declarative XML/JSON UI" ON)

# ── JUCE ─────────────────────────────────────────────────────────────
# Guarded so a multi-plugin repo adds JUCE once from the root CMakeLists.
# Resolution order:
#   1. Already-defined juce::juce_audio_utils target
#   2. -DJUCE_DIR=... or $ENV{JUCE_DIR}
#   3. Vendored _tools/JUCE (project root, plugin dir, or legacy two-up)
#   4. Pinned FetchContent fallback (JUCE 9.0.3 commit SHA)
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
        endif()
    endif()
    if(JUCE_DIR)
        add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/_tools/JUCE" EXCLUDE_FROM_ALL)
    else()
        include(FetchContent)
        set(APC_JUCE_GIT_TAG "be29c81492b6151c8ea8d14c840e1311963b3a83" CACHE STRING
            "Pinned JUCE commit SHA (v9.0.3)")
        FetchContent_Declare(
            JUCE
            GIT_REPOSITORY "https://github.com/juce-framework/JUCE.git"
            GIT_TAG "${APC_JUCE_GIT_TAG}"
        )
        if(FETCHCONTENT_FULLY_DISCONNECTED
            AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/juce-src/CMakeLists.txt"
            AND NOT FETCHCONTENT_SOURCE_DIR_JUCE)
            message(FATAL_ERROR
                "JUCE not found and FETCHCONTENT_FULLY_DISCONNECTED is ON. "
                "Provide -DJUCE_DIR=/path/to/JUCE, vendor _tools/JUCE, "
                "or set FETCHCONTENT_SOURCE_DIR_JUCE.")
        endif()
        FetchContent_MakeAvailable(JUCE)
    endif()
endif()

# ── JIVE (only resolved when APC_USE_JIVE=ON) ────────────────────────
# Resolution order:
#   1. Already-defined jive::jive_layouts target
#   2. -DJIVE_DIR=... or $ENV{JIVE_DIR}
#   3. Vendored _tools/JIVE (plugin dir, project root, or legacy two-up)
#   4. Pinned FetchContent fallback (JIVE v2.0.1 commit SHA)
if(APC_USE_JIVE)
    if(NOT TARGET jive::jive_layouts)
        if(NOT JIVE_DIR AND DEFINED ENV{JIVE_DIR} AND EXISTS "$ENV{JIVE_DIR}/CMakeLists.txt")
            set(JIVE_DIR "$ENV{JIVE_DIR}")
        endif()
        if(NOT JIVE_DIR)
            if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/_tools/JIVE/CMakeLists.txt")
                set(JIVE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_tools/JIVE")
            elseif(EXISTS "${CMAKE_SOURCE_DIR}/_tools/JIVE/CMakeLists.txt")
                set(JIVE_DIR "${CMAKE_SOURCE_DIR}/_tools/JIVE")
            elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JIVE/CMakeLists.txt")
                set(JIVE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_tools/JIVE")
            endif()
        endif()
        if(JIVE_DIR)
            add_subdirectory("${JIVE_DIR}" "${CMAKE_BINARY_DIR}/_tools/JIVE" EXCLUDE_FROM_ALL)
        else()
            include(FetchContent)
            set(APC_JIVE_GIT_TAG "693788a539eb42b9c15848706f9ceae43ee60084" CACHE STRING
                "Pinned JIVE commit SHA (v2.0.1)")
            FetchContent_Declare(
                JIVE
                GIT_REPOSITORY "https://github.com/ImJimmi/JIVE.git"
                GIT_TAG "${APC_JIVE_GIT_TAG}"
            )
            if(FETCHCONTENT_FULLY_DISCONNECTED
                AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/jive-src/CMakeLists.txt"
                AND NOT FETCHCONTENT_SOURCE_DIR_JIVE)
                message(FATAL_ERROR
                    "JIVE not found and FETCHCONTENT_FULLY_DISCONNECTED is ON. "
                    "Provide -DJIVE_DIR=/path/to/JIVE, vendor _tools/JIVE, "
                    "or set FETCHCONTENT_SOURCE_DIR_JIVE.")
            endif()
            FetchContent_MakeAvailable(JIVE)
        endif()
    endif()
endif()

# ── Plugin target ────────────────────────────────────────────────────
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

juce_generate_juce_header({{PLUGIN_NAME}})

target_sources({{PLUGIN_NAME}} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
)

if(APC_USE_JIVE)
    target_sources({{PLUGIN_NAME}} PRIVATE
        Source/PluginEditor.cpp
        Source/PluginEditor.h
    )
endif()

target_compile_features({{PLUGIN_NAME}} PRIVATE cxx_std_20)

# Enforce warnings-as-errors on generated plugin sources without promoting
# third-party JUCE/JIVE module warnings into build failures.
if(MSVC)
    set_source_files_properties(
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        Source/PluginEditor.cpp
        Source/PluginEditor.h
        PROPERTIES COMPILE_OPTIONS "/W4;/WX"
    )
else()
    set_source_files_properties(
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        Source/PluginEditor.cpp
        Source/PluginEditor.h
        PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Werror"
    )
endif()

target_compile_definitions({{PLUGIN_NAME}} PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
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
# warnings inside JUCE/JIVE headers never fail -Werror on generated sources.
get_target_property(APC_JUCE_INCLUDES juce::juce_core INTERFACE_INCLUDE_DIRECTORIES)
if(APC_JUCE_INCLUDES)
    target_include_directories({{PLUGIN_NAME}} SYSTEM PRIVATE ${APC_JUCE_INCLUDES})
endif()

if(APC_USE_JIVE)
    # Embed MainView.xml and Styles.json for zero-dependency Release builds.
    # Debug builds read directly from APC_JIVE_UI_DIR on disk for live hot-reload.
    juce_add_binary_data({{PLUGIN_NAME}}_JiveData
        NAMESPACE {{PLUGIN_ID}}_JiveData
        SOURCES
            Source/UI/MainView.xml
            Source/UI/Styles.json
    )

    # Mark JIVE headers as SYSTEM privately on this target so third-party header
    # warnings do not break -Werror and global include paths stay untouched.
    get_target_property(APC_JIVE_INCLUDES jive::jive_core INTERFACE_INCLUDE_DIRECTORIES)
    if(APC_JIVE_INCLUDES)
        target_include_directories({{PLUGIN_NAME}} SYSTEM PRIVATE ${APC_JIVE_INCLUDES})
    endif()

    target_compile_definitions({{PLUGIN_NAME}} PRIVATE
        APC_USE_JIVE=1
        JIVE_IS_PLUGIN_PROJECT=1
        APC_JIVE_UI_DIR="${CMAKE_CURRENT_SOURCE_DIR}/Source/UI"
    )

    target_link_libraries({{PLUGIN_NAME}}
        PRIVATE
            {{PLUGIN_NAME}}_JiveData
            jive::jive_layouts
            jive::jive_style_sheets
    )
else()
    target_compile_definitions({{PLUGIN_NAME}} PRIVATE APC_USE_JIVE=0)
endif()

target_link_libraries({{PLUGIN_NAME}}
    PRIVATE
        juce::juce_audio_utils
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# ── Packaging (dist/) ────────────────────────────────────────────────
# Stage clean .vst3 / .component / .lv2 bundles into <build>/dist/<Config>/
# automatically after building and expose a dedicated `<name>_package` target.
set(APC_DIST_DIR "${CMAKE_BINARY_DIR}/dist/$<CONFIG>" CACHE PATH
    "Directory where clean packaged plugin bundles are staged")
set(APC_PACKAGE_DEPS)
foreach(apc_fmt_pair IN ITEMS "VST3:vst3" "AU:component" "LV2:lv2")
    string(REPLACE ":" ";" APC_PAIR "${apc_fmt_pair}")
    list(GET APC_PAIR 0 APC_FMT)
    list(GET APC_PAIR 1 APC_EXT)
    if(TARGET {{PLUGIN_NAME}}_${APC_FMT})
        list(APPEND APC_PACKAGE_DEPS {{PLUGIN_NAME}}_${APC_FMT})
        get_target_property(
            APC_ARTEFACT {{PLUGIN_NAME}}_${APC_FMT} JUCE_PLUGIN_ARTEFACT_FILE)
        if(APC_ARTEFACT)
            set(APC_DEST "${APC_DIST_DIR}/{{PLUGIN_DISPLAY_NAME}}.${APC_EXT}")
            add_custom_command(TARGET {{PLUGIN_NAME}}_${APC_FMT} POST_BUILD
                COMMAND "${CMAKE_COMMAND}" -E make_directory "${APC_DIST_DIR}"
                COMMAND "${CMAKE_COMMAND}" -E rm -rf "${APC_DEST}"
                COMMAND "${CMAKE_COMMAND}" -E copy_directory "${APC_ARTEFACT}" "${APC_DEST}"
                COMMENT "Staging {{PLUGIN_DISPLAY_NAME}}.${APC_EXT} into ${APC_DIST_DIR}"
            )
        endif()
    endif()
endforeach()
add_custom_target({{PLUGIN_NAME}}_package
    DEPENDS ${APC_PACKAGE_DEPS}
    COMMENT "Packaged {{PLUGIN_DISPLAY_NAME}} bundles into ${APC_DIST_DIR}"
)
