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
option(APC_USE_DSP_KIT "Link the header-only apc::dsp kit" ON)
option(APC_USE_LICENSE_SEAM "Add the optional apc::license seam include path" OFF)

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
# Guarded so a multi-plugin repo adds JUCE once from the root CMakeLists.
# Resolution order:
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

# ── JIVE (only resolved when APC_USE_JIVE=ON) ────────────────────────
# Resolution order:
#   1. Already-defined jive::jive_layouts target
#   2. -DJIVE_DIR=... or $ENV{JIVE_DIR}
#   3. Explicit project _tools/JIVE
#   4. Global user cache ~/.apc-mcp/deps/JIVE (or jive-src)
#   5. Pinned FetchContent fallback (populated into ~/.apc-mcp/deps/)
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
            elseif(EXISTS "${APC_DEPS_CACHE_DIR}/JIVE/CMakeLists.txt")
                set(JIVE_DIR "${APC_DEPS_CACHE_DIR}/JIVE")
            elseif(EXISTS "${APC_DEPS_CACHE_DIR}/jive-src/CMakeLists.txt")
                set(JIVE_DIR "${APC_DEPS_CACHE_DIR}/jive-src")
            endif()
        endif()
        if(JIVE_DIR)
            add_subdirectory("${JIVE_DIR}" "${CMAKE_BINARY_DIR}/_tools/JIVE" EXCLUDE_FROM_ALL)
        else()
            if(NOT FETCHCONTENT_BASE_DIR)
                set(FETCHCONTENT_BASE_DIR "${APC_DEPS_CACHE_DIR}" CACHE PATH
                    "FetchContent cache directory (~/.apc-mcp/deps)" FORCE)
            endif()
            include(FetchContent)
            set(APC_JIVE_GIT_TAG "693788a539eb42b9c15848706f9ceae43ee60084" CACHE STRING
                "Pinned JIVE commit SHA (v2.0.1)")
            FetchContent_Declare(
                JIVE
                GIT_REPOSITORY "https://github.com/ImJimmi/JIVE.git"
                GIT_TAG "${APC_JIVE_GIT_TAG}"
                SOURCE_DIR "${FETCHCONTENT_BASE_DIR}/JIVE"
            )
            if(FETCHCONTENT_FULLY_DISCONNECTED
                AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/JIVE/CMakeLists.txt"
                AND NOT EXISTS "${FETCHCONTENT_BASE_DIR}/jive-src/CMakeLists.txt"
                AND NOT FETCHCONTENT_SOURCE_DIR_JIVE)
                message(FATAL_ERROR
                    "JIVE not found and FETCHCONTENT_FULLY_DISCONNECTED is ON. "
                    "Provide -DJIVE_DIR=/path/to/JIVE, vendor _tools/JIVE, "
                    "or populate ~/.apc-mcp/deps/JIVE.")
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
    IS_SYNTH {{PLUGIN_IS_SYNTH_CMAKE}}
    NEEDS_MIDI_INPUT {{PLUGIN_NEEDS_MIDI_CMAKE}}
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

if(APC_USE_DSP_KIT)
    if(NOT TARGET APC::dsp)
        if(NOT APC_DSP_DIR AND DEFINED ENV{APC_DSP_DIR}
            AND EXISTS "$ENV{APC_DSP_DIR}/CMakeLists.txt")
            set(APC_DSP_DIR "$ENV{APC_DSP_DIR}")
        endif()
        if(NOT APC_DSP_DIR)
            if(EXISTS "${CMAKE_SOURCE_DIR}/common/dsp/CMakeLists.txt")
                set(APC_DSP_DIR "${CMAKE_SOURCE_DIR}/common/dsp")
            elseif(EXISTS "${CMAKE_SOURCE_DIR}/_tools/apc-dsp/CMakeLists.txt")
                set(APC_DSP_DIR "${CMAKE_SOURCE_DIR}/_tools/apc-dsp")
            elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/common/dsp/CMakeLists.txt")
                set(APC_DSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/common/dsp")
            elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../common/dsp/CMakeLists.txt")
                set(APC_DSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../common/dsp")
            elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../common/dsp/CMakeLists.txt")
                set(APC_DSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../common/dsp")
            endif()
        endif()
        if(APC_DSP_DIR)
            add_subdirectory("${APC_DSP_DIR}"
                "${CMAKE_BINARY_DIR}/_tools/apc_dsp" EXCLUDE_FROM_ALL)
        else()
            message(FATAL_ERROR
                "APC_USE_DSP_KIT is ON but common/dsp/CMakeLists.txt was not found. "
                "Provide -DAPC_DSP_DIR=/path/to/common/dsp or configure with "
                "-DAPC_USE_DSP_KIT=OFF.")
        endif()
    endif()
    target_link_libraries({{PLUGIN_NAME}} PRIVATE APC::dsp)
    target_compile_definitions({{PLUGIN_NAME}} PRIVATE APC_HAS_DSP_KIT=1)
endif()

if(APC_USE_LICENSE_SEAM)
    if(NOT APC_LICENSE_DIR AND DEFINED ENV{APC_LICENSE_DIR}
        AND EXISTS "$ENV{APC_LICENSE_DIR}/ApcLicense.h")
        set(APC_LICENSE_DIR "$ENV{APC_LICENSE_DIR}")
    endif()
    if(NOT APC_LICENSE_DIR)
        if(EXISTS "${CMAKE_SOURCE_DIR}/common/licensing/ApcLicense.h")
            set(APC_LICENSE_DIR "${CMAKE_SOURCE_DIR}/common/licensing")
        elseif(EXISTS "${CMAKE_SOURCE_DIR}/_tools/apc-licensing/ApcLicense.h")
            set(APC_LICENSE_DIR "${CMAKE_SOURCE_DIR}/_tools/apc-licensing")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/common/licensing/ApcLicense.h")
            set(APC_LICENSE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/common/licensing")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../common/licensing/ApcLicense.h")
            set(APC_LICENSE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../common/licensing")
        elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../common/licensing/ApcLicense.h")
            set(APC_LICENSE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../common/licensing")
        endif()
    endif()
    if(NOT APC_LICENSE_DIR)
        message(FATAL_ERROR
            "APC_USE_LICENSE_SEAM is ON but common/licensing/ApcLicense.h was not found. "
            "Provide -DAPC_LICENSE_DIR=/path/to/common/licensing or configure with "
            "-DAPC_USE_LICENSE_SEAM=OFF.")
    endif()
    target_include_directories({{PLUGIN_NAME}} PRIVATE "${APC_LICENSE_DIR}")
    target_compile_definitions({{PLUGIN_NAME}} PRIVATE APC_HAS_LICENSE_SEAM=1)
endif()

if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    target_link_options({{PLUGIN_NAME}} PUBLIC $<$<CONFIG:Release>:-flto=auto>)
endif()

if(APC_USE_JIVE AND NOT MSVC)
    # JIVE's juce_add_modules attaches jive_TooltipWindow.cpp directly to the
    # plugin target; suppress third-party JIVE -Wshadow while keeping
    # -Wall -Wextra -Werror enforced on Source/PluginProcessor.cpp and Source/PluginEditor.cpp.
    target_compile_options({{PLUGIN_NAME}} PRIVATE -Wno-shadow)
endif()

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
