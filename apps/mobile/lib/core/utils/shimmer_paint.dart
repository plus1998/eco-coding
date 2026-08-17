import 'dart:ui';

/// Cap continuous shimmer paints near 30fps to limit whole-tree raster load.
const shimmerPaintIntervalMs = 33;

/// Highlight band width as a fraction of the text width.
const shimmerBandWidthFactor = 0.44;

bool shouldEmitShimmerPaint({
  required int nowMs,
  required int? lastPaintMs,
  int minIntervalMs = shimmerPaintIntervalMs,
}) {
  if (lastPaintMs == null) return true;
  return nowMs - lastPaintMs >= minIntervalMs;
}

/// Looping 0..1 phase for a shimmer sweep of [durationMs].
double shimmerPhaseFromElapsed({required int ms, required int durationMs}) {
  if (durationMs <= 0) return 0;
  return (ms % durationMs) / durationMs;
}

/// Bright peak for the sweep. Call-site highlights are often only slightly
/// lighter than [base]; pull further toward [peak] so the flash reads clearly.
Color resolveShimmerPeak({
  required Color base,
  Color? highlight,
  required Color peak,
  double midt = 0.45,
  double peakt = 0.72,
}) {
  final mid = highlight ?? Color.lerp(base, peak, midt)!;
  return Color.lerp(mid, peak, peakt)!;
}

/// Left edge of the traveling highlight band in text-local x.
///
/// Phase 0 sits fully left of the text; phase 1 sits fully right. Both ends
/// clamp to the base color, so the loop wrap is a continuous sweep instead of
/// a first-frame hitch at the edge.
double shimmerBandLeft({
  required double phase,
  required double textWidth,
  double bandWidthFactor = shimmerBandWidthFactor,
}) {
  final width = textWidth < 0 ? 0.0 : textWidth;
  final bandWidth = width * bandWidthFactor;
  final t = phase.clamp(0.0, 1.0);
  return -bandWidth + t * (width + bandWidth);
}

/// True when the highlight band does not overlap the text (loop wrap / start).
bool shimmerBandOffscreen({
  required double phase,
  required double textWidth,
  double bandWidthFactor = shimmerBandWidthFactor,
}) {
  final width = textWidth < 0 ? 0.0 : textWidth;
  final bandWidth = width * bandWidthFactor;
  final left = shimmerBandLeft(
    phase: phase,
    textWidth: width,
    bandWidthFactor: bandWidthFactor,
  );
  return left + bandWidth <= 0 || left >= width;
}
