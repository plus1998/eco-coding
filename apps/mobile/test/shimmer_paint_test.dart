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

  test(
    'shimmerBandLeft starts and ends off-screen so the loop is continuous',
    () {
      const textWidth = 100.0;
      final start = shimmerBandLeft(phase: 0, textWidth: textWidth);
      final end = shimmerBandLeft(phase: 1, textWidth: textWidth);
      final mid = shimmerBandLeft(phase: 0.5, textWidth: textWidth);
      final bandWidth = textWidth * shimmerBandWidthFactor;

      expect(start + bandWidth, lessThanOrEqualTo(0));
      expect(end, greaterThanOrEqualTo(textWidth));
      expect(mid + bandWidth / 2, closeTo(textWidth / 2, 0.5));
      expect(shimmerBandOffscreen(phase: 0, textWidth: textWidth), isTrue);
      expect(shimmerBandOffscreen(phase: 1, textWidth: textWidth), isTrue);
      expect(shimmerBandOffscreen(phase: 0.5, textWidth: textWidth), isFalse);
    },
  );

  test('shimmerBandLeft travels continuously across the text', () {
    const textWidth = 80.0;
    var previous = shimmerBandLeft(phase: 0, textWidth: textWidth);
    for (var step = 1; step <= 20; step++) {
      final next = shimmerBandLeft(phase: step / 20, textWidth: textWidth);
      expect(next, greaterThan(previous), reason: 'step=$step');
      previous = next;
    }
  });
}
