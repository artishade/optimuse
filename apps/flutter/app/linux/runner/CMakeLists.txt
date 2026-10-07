cmake_minimum_required(VERSION 3.13)
project(runner LANGUAGES CXX)

# Define the application target. To change its name, change BINARY_NAME in the
# top-level CMakeLists.txt, not the value here, or `flutter run` will no longer
# work.
#
# Any new source files that you add to the application should be added here.
add_executable(${BINARY_NAME}
  "crash_channel.cc"
  "main.cc"
  "my_application.cc"
  "optimuse_runtime_channel.cc"
  "${FLUTTER_MANAGED_DIR}/generated_plugin_registrant.cc"
)

# Apply the standard set of build settings. This can be removed for applications
# that need different build settings.
apply_standard_settings(${BINARY_NAME})

# Add preprocessor definitions for the application ID.
add_definitions(-DAPPLICATION_ID="${APPLICATION_ID}")

# Add dependency libraries. Add any application-specific dependencies here.
target_link_libraries(${BINARY_NAME} PRIVATE flutter)
target_link_libraries(${BINARY_NAME} PRIVATE PkgConfig::GTK)
target_link_libraries(${BINARY_NAME} PRIVATE ${CMAKE_DL_LIBS})

target_include_directories(${BINARY_NAME} PRIVATE "${CMAKE_SOURCE_DIR}")

set(OPTIMUSE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../")
set(OPTIMUSE_PLUGIN_SYNC_PYTHON "${OPTIMUSE_REPO_ROOT}/.venv/bin/python")
set(OPTIMUSE_PLUGIN_SYNC_SCRIPT "${OPTIMUSE_REPO_ROOT}/plugins/tools/sync_plugin_packages.py")
add_custom_target(sync_optimuse_plugins ALL
  COMMAND "${OPTIMUSE_PLUGIN_SYNC_PYTHON}" "${OPTIMUSE_PLUGIN_SYNC_SCRIPT}" --source buildin --no-hot-reload
  WORKING_DIRECTORY "${OPTIMUSE_REPO_ROOT}"
)

set(OPTIMUSE_FLUTTER_BRIDGE_CRATE "${CMAKE_CURRENT_SOURCE_DIR}/../../../native/optimuse-flutter-bridge")
add_custom_target(optimuse_flutter_bridge ALL
  COMMAND cargo build --manifest-path "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/Cargo.toml" $<$<NOT:$<CONFIG:Debug>>:--release>
  WORKING_DIRECTORY "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}"
)
add_dependencies(optimuse_flutter_bridge sync_optimuse_plugins)
add_dependencies(${BINARY_NAME} optimuse_flutter_bridge)
