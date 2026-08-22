import 'dart:io';

import 'package:flutter/material.dart';

/// Same mark as iOS `LaunchImage` / Android `ic_splash` (1024px source).
const ecoLaunchSplashMarkAsset = 'assets/launch-splash-mark.png';

/// Native launch backdrop — iOS LaunchScreen + Android `splash_background`.
const ecoLaunchSplashBackground = Color(0xFFFAF7F5);

/// Logical size of the centered mark on the native launch screen.
///
/// iOS `LaunchScreen.storyboard` uses `contentMode=center` with a 341pt image.
/// Android `launch_background` places the drawable at 288dp.
double get ecoLaunchSplashMarkSize => Platform.isIOS ? 341 : 288;

/// Pixel-matched twin of the native splash. Keep the mark fixed in the screen
/// center; optionally fade a spinner in underneath without moving the mark.
class EcoLaunchSplashSurface extends StatelessWidget {
  const EcoLaunchSplashSurface({
    super.key,
    this.spinnerOpacity = 0,
    this.semanticLabel,
  });

  /// 0 = splash twin only; 1 = loading spinner fully visible under the mark.
  final double spinnerOpacity;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final markSize = ecoLaunchSplashMarkSize;
    final child = ColoredBox(
      color: ecoLaunchSplashBackground,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: Image.asset(
              ecoLaunchSplashMarkAsset,
              width: markSize,
              height: markSize,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
              excludeFromSemantics: true,
            ),
          ),
          if (spinnerOpacity > 0)
            Center(
              child: Transform.translate(
                offset: Offset(0, markSize / 2 + 24),
                child: Opacity(
                  opacity: spinnerOpacity.clamp(0.0, 1.0),
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: const Color(0xFF007AFF).withValues(alpha: 0.85),
                      backgroundColor: const Color(
                        0xFF3C3C43,
                      ).withValues(alpha: 0.12),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );

    final label = semanticLabel;
    if (label == null || label.isEmpty) return child;
    return Semantics(label: label, liveRegion: true, child: child);
  }
}
