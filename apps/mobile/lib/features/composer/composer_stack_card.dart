import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

const composerStackHorizontalPadding = 12.0;
const composerStackItemGap = 8.0;
const composerStackRowPadding = EdgeInsets.symmetric(
  horizontal: 12,
  vertical: 8,
);
const composerStackOuterPadding = EdgeInsets.fromLTRB(
  composerStackHorizontalPadding,
  0,
  composerStackHorizontalPadding,
  composerStackItemGap,
);

const _composerFrostBlurSigma = 22.0;

class ComposerStackCard extends StatelessWidget {
  const ComposerStackCard({
    super.key,
    required this.child,
    this.onTap,
    this.stadium = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    this.frosted = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool stadium;
  final EdgeInsets padding;

  /// Flutter frosted glass. iOS liquid glass stays on the native button path.
  final bool frosted;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isLight = Theme.of(context).brightness == Brightness.light;
    final radius = BorderRadius.circular(stadium ? 999 : 12);
    final borderColor = frosted
        ? (isLight
              ? const Color(0x293C3C43) // ~16%
              : eco.composerPillBorder.withValues(alpha: 0.4))
        : (isLight
              ? eco.composerPillBorder
              : eco.composerPillBorder.withValues(alpha: 0.35));
    final shape = stadium
        ? StadiumBorder(
            side: frosted
                ? BorderSide.none
                : BorderSide(color: borderColor, width: 0.5),
          )
        : RoundedRectangleBorder(
            borderRadius: radius,
            side: frosted
                ? BorderSide.none
                : BorderSide(color: borderColor, width: 0.5),
          );

    final content = Material(
      color: frosted
          ? Colors.transparent
          : eco.composerPillBg,
      elevation: 0,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        customBorder: shape,
        child: Padding(padding: padding, child: child),
      ),
    );

    if (!frosted) return content;

    // Frosted veil: blur carries the weight — keep tint light so glass can breathe.
    final tint = isLight
        ? const Color(0x33FFFFFF) // ~20% white
        : Colors.white.withValues(alpha: 0.20);

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _composerFrostBlurSigma,
          sigmaY: _composerFrostBlurSigma,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: tint,
            borderRadius: radius,
            border: Border.all(color: borderColor, width: 0.5),
          ),
          child: content,
        ),
      ),
    );
  }
}
