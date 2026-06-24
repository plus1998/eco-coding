import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

const composerBottomFrostBlurSigma = 20.0;
const composerBottomFrostTintOpacity = 0.52;

double _composerBottomFrostTintAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark
      ? composerBottomFrostTintOpacity
      : composerBottomFrostTintOpacity + 0.04;
}

/// Frosted backdrop for the composer dock. Covers the bottom half of the dock,
/// fading to transparent toward the top (mirror of [SessionTopFrostGradient]).
class ComposerDockShell extends StatelessWidget {
  const ComposerDockShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final frostHeight = constraints.maxHeight * 0.5;
              if (frostHeight <= 0) {
                return const SizedBox.shrink();
              }
              return Align(
                alignment: Alignment.bottomCenter,
                child: _ComposerBottomFrost(height: frostHeight),
              );
            },
          ),
        ),
        child,
      ],
    );
  }
}

class _ComposerBottomFrost extends StatelessWidget {
  const _ComposerBottomFrost({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final tintAlpha = _composerBottomFrostTintAlpha(context);

    return ClipRect(
      child: SizedBox(
        height: height,
        width: double.infinity,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: composerBottomFrostBlurSigma,
            sigmaY: composerBottomFrostBlurSigma,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  eco.bgMain.withValues(alpha: 0),
                  eco.bgMain.withValues(alpha: tintAlpha * 0.42),
                  eco.bgMain.withValues(alpha: tintAlpha * 0.82),
                  eco.bgMain.withValues(alpha: tintAlpha),
                ],
                stops: const [0.0, 0.35, 0.72, 1.0],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
