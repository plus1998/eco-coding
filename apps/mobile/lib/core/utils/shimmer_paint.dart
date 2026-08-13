import 'dart:ui';

/// Cap continuous shimmer paints near 30fps to limit whole-tree raster load.
const shimmerPaintIntervalMs = 33;

bool shouldEmitShimmerPaint({
  required int nowMs,
  required int? lastPaintMs,
  int minIntervalMs = shimmerPaintIntervalMs,
}) {
  if (lastPaintMs == null) return true;
  return nowMs - lastPaintMs >= minIntervalMs;
}

/// Looping 0..1 phase for a shimmer sweep of [durationMs].
double shimmerPhaseFromElapsed({
  required int ms,
  required int durationMs,
}) {
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

/// Five stops for base → mid → peak → mid → base around [slide] (0..1).
/// Always strictly increasing so [LinearGradient] stays valid at the edges.
List<double> shimmerSlideStops(double slide) {
  final center = slide.clamp(0.0, 1.0);
  final raw = <double>[
    center - 0.22,
    center - 0.08,
    center,
    center + 0.08,
    center + 0.22,
  ];
  final stops = <double>[];
  for (final value in raw) {
    final clamped = value.clamp(0.0, 1.0);
    if (stops.isEmpty) {
      stops.add(clamped);
      continue;
    }
    final minNext = stops.last + 0.001;
    stops.add(clamped < minNext ? minNext.clamp(0.0, 1.0) : clamped);
  }
  // If we piled up at 1.0, walk backward to keep strict order.
  for (var i = stops.length - 2; i >= 0; i--) {
    final maxPrev = stops[i + 1] - 0.001;
    if (stops[i] > maxPrev) {
      stops[i] = maxPrev.clamp(0.0, 1.0);
    }
  }
  return stops;
}
