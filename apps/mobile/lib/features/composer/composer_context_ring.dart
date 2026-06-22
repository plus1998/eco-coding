import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

class ComposerContextRing extends StatelessWidget {
  const ComposerContextRing({
    super.key,
    required this.pct,
    this.size = 14,
    this.strokeWidth = 2,
  });

  final int pct;
  final double size;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    final radius = (size - strokeWidth) / 2;
    final center = size / 2;
    final circumference = 2 * 3.141592653589793 * radius;
    final clampedPct = pct.clamp(0, 100);
    final offset = circumference * (1 - clampedPct / 100);
    final progressColor = pct >= 95
        ? EcoColors.danger
        : (pct >= 85 ? const Color(0xFFFBBF24) : EcoColors.accentText);

    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _ComposerContextRingPainter(
          radius: radius,
          center: center,
          strokeWidth: strokeWidth,
          progressOffset: offset,
          circumference: circumference,
          trackColor: ecoThemeExtras(context).borderSubtle,
          progressColor: progressColor,
        ),
      ),
    );
  }
}

class _ComposerContextRingPainter extends CustomPainter {
  _ComposerContextRingPainter({
    required this.radius,
    required this.center,
    required this.strokeWidth,
    required this.progressOffset,
    required this.circumference,
    required this.trackColor,
    required this.progressColor,
  });

  final double radius;
  final double center;
  final double strokeWidth;
  final double progressOffset;
  final double circumference;
  final Color trackColor;
  final Color progressColor;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    paint.color = trackColor;
    canvas.drawCircle(Offset(center, center), radius, paint);
    if (progressOffset < circumference) {
      paint.color = progressColor;
      paint.strokeCap = StrokeCap.round;
      canvas.drawArc(
        Rect.fromCircle(center: Offset(center, center), radius: radius),
        -1.5707963267948966,
        2 * 3.141592653589793 * (1 - progressOffset / circumference),
        false,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ComposerContextRingPainter oldDelegate) {
    return oldDelegate.progressOffset != progressOffset ||
        oldDelegate.progressColor != progressColor ||
        oldDelegate.trackColor != trackColor;
  }
}
