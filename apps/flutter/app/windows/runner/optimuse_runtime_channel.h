#ifndef RUNNER_OPTIMUSE_RUNTIME_CHANNEL_H_
#define RUNNER_OPTIMUSE_RUNTIME_CHANNEL_H_

#include <flutter/flutter_engine.h>
#include <windows.h>

/// Registers the runtime channel for one Flutter engine and native window.
void RegisterOptimuseRuntimeChannel(flutter::FlutterEngine* engine, HWND window);

/// Stops runtime worker activity before bridge-library teardown.
void ShutdownOptimuseRuntimeChannel();

/// Processes a queued runtime task message on the platform thread.
bool HandleOptimuseRuntimeChannelWindowMessage(UINT message,
                                             WPARAM wparam,
                                             LPARAM lparam,
                                             LRESULT* result);

constexpr ULONG_PTR kOptimuseNotificationActivationCopyData = 0x4F504E41;

/// Processes a cross-process notification activation delivered to the main window.
bool HandleOptimuseNotificationActivationWindowMessage(UINT message,
                                                      WPARAM wparam,
                                                      LPARAM lparam,
                                                      LRESULT* result);

#endif  // RUNNER_OPTIMUSE_RUNTIME_CHANNEL_H_
