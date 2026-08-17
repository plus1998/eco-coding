import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';
import '../utils/shimmer_paint.dart';

/// Same-hue shimmer: a soft highlight sweeps across [text] repeatedly.
///
/// Paints are capped near 30fps so a soft sweep does not force ProMotion /
/// 120Hz whole-tree raster (especially costly next to [BackdropFilter] frost).
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

class _ShimmerTextState extends State<ShimmerText> {
  Timer? _timer;
  double _phase = 0;
  late DateTime _startedAt;

  @override
  void initState() {
    super.initState();
    _startedAt = DateTime.now();
    _tick();
    _timer = Timer.periodic(
      const Duration(milliseconds: shimmerPaintIntervalMs),
      (_) => _tick(),
    );
  }

  @override
  void didUpdateWidget(covariant ShimmerText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.duration != widget.duration) {
      _startedAt = DateTime.now();
      _tick();
    }
  }

  void _tick() {
    if (!mounted) return;
    final now = DateTime.now();
    final next = shimmerPhaseFromElapsed(
      ms: now.difference(_startedAt).inMilliseconds,
      durationMs: widget.duration.inMilliseconds,
    );
    if (next == _phase) return;
    setState(() => _phase = next);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final peakWhite = ecoColors(context).shimmerHighlight;
    final peak = resolveShimmerPeak(
      base: widget.baseColor,
      highlight: widget.highlightColor,
      peak: peakWhite,
    );
    final mid =
        widget.highlightColor ?? Color.lerp(widget.baseColor, peakWhite, 0.45)!;
    final resolvedStyle =
        (widget.style ?? Theme.of(context).textTheme.bodySmall)?.copyWith(
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
          final left = shimmerBandLeft(phase: _phase, textWidth: bounds.width);
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
