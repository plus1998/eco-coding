import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';

class VoiceRecordingComposer extends StatelessWidget {
  const VoiceRecordingComposer({
    super.key,
    required this.audioLevel,
    required this.finishing,
    required this.onCancel,
    required this.onStop,
    required this.onSend,
  });

  final double audioLevel;
  final bool finishing;
  final VoidCallback onCancel;
  final VoidCallback onStop;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final controlFill = isDark
        ? colors.bgElevatedHover
        : const Color(0xFFE7E7E9);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: SizedBox(
          height: 62,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RoundVoiceButton(
                tooltip: MaterialLocalizations.of(context).cancelButtonLabel,
                backgroundColor: controlFill,
                onPressed: finishing ? null : onCancel,
                child: Icon(
                  EcoIcons.close,
                  size: 23,
                  color: colors.textHeading,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.composerContextBg.withValues(
                      alpha: isDark ? 0.96 : 0.94,
                    ),
                    borderRadius: BorderRadius.circular(31),
                    border: Border.all(
                      width: 0.5,
                      color: isDark
                          ? colors.borderSubtle.withValues(alpha: 0.55)
                          : const Color(0x143C3C43),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(18, 8, 7, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: _VoiceLevelWave(audioLevel: audioLevel),
                        ),
                        const SizedBox(width: 8),
                        _RoundVoiceButton(
                          tooltip: context.l10n.composerStopVoiceInput,
                          backgroundColor: controlFill,
                          onPressed: finishing ? null : onStop,
                          child: finishing
                              ? Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: colors.textSecondary,
                                  ),
                                )
                              : Center(
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      color: colors.textHeading,
                                      borderRadius: BorderRadius.circular(3),
                                    ),
                                    child: const SizedBox.square(dimension: 13),
                                  ),
                                ),
                        ),
                        const SizedBox(width: 6),
                        _RoundVoiceButton(
                          tooltip: context.l10n.composerSendHint,
                          backgroundColor: colors.composerSendBg,
                          onPressed: finishing ? null : onSend,
                          child: Icon(
                            EcoIcons.send,
                            size: 21,
                            color: colors.composerSendText,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundVoiceButton extends StatelessWidget {
  const _RoundVoiceButton({
    required this.tooltip,
    required this.backgroundColor,
    required this.onPressed,
    required this.child,
  });

  final String tooltip;
  final Color backgroundColor;
  final VoidCallback? onPressed;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: backgroundColor,
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          customBorder: const CircleBorder(),
          child: SizedBox.square(dimension: 46, child: child),
        ),
      ),
    );
  }
}

class _VoiceLevelWave extends StatefulWidget {
  const _VoiceLevelWave({required this.audioLevel});

  final double audioLevel;

  @override
  State<_VoiceLevelWave> createState() => _VoiceLevelWaveState();
}

class _VoiceLevelWaveState extends State<_VoiceLevelWave>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  double _displayLevel = 0;

  @override
  void initState() {
    super.initState();
    _displayLevel = widget.audioLevel;
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat();
  }

  @override
  void didUpdateWidget(covariant _VoiceLevelWave oldWidget) {
    super.didUpdateWidget(oldWidget);
    _displayLevel += (widget.audioLevel - _displayLevel) * 0.72;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final idlePulse =
              0.025 * (0.5 + 0.5 * math.sin(_controller.value * math.pi * 2));
          return CustomPaint(
            painter: _VoiceLevelPainter(
              phase: _controller.value,
              level: math.max(_displayLevel, idlePulse),
              quietColor: colors.textMuted.withValues(alpha: 0.34),
              activeColor: colors.textSecondary,
            ),
            size: Size.infinite,
          );
        },
      ),
    );
  }
}

class _VoiceLevelPainter extends CustomPainter {
  const _VoiceLevelPainter({
    required this.phase,
    required this.level,
    required this.quietColor,
    required this.activeColor,
  });

  final double phase;
  final double level;
  final Color quietColor;
  final Color activeColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;

    const spacing = 5.5;
    final count = math.max(1, (size.width / spacing).floor());
    final activeStart = math.max(0, count - math.min(12, count));
    final centerY = size.height / 2;

    for (var index = 0; index < count; index++) {
      final x = (index + 0.5) * (size.width / count);
      final inActiveRange = index >= activeStart;
      final activePosition = inActiveRange
          ? (index - activeStart) / math.max(1, count - activeStart - 1)
          : 0.0;
      final envelope = math.sin(activePosition * math.pi);
      final motion =
          0.55 +
          0.45 *
              math.sin(
                phase * math.pi * 2 + index * 1.17 + activePosition * 2.3,
              );
      final strength = (level * 1.25).clamp(0.0, 1.0);
      final height = inActiveRange
          ? 4 + (size.height - 10) * envelope * strength * motion
          : 3.2;
      final color = inActiveRange
          ? Color.lerp(quietColor, activeColor, 0.3 + envelope * 0.7)!
          : quietColor;
      final paint = Paint()
        ..color = color
        ..strokeWidth = inActiveRange ? 3.6 : 3.2
        ..strokeCap = StrokeCap.round;

      canvas.drawLine(
        Offset(x, centerY - height / 2),
        Offset(x, centerY + height / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _VoiceLevelPainter oldDelegate) {
    return oldDelegate.phase != phase ||
        oldDelegate.level != level ||
        oldDelegate.quietColor != quietColor ||
        oldDelegate.activeColor != activeColor;
  }
}
