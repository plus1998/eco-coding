import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';
import 'eco_android_glass.dart';

/// Platform-adaptive glass action button for primary actions
/// (e.g. "扫一扫", "进入应用").
class AdaptiveGlassActionButton extends StatelessWidget {
  const AdaptiveGlassActionButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.height = 52.0,
    this.isStadium = true,
    this.expand = true,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final double height;
  final bool isStadium;

  /// When true, fills the parent's width. When false, hugs label + icon.
  final bool expand;

  static const _labelStyle = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );
  static const _iconSize = 20.0;
  static const _iconGap = 8.0;
  static const _hugHorizontalPadding = 22.0;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onPressed != null;
    final color = enabled
        ? eco.textHeading
        : eco.textHeading.withValues(alpha: 0.38);

    final borderRadius = BorderRadius.circular(isStadium ? height / 2 : 16);
    final labelStyle = _labelStyle.copyWith(color: color);

    Widget labelRow({required bool hug}) {
      final text = Text(
        label,
        style: labelStyle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        softWrap: false,
      );
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: hug ? MainAxisSize.min : MainAxisSize.max,
        children: [
          if (icon != null) ...[
            Icon(icon, size: _iconSize, color: color),
            const SizedBox(width: _iconGap),
          ],
          if (hug) text else Flexible(child: text),
        ],
      );
    }

    if (PlatformInfo.isAndroid) {
      // Hug: size from content. Fixed _hugWidth + inner padding undercounted text
      // (no textScaler) and overflowed the Row (~93px).
      final chip = EcoAndroidGlassSurface(
        height: height,
        width: expand ? double.infinity : null,
        borderRadius: borderRadius,
        padding: EdgeInsets.symmetric(
          horizontal: expand ? 0 : _hugHorizontalPadding,
        ),
        alignment: Alignment.center,
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: onPressed,
            customBorder: RoundedRectangleBorder(borderRadius: borderRadius),
            child: SizedBox(
              height: height,
              width: expand ? double.infinity : null,
              child: Center(child: labelRow(hug: !expand)),
            ),
          ),
        ),
      );
      if (expand) return chip;
      return SizedBox(
        height: height,
        width: double.infinity,
        child: Center(child: chip),
      );
    }

    // iOS untouched path (user: leave native glass as-is).
    const nativeLargeHeight = 44.0;
    final hugWidth = _hugWidth(context, labelStyle);
    // iOS26Button only syncs native enabled when [enabled] flips — not when
    // [onPressed] alone changes. Mirror disabled state via [enabled] so
    // "进入应用" unlocks after PC selection (Android InkWell already does).
    final button = AdaptiveButton.child(
      onPressed: onPressed,
      enabled: enabled,
      style: AdaptiveButtonStyle.glass,
      size: AdaptiveButtonSize.large,
      minSize: Size(
        expand ? double.infinity : hugWidth,
        nativeLargeHeight,
      ),
      useSmoothRectangleBorder: false,
      child: expand
          ? labelRow(hug: false)
          : Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: _hugHorizontalPadding,
              ),
              child: labelRow(hug: true),
            ),
    );

    return SizedBox(
      height: height,
      width: double.infinity,
      child: Center(
        child: SizedBox(
          height: nativeLargeHeight,
          width: expand ? double.infinity : hugWidth,
          child: button,
        ),
      ),
    );
  }

  double _hugWidth(BuildContext context, TextStyle labelStyle) {
    final painter = TextPainter(
      text: TextSpan(text: label, style: labelStyle),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: 1,
    )..layout();
    final iconWidth = icon != null ? _iconSize + _iconGap : 0.0;
    return painter.width + iconWidth + (_hugHorizontalPadding * 2);
  }
}
