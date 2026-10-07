cmake_minimum_required(VERSION 3.14)
project(runner LANGUAGES CXX)

# Define the application target. To change its name, change BINARY_NAME in the
# top-level CMakeLists.txt, not the value here, or `flutter run` will no longer
# work.
#
# Any new source files that you add to the application should be added here.
add_executable(${BINARY_NAME} WIN32
  "crash_channel.cpp"
  "engine_channel_lifetime.cpp"
  "flutter_window.cpp"
  "main.cpp"
  "optimuse_runtime_channel.cpp"
  "system_audio_input_channel.cpp"
  "utils.cpp"
  "win32_window.cpp"
  "${FLUTTER_MANAGED_DIR}/generated_plugin_registrant.cc"
  "Runner.rc"
  "runner.exe.manifest"
)

# Apply the standard set of build settings. This can be removed for applications
# that need different build settings.
apply_standard_settings(${BINARY_NAME})

# Add preprocessor definitions for the build version.
target_compile_definitions(${BINARY_NAME} PRIVATE "FLUTTER_VERSION=\"${FLUTTER_VERSION}\"")
target_compile_definitions(${BINARY_NAME} PRIVATE "FLUTTER_VERSION_MAJOR=${FLUTTER_VERSION_MAJOR}")
target_compile_definitions(${BINARY_NAME} PRIVATE "FLUTTER_VERSION_MINOR=${FLUTTER_VERSION_MINOR}")
target_compile_definitions(${BINARY_NAME} PRIVATE "FLUTTER_VERSION_PATCH=${FLUTTER_VERSION_PATCH}")
target_compile_definitions(${BINARY_NAME} PRIVATE "FLUTTER_VERSION_BUILD=${FLUTTER_VERSION_BUILD}")

# Disable Windows macros that collide with C++ standard library functions.
target_compile_definitions(${BINARY_NAME} PRIVATE "NOMINMAX")

# Add dependency libraries and include directories. Add any application-specific
# dependencies here.
target_link_libraries(${BINARY_NAME} PRIVATE flutter flutter_wrapper_app)
target_link_libraries(${BINARY_NAME} PRIVATE "ole32.lib")
target_link_libraries(${BINARY_NAME} PRIVATE "propsys.lib" "shell32.lib")
target_link_libraries(${BINARY_NAME} PRIVATE "advapi32.lib")
target_link_libraries(${BINARY_NAME} PRIVATE "dwmapi.lib")
target_link_libraries(${BINARY_NAME} PRIVATE "wtsapi32.lib" "iphlpapi.lib")
target_link_libraries(${BINARY_NAME} PRIVATE "gdiplus.lib")
target_include_directories(${BINARY_NAME} PRIVATE "${CMAKE_SOURCE_DIR}")

