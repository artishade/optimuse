// ignore_for_file: file_names

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/foundation.dart';

import 'OptimuseWindowArguments.dart';

/// Indicates whether the current platform supports desktop multi-window APIs.
bool get optimuseSupportsDesktopMultiWindow {
  if (kIsWeb) {
    return false;
  }
  final platform = defaultTargetPlatform;
  return platform == TargetPlatform.linux ||
      platform == TargetPlatform.macOS ||
      platform == TargetPlatform.windows;
}

/// Reads the arguments associated with the current desktop window.
Future<OptimuseWindowArguments> readOptimuseWindowArguments() async {
  if (!optimuseSupportsDesktopMultiWindow) {
    return const MainWindowArguments();
  }
  final windowController = await WindowController.fromCurrentEngine();
  return OptimuseWindowArguments.parse(windowController.arguments);
}
