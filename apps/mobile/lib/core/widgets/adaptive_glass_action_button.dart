import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';
import 'eco_android_glass.dart';

/// Platform-adaptive glass action button for full-width or half-width actions
/// (e.g. "扫一扫", "进入应用").
class AdaptiveGlassActionButton extends StatelessWidget {
  const AdaptiveGlassActionButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.height = 52.0,
    this.isStadium = true,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final double height;
  final bool isStadium;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onPressed != null;
    final color = enabled
        ? eco.textHeading
        : eco.textHeading.withValues(alpha: 0.38);

    final borderRadius =
        BorderRadius.circular(isStadium ? height / 2 : 16);

    final row = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 8),
        ],
          Text(
          label,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.2,
            color: color,
          ),
        ),
      ],
    );

    if (PlatformInfo.isAndroid) {
      return EcoAndroidGlassSurface(
        height: height,
        borderRadius: borderRadius,
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: onPressed,
            customBorder: RoundedRectangleBorder(
              borderRadius: borderRadius,
            ),
            child: SizedBox(
              height: height,
              child: Center(child: row),
            ),
          ),
        ),
      );
    }

    // iOS / fallback
    return AdaptiveButton.child(
      onPressed: onPressed,
      style: AdaptiveButtonStyle.glass,
      size: AdaptiveButtonSize.large,
      minSize: Size(double.infinity, height),
      useSmoothRectangleBorder: false,
      child: row,
    );
  }
}
