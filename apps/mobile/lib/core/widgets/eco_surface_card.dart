import 'package:flutter/material.dart';

/// Soft surface with anti-aliased clipping so inner content cannot paint
/// over the rounded corners (a common issue with InkWell + diff backgrounds).
class EcoSurfaceCard extends StatelessWidget {
  const EcoSurfaceCard({
    super.key,
    required this.child,
    this.onTap,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
    required this.borderColor,
    this.backgroundColor,
    this.showBorder = true,
  });

  final Widget child;
  final VoidCallback? onTap;
  final BorderRadius borderRadius;
  final Color borderColor;
  final Color? backgroundColor;
  final bool showBorder;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: borderRadius,
      side: showBorder
          ? BorderSide(color: borderColor.withValues(alpha: 0.45), width: 0.5)
          : BorderSide.none,
    );
    return Material(
      color: backgroundColor ?? Colors.transparent,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? child : InkWell(onTap: onTap, child: child),
    );
  }
}

/// Diff / code preview line with a fixed-width left gutter aligned to the card edge.
class EcoDiffGutterLine extends StatelessWidget {
  const EcoDiffGutterLine({
    super.key,
    required this.text,
    required this.gutterColor,
    this.backgroundColor,
    this.style,
    this.gutterWidth = 3,
    this.contentPadding = const EdgeInsets.fromLTRB(10, 2, 12, 2),
  });

  final String text;
  final Color gutterColor;
  final Color? backgroundColor;
  final TextStyle? style;
  final double gutterWidth;
  final EdgeInsets contentPadding;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: backgroundColor ?? Colors.transparent,
        border: Border(
          left: BorderSide(color: gutterColor, width: gutterWidth),
        ),
      ),
      child: Padding(
        padding: contentPadding,
        child: Text(
          text.isEmpty ? ' ' : text,
          style: style,
          softWrap: true,
          overflow: TextOverflow.clip,
        ),
      ),
    );
  }
}

/// Clips overflowing preview content and optionally fades the bottom edge.
///
/// Uses [ShaderMask] + [BlendMode.dstIn] so content alpha falls off — avoids
/// painting an opaque color band that reads as a bright white block.
class EcoClippedFadeBody extends StatelessWidget {
  const EcoClippedFadeBody({
    super.key,
    required this.expanded,
    required this.child,
    this.collapsedMaxHeight = 132,
    this.showFade = false,
    this.fadeHeight = 44,
  });

  final bool expanded;
  final Widget child;
  final double collapsedMaxHeight;
  final bool showFade;
  final double fadeHeight;

  @override
  Widget build(BuildContext context) {
    Widget body = child;
    if (!expanded) {
      body = ClipRect(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: collapsedMaxHeight),
          child: SingleChildScrollView(
            physics: const NeverScrollableScrollPhysics(),
            clipBehavior: Clip.hardEdge,
            child: child,
          ),
        ),
      );

      if (showFade && fadeHeight > 0 && collapsedMaxHeight > 0) {
        final fadeStart =
            ((collapsedMaxHeight - fadeHeight) / collapsedMaxHeight).clamp(
              0.0,
              0.92,
            );
        body = ShaderMask(
          blendMode: BlendMode.dstIn,
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: const [
                Color(0xFF000000),
                Color(0xFF000000),
                Color(0x00000000),
              ],
              stops: [0, fadeStart, 1],
            ).createShader(bounds);
          },
          child: body,
        );
      }
    }

    return body;
  }
}
