import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';

/// Same-hue shimmer: a soft highlight sweeps across [text] repeatedly.
class ShimmerText extends StatefulWidget {
  const ShimmerText({
    super.key,
    required this.text,
    this.style,
    required this.baseColor,
    this.highlightColor,
    this.duration = const Duration(milliseconds: 1800),
  });

  final String text;
  final TextStyle? style;
  final Color baseColor;
  final Color? highlightColor;
  final Duration duration;

  @override
  State<ShimmerText> createState() => _ShimmerTextState();
}

class _ShimmerTextState extends State<ShimmerText>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration)
      ..repeat();
  }

  @override
  void didUpdateWidget(covariant ShimmerText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.duration != widget.duration) {
      _controller
        ..duration = widget.duration
        ..repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final highlight = widget.highlightColor ??
        Color.lerp(widget.baseColor, ecoColors(context).shimmerHighlight, 0.55)!;
    final resolvedStyle =
        (widget.style ?? Theme.of(context).textTheme.bodySmall)?.copyWith(
              color: widget.baseColor,
              fontWeight: FontWeight.w500,
            );

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcIn,
          shaderCallback: (bounds) {
            final slide = _controller.value * 2 - 0.5;
            return LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                widget.baseColor,
                highlight,
                widget.baseColor,
              ],
              stops: [
                (slide - 0.35).clamp(0.0, 1.0),
                slide.clamp(0.0, 1.0),
                (slide + 0.35).clamp(0.0, 1.0),
              ],
            ).createShader(bounds);
          },
          child: Text(widget.text, style: resolvedStyle),
        );
      },
    );
  }
}
