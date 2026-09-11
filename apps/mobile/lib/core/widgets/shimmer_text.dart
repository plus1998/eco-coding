import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';
import '../utils/shimmer_paint.dart';

/// Same-hue shimmer: a soft highlight sweeps across [text] repeatedly.
///
/// Uses [AnimationController] (driven by the widget's [Ticker]) instead of a
/// raw Timer so the shimmer animation is integrated with Flutter's frame
/// scheduler and does not force extra vsync callbacks.
class ShimmerText extends StatefulWidget {
  const ShimmerText({
    super.key,
    required this.text,
    this.style,
    required this.baseColor,
    this.highlightColor,
    this.duration = const Duration(milliseconds: 1800),
    this.maxLines,
    this.overflow,
  });

  final String text;
  final TextStyle? style;
  final Color baseColor;
  final Color? highlightColor;
  final Duration duration;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  State<ShimmerText> createState() => _ShimmerTextState();
}

class _ShimmerTextState extends State<ShimmerText>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    )..repeat();
    _controller.addListener(_onTick);
  }

  @override
  void didUpdateWidget(covariant ShimmerText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.duration != widget.duration) {
      _controller
        ..duration = widget.duration
        ..stop()
        ..repeat();
    }
  }

  void _onTick() {
    if (!mounted) return;
    setState(() {});
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final phase = _controller.value;
    final peakWhite = ecoColors(context).shimmerHighlight;
    final peak = resolveShimmerPeak(
      base: widget.baseColor,
      highlight: widget.highlightColor,
      peak: peakWhite,
    );
    final mid =
        widget.highlightColor ?? Color.lerp(widget.baseColor, peakWhite, 0.45)!;
    final resolvedStyle = (widget.style ?? Theme.of(context).textTheme.bodySmall)
        ?.copyWith(
      color: widget.baseColor,
      fontWeight: FontWeight.w500,
    );

    return RepaintBoundary(
      child: ShaderMask(
        blendMode: BlendMode.srcIn,
        shaderCallback: (bounds) {
          if (!bounds.isFinite || bounds.width <= 0 || bounds.height <= 0) {
            return LinearGradient(
              colors: [widget.baseColor, widget.baseColor],
            ).createShader(bounds);
          }
          final bandWidth = bounds.width * shimmerBandWidthFactor;
          final left = shimmerBandLeft(phase: phase, textWidth: bounds.width);
          return LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [widget.baseColor, mid, peak, mid, widget.baseColor],
            stops: const [0.0, 0.32, 0.5, 0.68, 1.0],
            tileMode: TileMode.clamp,
          ).createShader(
            Rect.fromLTWH(left, bounds.top, bandWidth, bounds.height),
          );
        },
        child: Text(
          widget.text,
          style: resolvedStyle,
          maxLines: widget.maxLines,
          overflow: widget.overflow ?? TextOverflow.clip,
        ),
      ),
    );
  }
}
