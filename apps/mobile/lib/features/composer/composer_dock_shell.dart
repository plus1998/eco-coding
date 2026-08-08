import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';
import '../../core/widgets/progressive_blur.dart';

const composerBottomFrostBlurSigma = 20.0;
const composerBottomFrostTintOpacity = 0.42;
const composerBottomFrostHeightFactor = 2 / 3;
const composerDockTopSpacing = 8.0;

double _composerBottomFrostTintAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark
      ? composerBottomFrostTintOpacity
      : composerBottomFrostTintOpacity + 0.04;
}

/// Frosted backdrop for the composer dock. Progressive blur dissolves toward
/// the top; tint gradient softens content under the chrome.
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
              final frostHeight =
                  constraints.maxHeight * composerBottomFrostHeightFactor;
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
        Padding(
          padding: const EdgeInsets.only(top: composerDockTopSpacing),
          child: child,
        ),
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

    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const ProgressiveBlur(
            maxSigma: composerBottomFrostBlurSigma,
            direction: ProgressiveBlurDirection.bottomToTop,
            falloff: 1.25,
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  eco.bgMain.withValues(alpha: 0),
                  eco.bgMain.withValues(alpha: tintAlpha * 0.35),
                  eco.bgMain.withValues(alpha: tintAlpha * 0.75),
                  eco.bgMain.withValues(alpha: tintAlpha),
                ],
                stops: const [0.0, 0.35, 0.72, 1.0],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
