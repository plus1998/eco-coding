import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';

const androidGlassBlurSigma = 20.0;
const androidGlassTintOpacity = 0.52;

double androidGlassTintAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark ? androidGlassTintOpacity : androidGlassTintOpacity + 0.04;
}

/// Frosted translucent surface for Android chrome (toolbar chips, tab bar, etc.).
class EcoAndroidGlassSurface extends StatelessWidget {
  const EcoAndroidGlassSurface({
    super.key,
    required this.child,
    this.width,
    this.height,
    this.borderRadius,
    this.padding,
    this.alignment = Alignment.center,
  });

  final Widget child;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final EdgeInsetsGeometry? padding;
  final AlignmentGeometry alignment;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final tintAlpha = androidGlassTintAlpha(context);
    final radius = borderRadius ?? BorderRadius.circular(16);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: androidGlassBlurSigma,
          sigmaY: androidGlassBlurSigma,
        ),
        child: Container(
          width: width,
          height: height,
          padding: padding,
          alignment: height == null && width == null ? null : alignment,
          decoration: BoxDecoration(
            color: eco.bgMain.withValues(alpha: tintAlpha * 0.72),
            borderRadius: radius,
            border: Border.all(
              color: eco.textHeading.withValues(alpha: isDark ? 0.12 : 0.08),
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
