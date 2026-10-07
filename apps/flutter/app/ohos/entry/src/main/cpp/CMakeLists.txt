cmake_minimum_required(VERSION 3.16)

project(optimuse_runtime_ohos)

set(OPTIMUSE_OHOS_VROOT_HNP_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/../../../hnp/arm64-v8a")
set(OPTIMUSE_OHOS_VROOT_ASSET_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/../resources/rawfile/ohos-vroot")
set(OPTIMUSE_OHOS_VROOT_REQUIRED_ARTIFACTS
  "${OPTIMUSE_OHOS_VROOT_HNP_DIRECTORY}/harmonix-public.hnp"
  "${OPTIMUSE_OHOS_VROOT_HNP_DIRECTORY}/harmonix-private.hnp"
  "${OPTIMUSE_OHOS_VROOT_ASSET_DIRECTORY}/alpine-minirootfs-3.22.1-aarch64.tar.gz"
  "${OPTIMUSE_OHOS_VROOT_ASSET_DIRECTORY}/alpine-minirootfs-3.22.1-aarch64.tar.gz.sha256"
)

foreach(OPTIMUSE_OHOS_VROOT_ARTIFACT IN LISTS OPTIMUSE_OHOS_VROOT_REQUIRED_ARTIFACTS)
  if(NOT EXISTS "${OPTIMUSE_OHOS_VROOT_ARTIFACT}")
    message(FATAL_ERROR "Missing required OpenHarmony QEMU-vroot runtime artifact: ${OPTIMUSE_OHOS_VROOT_ARTIFACT}")
  endif()
endforeach()

add_library(optimuse_runtime_ohos SHARED optimuse_runtime_ohos.cpp)

target_compile_features(optimuse_runtime_ohos PRIVATE cxx_std_17)
target_include_directories(
  optimuse_runtime_ohos
  PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/libcpp_ohos_abi"
    "${OHOS_SDK_NATIVE}/llvm/include/c++/v1"
)
target_link_libraries(
  optimuse_runtime_ohos
  PUBLIC
    libace_napi.z.so
    dl
    "${OHOS_SDK_NATIVE}/llvm/lib/aarch64-linux-ohos/libc++_shared.so"
)