set(OPTIMUSE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../")
set(OPTIMUSE_PLUGIN_SYNC_PYTHON "${OPTIMUSE_REPO_ROOT}/.venv/Scripts/python.exe")
set(OPTIMUSE_PLUGIN_SYNC_SCRIPT "${OPTIMUSE_REPO_ROOT}/plugins/tools/sync_plugin_packages.py")
set(OPTIMUSE_FLUTTER_BRIDGE_CRATE "${CMAKE_CURRENT_SOURCE_DIR}/../../../native/optimuse-flutter-bridge")
find_program(OPTIMUSE_CARGO_EXECUTABLE
  NAMES cargo cargo.exe
  HINTS "$ENV{USERPROFILE}/.cargo/bin" "$ENV{CARGO_HOME}/bin"
  REQUIRED
)
get_filename_component(OPTIMUSE_CARGO_BIN_DIR "${OPTIMUSE_CARGO_EXECUTABLE}" DIRECTORY)
get_filename_component(OPTIMUSE_DERIVED_CARGO_HOME "${OPTIMUSE_CARGO_BIN_DIR}" DIRECTORY)
get_filename_component(OPTIMUSE_TOOLCHAIN_ROOT "${OPTIMUSE_DERIVED_CARGO_HOME}" DIRECTORY)
if(DEFINED ENV{CARGO_HOME} AND NOT "$ENV{CARGO_HOME}" STREQUAL "")
  set(OPTIMUSE_CARGO_HOME "$ENV{CARGO_HOME}")
else()
  set(OPTIMUSE_CARGO_HOME "${OPTIMUSE_DERIVED_CARGO_HOME}")
endif()
if(DEFINED ENV{RUSTUP_HOME} AND NOT "$ENV{RUSTUP_HOME}" STREQUAL "")
  set(OPTIMUSE_RUSTUP_HOME "$ENV{RUSTUP_HOME}")
elseif(EXISTS "${OPTIMUSE_TOOLCHAIN_ROOT}/rustup")
  set(OPTIMUSE_RUSTUP_HOME "${OPTIMUSE_TOOLCHAIN_ROOT}/rustup")
elseif(EXISTS "${OPTIMUSE_TOOLCHAIN_ROOT}/.rustup")
  set(OPTIMUSE_RUSTUP_HOME "${OPTIMUSE_TOOLCHAIN_ROOT}/.rustup")
else()
  set(OPTIMUSE_RUSTUP_HOME "")
endif()
set(OPTIMUSE_RUSTUP_ENV)
if(OPTIMUSE_CARGO_HOME)
  list(APPEND OPTIMUSE_RUSTUP_ENV "CARGO_HOME=${OPTIMUSE_CARGO_HOME}")
endif()
if(OPTIMUSE_RUSTUP_HOME)
  list(APPEND OPTIMUSE_RUSTUP_ENV "RUSTUP_HOME=${OPTIMUSE_RUSTUP_HOME}")
endif()
if(DEFINED ENV{RUSTUP_TOOLCHAIN} AND NOT "$ENV{RUSTUP_TOOLCHAIN}" STREQUAL "")
  set(OPTIMUSE_RUSTUP_TOOLCHAIN "$ENV{RUSTUP_TOOLCHAIN}")
else()
  set(OPTIMUSE_RUSTUP_TOOLCHAIN "stable-x86_64-pc-windows-msvc")
endif()
list(APPEND OPTIMUSE_RUSTUP_ENV "RUSTUP_TOOLCHAIN=${OPTIMUSE_RUSTUP_TOOLCHAIN}")

# Keep the plugin sync step incremental.  A custom target without an output is
# always considered out of date by MSBuild, which otherwise runs the plugin
# SDK code generator on every Flutter build.
file(GLOB_RECURSE OPTIMUSE_PLUGIN_SYNC_INPUTS CONFIGURE_DEPENDS
  "${OPTIMUSE_REPO_ROOT}/plugins/packages/buildin/*"
  "${OPTIMUSE_REPO_ROOT}/plugins/packages/external/*"
  "${OPTIMUSE_REPO_ROOT}/plugins/types/*"
  "${OPTIMUSE_REPO_ROOT}/core/crates/plugin/codegen/*"
  "${OPTIMUSE_REPO_ROOT}/core/crates/plugin/sdk/*"
)
# Node package contents are not inputs to the Python plugin synchronizer.
# Keeping pnpm's package links out of DEPENDS avoids stale/missing node_modules paths in MSBuild.
list(FILTER OPTIMUSE_PLUGIN_SYNC_INPUTS EXCLUDE REGEX "(^|[/\\\\])node_modules([/\\\\]|$)")
list(APPEND OPTIMUSE_PLUGIN_SYNC_INPUTS
  "${OPTIMUSE_PLUGIN_SYNC_SCRIPT}"
  "${OPTIMUSE_REPO_ROOT}/core/Cargo.toml"
  "${OPTIMUSE_REPO_ROOT}/core/Cargo.lock"
)
set(OPTIMUSE_PLUGIN_SYNC_STAMP
  "${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/sync_optimuse_plugins-$<CONFIG>.stamp")
add_custom_command(OUTPUT "${OPTIMUSE_PLUGIN_SYNC_STAMP}"
  COMMAND ${CMAKE_COMMAND} -E env ${OPTIMUSE_RUSTUP_ENV}
    "${OPTIMUSE_PLUGIN_SYNC_PYTHON}" "${OPTIMUSE_PLUGIN_SYNC_SCRIPT}" --source runtime --no-hot-reload
  WORKING_DIRECTORY "${OPTIMUSE_REPO_ROOT}"
  COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles"
  COMMAND "${CMAKE_COMMAND}" -E touch "${OPTIMUSE_PLUGIN_SYNC_STAMP}"
  DEPENDS ${OPTIMUSE_PLUGIN_SYNC_INPUTS}
  COMMENT "Synchronizing Optimuse plugin packages"
  VERBATIM
)
add_custom_target(sync_optimuse_plugins DEPENDS "${OPTIMUSE_PLUGIN_SYNC_STAMP}")

# Cargo already performs incremental compilation, but the previous custom
# target forced Cargo to start on every Flutter build.  Track the Rust/native
# inputs and the copied DLL instead, so Dart-only edits skip this whole step.
set(OPTIMUSE_NATIVE_SOURCE_ROOTS
  "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/src"
  "${OPTIMUSE_REPO_ROOT}/core/crates"
  "${OPTIMUSE_REPO_ROOT}/core/vendor"
  "${OPTIMUSE_REPO_ROOT}/hosts"
)
set(OPTIMUSE_NATIVE_INPUTS)
foreach(OPTIMUSE_NATIVE_SOURCE_ROOT IN LISTS OPTIMUSE_NATIVE_SOURCE_ROOTS)
  file(GLOB_RECURSE OPTIMUSE_NATIVE_SOURCE_FILES CONFIGURE_DEPENDS
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.rs"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.toml"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.lock"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.c"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.cc"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.cpp"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.h"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.hh"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.hpp"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.inc"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.json"
    "${OPTIMUSE_NATIVE_SOURCE_ROOT}/*.hjson"
  )
  list(APPEND OPTIMUSE_NATIVE_INPUTS ${OPTIMUSE_NATIVE_SOURCE_FILES})
endforeach()
list(APPEND OPTIMUSE_NATIVE_INPUTS
  "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/Cargo.toml"
  "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/Cargo.lock"
)
# Embedded plugin bytes must invalidate the copied bridge DLL when repackaged.
file(GLOB_RECURSE OPTIMUSE_PLUGIN_ASSET_INPUTS CONFIGURE_DEPENDS
  "${OPTIMUSE_REPO_ROOT}/core/crates/runtime/application/assets/plugins/*"
)
list(APPEND OPTIMUSE_NATIVE_INPUTS ${OPTIMUSE_PLUGIN_ASSET_INPUTS})
set(OPTIMUSE_FLUTTER_BRIDGE_OUTPUT_DLL
  "${CMAKE_CURRENT_BINARY_DIR}/$<CONFIG>/optimuse_flutter_bridge.dll")
set(OPTIMUSE_FLUTTER_BRIDGE_STAMP
  "${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/optimuse_flutter_bridge-$<CONFIG>.stamp")
add_custom_command(
  OUTPUT
    "${OPTIMUSE_FLUTTER_BRIDGE_OUTPUT_DLL}"
    "${OPTIMUSE_FLUTTER_BRIDGE_STAMP}"
  COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles"
  COMMAND ${CMAKE_COMMAND}
    "-DOPTIMUSE_BUILD_CONFIG=$<CONFIG>"
    "-DOPTIMUSE_CARGO_EXECUTABLE=${OPTIMUSE_CARGO_EXECUTABLE}"
    "-DOPTIMUSE_CARGO_HOME=${OPTIMUSE_CARGO_HOME}"
    "-DOPTIMUSE_RUSTUP_HOME=${OPTIMUSE_RUSTUP_HOME}"
    "-DOPTIMUSE_RUSTUP_TOOLCHAIN=${OPTIMUSE_RUSTUP_TOOLCHAIN}"
    "-DOPTIMUSE_FLUTTER_BRIDGE_CRATE=${OPTIMUSE_FLUTTER_BRIDGE_CRATE}"
    "-DOPTIMUSE_OUTPUT_DIRECTORY=${CMAKE_CURRENT_BINARY_DIR}/$<CONFIG>"
    -P "${CMAKE_CURRENT_SOURCE_DIR}/optimuse_flutter_bridge_build.cmake"
  # Only mark the custom command complete after Cargo and the DLL copy both
  # succeed.  This allows a later build to retry if the running app locked the
  # previous DLL during the copy step.
  COMMAND "${CMAKE_COMMAND}" -E touch "${OPTIMUSE_FLUTTER_BRIDGE_STAMP}"
  DEPENDS
    "${OPTIMUSE_PLUGIN_SYNC_STAMP}"
    "${CMAKE_CURRENT_SOURCE_DIR}/optimuse_flutter_bridge_build.cmake"
    ${OPTIMUSE_NATIVE_INPUTS}
  COMMENT "Building the Optimuse Flutter Rust bridge"
  VERBATIM
)
add_custom_target(optimuse_flutter_bridge
  DEPENDS
    "${OPTIMUSE_FLUTTER_BRIDGE_OUTPUT_DLL}"
    "${OPTIMUSE_FLUTTER_BRIDGE_STAMP}"
)
add_dependencies(optimuse_flutter_bridge sync_optimuse_plugins)
add_dependencies(${BINARY_NAME} optimuse_flutter_bridge)

# Run the Flutter tool portions of the build. This must not be removed.
add_dependencies(${BINARY_NAME} flutter_assemble)
