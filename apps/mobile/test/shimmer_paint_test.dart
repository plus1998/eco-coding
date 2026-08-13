import 'package:eco_mobile/core/utils/shimmer_paint.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('shimmer paint interval targets about 30fps', () {
    expect(shimmerPaintIntervalMs, 33);
  });

  test('shouldEmitShimmerPaint waits for the cadence', () {
    expect(
      shouldEmitShimmerPaint(nowMs: 100, lastPaintMs: 80, minIntervalMs: 33),
      isFalse,
    );
    expect(
      shouldEmitShimmerPaint(nowMs: 113, lastPaintMs: 80, minIntervalMs: 33),
      isTrue,
    );
    expect(
      shouldEmitShimmerPaint(nowMs: 0, lastPaintMs: null, minIntervalMs: 33),
      isTrue,
    );
  });

  test('shimmerPhaseFromElapsed loops over the duration', () {
    expect(shimmerPhaseFromElapsed(ms: 0, durationMs: 1800), 0.0);
    expect(shimmerPhaseFromElapsed(ms: 900, durationMs: 1800), 0.5);
    expect(shimmerPhaseFromElapsed(ms: 1800, durationMs: 1800), 0.0);
    expect(shimmerPhaseFromElapsed(ms: 2700, durationMs: 1800), 0.5);
  });

  test('resolveShimmerPeak brightens beyond a muted highlight', () {
    const base = Color(0xFF8A8A8A);
    const mutedHighlight = Color(0xFFA0A0A0);
    const peak = Color(0xFFFFFFFF);

    final resolved = resolveShimmerPeak(
      base: base,
      highlight: mutedHighlight,
      peak: peak,
    );

    expect(
      resolved.computeLuminance(),
      greaterThan(mutedHighlight.computeLuminance()),
    );
    expect(resolved.computeLuminance(), lessThan(peak.computeLuminance()));
  });

  test('shimmerSlideStops keep a tight bright band', () {
    final stops = shimmerSlideStops(0.5);
    expect(stops.length, 5);
    expect(stops[0], lessThan(stops[1]));
    expect(stops[1], lessThan(stops[2]));
    expect(stops[2], closeTo(0.5, 0.001));
    expect(stops[3], greaterThan(stops[2]));
    expect(stops[4], greaterThan(stops[3]));
    expect(stops[4] - stops[0], lessThan(0.55));
  });

  test('shimmerSlideStops stay strictly increasing at the edges', () {
    for (final slide in [0.0, 0.05, 0.95, 1.0]) {
      final stops = shimmerSlideStops(slide);
      for (var i = 1; i < stops.length; i++) {
        expect(stops[i], greaterThan(stops[i - 1]), reason: 'slide=$slide');
      }
    }
  });
}
