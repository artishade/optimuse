import 'dart:convert';

import 'package:file_selector/file_selector.dart' as selector;
import 'package:flutter/services.dart';

/// A platform-selected mount source, not an assumed physical file path.
class FolderMountSource {
  const FolderMountSource({
    required this.backend,
    required this.root,
    required this.namespace,
    required this.name,
  });

  final String backend;
  final String root;
  final String namespace;
  final String name;

  factory FolderMountSource.native(String path) {
    final normalized = path
        .replaceAll(r'\', '/')
        .replaceAll(RegExp(r'/+$'), '');
    final label = normalized.split('/').last;
    return FolderMountSource(
      backend: 'native',
      root: path,
      namespace: '/mnt/local/folders',
      name: label.isEmpty ? path : label,
    );
  }

  factory FolderMountSource.fromMap(Map<String, Object?> map) =>
      FolderMountSource(
        backend: map['backend'] as String,
        root: map['root'] as String,
        namespace: map['namespace'] as String,
        name: map['name'] as String,
      );

  /// The binding API accepts this descriptor and returns a persistent VFS mount.
  String encode() =>
      'optimuse-mount:${jsonEncode(<String, String>{'backend': backend, 'root': root, 'namespace': namespace, 'name': name})}';
}

/// Unified folder selection. Platform registration, not business code, chooses
/// the implementation. Storage-root selection returns native paths; workspace
/// selection may return a persistently authorized document-tree URI.
abstract final class OptimuseFolderAccess {
  /// Returns an empty list when the user cancels. Platform limitations and
  /// permission errors are propagated to the caller.
  static Future<List<String>> pickDirectories({String? initialDirectory}) =>
      OptimuseFolderAccessPlatform.instance.pickDirectories(
        initialDirectory: initialDirectory,
      );

  /// Selects a mount source. Android returns an authorized SAF tree URI;
  /// other platforms retain their native/security-scoped directory selection.
  static Future<FolderMountSource?> pickWorkspaceDirectory({
    String? initialDirectory,
  }) => OptimuseFolderAccessPlatform.instance.pickWorkspaceDirectory(
    initialDirectory: initialDirectory,
  );

  static Future<String?> pickDirectory({String? initialDirectory}) =>
      OptimuseFolderAccessPlatform.instance.pickDirectory(
        initialDirectory: initialDirectory,
      );
}

/// Defaults to file_selector and its registered native/web platform delegates.
abstract class OptimuseFolderAccessPlatform {
  static OptimuseFolderAccessPlatform instance = _FileSelectorFolderAccess();

  Future<String?> pickDirectory({String? initialDirectory});

  Future<FolderMountSource?> pickWorkspaceDirectory({
    String? initialDirectory,
  }) async {
    final path = await pickDirectory(initialDirectory: initialDirectory);
    return path == null ? null : FolderMountSource.native(path);
  }

  Future<List<String>> pickDirectories({String? initialDirectory});
}

class _FileSelectorFolderAccess extends OptimuseFolderAccessPlatform {
  @override
  Future<List<String>> pickDirectories({String? initialDirectory}) async =>
      (await selector.getDirectoryPaths(
        initialDirectory: initialDirectory,
      )).whereType<String>().toList(growable: false);

  @override
  Future<String?> pickDirectory({String? initialDirectory}) =>
      selector.getDirectoryPath(initialDirectory: initialDirectory);
}

/// Installed by Flutter's generated macOS plugin registrant. No runtime
/// platform checks or distribution policy live in Dart.
class OptimuseFolderAccessMacOS extends OptimuseFolderAccessPlatform {
  static const MethodChannel _channel = MethodChannel('optimuse/folder_access');

  @override
  Future<List<String>> pickDirectories({String? initialDirectory}) async =>
      await _channel.invokeListMethod<String>(
        'pickDirectories',
        <String, Object?>{'initialDirectory': initialDirectory},
      ) ??
      const <String>[];

  static void registerWith() {
    OptimuseFolderAccessPlatform.instance = OptimuseFolderAccessMacOS();
  }

  @override
  Future<String?> pickDirectory({String? initialDirectory}) =>
      _channel.invokeMethod<String>('pickDirectory', <String, Object?>{
        'initialDirectory': initialDirectory,
      });
}

/// Android-only registration; ordinary storage roots still use file_selector.
class OptimuseFolderAccessAndroid extends _FileSelectorFolderAccess {
  static const MethodChannel _channel = MethodChannel('optimuse/folder_access');

  static void registerWith() {
    OptimuseFolderAccessPlatform.instance = OptimuseFolderAccessAndroid();
  }

  @override
  Future<FolderMountSource?> pickWorkspaceDirectory({
    String? initialDirectory,
  }) async {
    final selection = await _channel.invokeMapMethod<String, Object?>(
      'pickWorkspaceDirectory',
      <String, Object?>{'initialDirectory': initialDirectory},
    );
    return selection == null ? null : FolderMountSource.fromMap(selection);
  }
}
