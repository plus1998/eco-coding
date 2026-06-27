import 'package:flutter/material.dart';

/// Bordered surface with anti-aliased clipping so inner content cannot paint
/// over the rounded border (a common issue with InkWell + diff backgrounds).
class EcoSurfaceCard extends StatelessWidget {
  const EcoSurfaceCard({
    super.key,
    required this.child,
    this.onTap,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
    required this.borderColor,
    this.backgroundColor,
  });

  final Widget child;
  final VoidCallback? onTap;
  final BorderRadius borderRadius;
  final Color borderColor;
  final Color? backgroundColor;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: borderRadius,
      side: BorderSide(color: borderColor),
    );
    return Material(
      color: backgroundColor ?? Colors.transparent,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: child,
      ),
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

/// Clips overflowing preview content and optionally draws a bottom fade.
class EcoClippedFadeBody extends StatelessWidget {
  const EcoClippedFadeBody({
    super.key,
    required this.expanded,
    required this.child,
    this.collapsedMaxHeight = 132,
    this.showFade = false,
    this.fadeColor,
    this.fadeHeight = 44,
  });

  final bool expanded;
  final Widget child;
  final double collapsedMaxHeight;
  final bool showFade;
  final Color? fadeColor;
  final double fadeHeight;

  @override
  Widget build(BuildContext context) {
    final resolvedFadeColor = fadeColor ?? Theme.of(context).cardColor;

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
    }

    if (!expanded && showFade) {
      return Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          body,
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: fadeHeight,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      resolvedFadeColor.withValues(alpha: 0),
                      resolvedFadeColor,
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    }

    return body;
  }
}
