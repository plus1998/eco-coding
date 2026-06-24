import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

const composerStackHorizontalPadding = 12.0;
const composerStackItemGap = 8.0;
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
    final shape = stadium
        ? StadiumBorder(side: BorderSide(color: eco.composerPillBorder))
        : RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: eco.composerPillBorder),
          );

    return Material(
      color: eco.composerPillBg,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
