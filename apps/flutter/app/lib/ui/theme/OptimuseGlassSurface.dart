// ignore_for_file: file_names

import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'OptimuseTheme.dart';

enum OptimuseGlassSurfaceLayer { panel, card, control }

class OptimuseGlassSurface extends StatelessWidget {
  const OptimuseGlassSurface({
    super.key,
    required this.child,
    required this.color,
    this.borderRadius = BorderRadius.zero,
    this.border,
    this.shadows = const <BoxShadow>[],
    this.layer = OptimuseGlassSurfaceLayer.card,
    this.transparentAlpha,
    this.material = false,
    this.enableBackdropFilter = true,
    this.clip = true,
  });

  final Widget child;
  final Color color;
  final BorderRadius borderRadius;
  final BoxBorder? border;
  final List<BoxShadow> shadows;
  final OptimuseGlassSurfaceLayer layer;
  final double? transparentAlpha;
  final bool material;

  /// Keeps translucent styling without paying for a per-surface blur pass.
  final bool enableBackdropFilter;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final transparentSurface = OptimuseTheme.of(
      context,
    ).themePreferenceSnapshot.transparentSurfaceEnabled;
    final content = material
        ? Material(color: Colors.transparent, child: child)
        : child;
    if (!transparentSurface) {
      return _clipIfNeeded(
        DecoratedBox(
          decoration: BoxDecoration(
            color: color,
            borderRadius: borderRadius,
            border: border,
            boxShadow: shadows,
          ),
          child: content,
        ),
      );
    }

    final style = _styleForLayer(layer);
    final decoration = BoxDecoration(
      color: color.withValues(alpha: transparentAlpha ?? style.alpha),
      borderRadius: borderRadius,
      border: border,
      boxShadow: shadows
          .map(
            (shadow) => BoxShadow(
              color: shadow.color.withValues(alpha: 0.08),
              offset: shadow.offset,
              blurRadius: shadow.blurRadius,
              spreadRadius: shadow.spreadRadius,
            ),
          )
          .toList(growable: false),
    );
    if (!enableBackdropFilter) {
      return _clipIfNeeded(
        DecoratedBox(decoration: decoration, child: content),
      );
    }
    return _clipBackdrop(
      BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: style.blur, sigmaY: style.blur),
        child: DecoratedBox(decoration: decoration, child: content),
      ),
    );
  }

  Widget _clipIfNeeded(Widget child) {
    if (!clip) {
      return child;
    }
    return ClipRRect(borderRadius: borderRadius, child: child);
  }

  Widget _clipBackdrop(Widget child) {
    if (!clip) {
      return ClipRect(child: child);
    }
    return ClipRRect(borderRadius: borderRadius, child: child);
  }
}

class _OptimuseGlassSurfaceStyle {
  const _OptimuseGlassSurfaceStyle({required this.blur, required this.alpha});

  final double blur;
  final double alpha;
}

_OptimuseGlassSurfaceStyle _styleForLayer(OptimuseGlassSurfaceLayer layer) {
  return switch (layer) {
    OptimuseGlassSurfaceLayer.panel => const _OptimuseGlassSurfaceStyle(
      blur: 16,
      alpha: 0.045,
    ),
    OptimuseGlassSurfaceLayer.card => const _OptimuseGlassSurfaceStyle(
      blur: 14,
      alpha: 0.16,
    ),
    OptimuseGlassSurfaceLayer.control => const _OptimuseGlassSurfaceStyle(
      blur: 10,
      alpha: 0.28,
    ),
  };
}
