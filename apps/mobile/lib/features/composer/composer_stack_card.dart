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

class ComposerStackCard extends StatelessWidget {
  const ComposerStackCard({
    super.key,
    required this.child,
    this.onTap,
    this.stadium = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool stadium;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isLight = Theme.of(context).brightness == Brightness.light;
    // Light: rely on fill contrast; avoid opaque stroke replacing token alpha.
    final borderColor = isLight
        ? const Color(0x123C3C43) // ~7%
        : eco.composerPillBorder.withValues(alpha: 0.35);
    final shape = stadium
        ? StadiumBorder(side: BorderSide(color: borderColor, width: 0.5))
        : RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: borderColor, width: 0.5),
          );

    return Material(
      color: eco.composerPillBg,
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
  }
}
