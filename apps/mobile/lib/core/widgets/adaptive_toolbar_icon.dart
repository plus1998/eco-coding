import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../theme/eco_adaptive_icons.dart';
import '../theme/eco_theme.dart';

/// Default outer touch target for toolbar glass buttons.
const adaptiveToolbarTouchSize = 44.0;

/// Compact toolbar chips — session header and shell app-bar actions.
const sessionToolbarButtonSize = 40.0;
const sessionToolbarButtonGap = 8.0;

/// Icon point size relative to the native square glass button.
const adaptiveToolbarIconScale = 0.38;

class AdaptiveToolbarIcon extends StatelessWidget {
  const AdaptiveToolbarIcon({
    super.key,
    required this.icon,
    required this.onPressed,
    this.tooltip,
    this.size = adaptiveToolbarTouchSize,
    this.iconSize,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;

  /// Minimum tap target (width and height).
  final double size;

  /// SF Symbol / icon point size. Defaults to [adaptiveToolbarIconScale] × native extent.
  final double? iconSize;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onPressed != null;
    final color = enabled
        ? eco.textHeading
        : eco.textHeading.withValues(alpha: 0.38);
    final buttonSize = _resolveButtonSize(size);
    final nativeExtent = _nativeExtent(buttonSize);
    final resolvedIconSize = iconSize ?? nativeExtent * adaptiveToolbarIconScale;
    final style = PlatformInfo.isIOS
        ? AdaptiveButtonStyle.glass
        : AdaptiveButtonStyle.gray;

    final Widget button;
    final sfSymbol = ecoIconSfSymbol(icon);
    if (PlatformInfo.isIOS26OrHigher() && sfSymbol != null) {
      button = AdaptiveButton.sfSymbol(
        onPressed: onPressed,
        sfSymbol: SFSymbol(sfSymbol, size: resolvedIconSize, color: color),
        style: style,
        size: buttonSize,
        enabled: enabled,
        useSmoothRectangleBorder: false,
      );
    } else if (PlatformInfo.isIOS26OrHigher()) {
      button = AdaptiveButton.child(
        onPressed: onPressed,
        style: style,
        size: buttonSize,
        enabled: enabled,
        useSmoothRectangleBorder: false,
        child: Icon(icon, size: resolvedIconSize, color: color),
      );
    } else {
      button = AdaptiveButton.icon(
        onPressed: onPressed,
        icon: icon,
        iconColor: color,
        style: style,
        size: buttonSize,
        enabled: enabled,
      );
    }

    // Keep the native glass control square so it is not stretched in a wide slot.
    final glassControl = SizedBox(
      width: nativeExtent,
      height: nativeExtent,
      child: Center(child: button),
    );

    final wrapped = SizedBox(
      width: size,
      height: size,
      child: Center(child: glassControl),
    );

    if (tooltip == null) return wrapped;
    return Tooltip(message: tooltip!, child: wrapped);
  }
}

AdaptiveButtonSize _resolveButtonSize(double targetSize) {
  if (targetSize < 34) return AdaptiveButtonSize.small;
  if (targetSize < 43) return AdaptiveButtonSize.medium;
  return AdaptiveButtonSize.large;
}

double _nativeExtent(AdaptiveButtonSize size) {
  return switch (size) {
    AdaptiveButtonSize.small => 28,
    AdaptiveButtonSize.medium => 36,
    AdaptiveButtonSize.large => 44,
  };
}
