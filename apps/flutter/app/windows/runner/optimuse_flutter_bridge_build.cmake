# Builds and copies the Rust artifacts required by the selected Windows runner configuration.
file(MAKE_DIRECTORY "${OPTIMUSE_OUTPUT_DIRECTORY}")

if(NOT OPTIMUSE_RUSTUP_TOOLCHAIN)
  if(DEFINED ENV{RUSTUP_TOOLCHAIN} AND NOT "$ENV{RUSTUP_TOOLCHAIN}" STREQUAL "")
    set(OPTIMUSE_RUSTUP_TOOLCHAIN "$ENV{RUSTUP_TOOLCHAIN}")
  else()
    set(OPTIMUSE_RUSTUP_TOOLCHAIN "stable-x86_64-pc-windows-msvc")
  endif()
endif()

set(OPTIMUSE_CARGO_ENV
  "RUSTFLAGS=-Awarnings"
  "CARGO_TERM_COLOR=never"
)
if(OPTIMUSE_CARGO_HOME)
  list(APPEND OPTIMUSE_CARGO_ENV "CARGO_HOME=${OPTIMUSE_CARGO_HOME}")
endif()
if(OPTIMUSE_RUSTUP_HOME)
  list(APPEND OPTIMUSE_CARGO_ENV "RUSTUP_HOME=${OPTIMUSE_RUSTUP_HOME}")
endif()
if(OPTIMUSE_RUSTUP_TOOLCHAIN)
  list(APPEND OPTIMUSE_CARGO_ENV "RUSTUP_TOOLCHAIN=${OPTIMUSE_RUSTUP_TOOLCHAIN}")
endif()
if(DEFINED ENV{JAVA_HOME} AND NOT "$ENV{JAVA_HOME}" STREQUAL "")
  list(APPEND OPTIMUSE_CARGO_ENV "JAVA_HOME=$ENV{JAVA_HOME}")
endif()

if(OPTIMUSE_BUILD_CONFIG STREQUAL "Debug")
  list(APPEND OPTIMUSE_CARGO_ENV "CARGO_PROFILE_DEV_DEBUG=2")
  set(OPTIMUSE_CARGO_ARGS build --manifest-path "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/Cargo.toml")
  set(OPTIMUSE_CARGO_DLL "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/target/debug/optimuse_flutter_bridge.dll")
  set(OPTIMUSE_CARGO_LABEL Debug)
else()
  set(OPTIMUSE_CARGO_ARGS build --manifest-path "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/Cargo.toml" --release)
  set(OPTIMUSE_CARGO_DLL "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/target/release/optimuse_flutter_bridge.dll")
  set(OPTIMUSE_CARGO_LABEL release)
endif()

# Deploy the matching debug symbols beside the loaded DLL for Rust stack resolution.
if(OPTIMUSE_BUILD_CONFIG STREQUAL "Debug")
  set(OPTIMUSE_CARGO_PDB "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}/target/debug/optimuse_flutter_bridge.pdb")
endif()

execute_process(
  COMMAND "${CMAKE_COMMAND}" -E env ${OPTIMUSE_CARGO_ENV}
    "${OPTIMUSE_CARGO_EXECUTABLE}" ${OPTIMUSE_CARGO_ARGS}
  WORKING_DIRECTORY "${OPTIMUSE_FLUTTER_BRIDGE_CRATE}"
  RESULT_VARIABLE OPTIMUSE_CARGO_RESULT
)
if(NOT OPTIMUSE_CARGO_RESULT EQUAL 0)
  message(FATAL_ERROR "optimuse flutter bridge ${OPTIMUSE_CARGO_LABEL} build failed: ${OPTIMUSE_CARGO_RESULT}")
endif()
execute_process(
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
    "${OPTIMUSE_CARGO_DLL}"
    "${OPTIMUSE_OUTPUT_DIRECTORY}/optimuse_flutter_bridge.dll"
  RESULT_VARIABLE OPTIMUSE_COPY_RESULT
)
if(NOT OPTIMUSE_COPY_RESULT EQUAL 0)
  message(FATAL_ERROR
    "Failed to copy optimuse_flutter_bridge.dll into ${OPTIMUSE_OUTPUT_DIRECTORY}. "
    "Close the running Windows debug app (optimuse.exe) and retry. "
    "error=${OPTIMUSE_COPY_RESULT}")
endif()
if(OPTIMUSE_BUILD_CONFIG STREQUAL "Debug")
  execute_process(
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
      "${OPTIMUSE_CARGO_PDB}"
      "${OPTIMUSE_OUTPUT_DIRECTORY}/optimuse_flutter_bridge.pdb"
    RESULT_VARIABLE OPTIMUSE_SYMBOL_COPY_RESULT
  )
  if(NOT OPTIMUSE_SYMBOL_COPY_RESULT EQUAL 0)
    message(FATAL_ERROR "Failed to deploy Rust debug symbols: ${OPTIMUSE_CARGO_PDB}")
  endif()
endif()
