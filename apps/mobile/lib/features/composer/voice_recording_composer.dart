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
  static const _sampleInterval = Duration(milliseconds: 60);
  static const _maxHistoryLength = 96;

  late final AnimationController _controller;
  final List<double> _history = List<double>.filled(48, 0);
  double _targetLevel = 0;
  double _displayLevel = 0;
  double _previousPhase = 0;
  int _sampleIndex = 0;

  @override
  void initState() {
    super.initState();
    _targetLevel = _amplifyLevel(widget.audioLevel);
    _displayLevel = _targetLevel;
    _controller = AnimationController(vsync: this, duration: _sampleInterval)
      ..addListener(_handleAnimationTick)
      ..repeat();
  }

  @override
  void didUpdateWidget(covariant _VoiceLevelWave oldWidget) {
    super.didUpdateWidget(oldWidget);
    _targetLevel = _amplifyLevel(widget.audioLevel);
    _updateDisplayLevel();
  }

  void _handleAnimationTick() {
    final phase = _controller.value;
    if (phase < _previousPhase) {
      _updateDisplayLevel();
      final variation =
          0.68 + 0.32 * math.sin(_sampleIndex * 1.37 + _displayLevel * 4.2);
      final sample = _displayLevel < 0.012
          ? 0.01 + 0.006 * (0.5 + 0.5 * math.sin(_sampleIndex * 0.91))
          : (_displayLevel * variation).clamp(0.025, 1.0);
      _history.add(sample);
      if (_history.length > _maxHistoryLength) {
        _history.removeRange(0, _history.length - _maxHistoryLength);
      }
      _targetLevel *= 0.88;
      _sampleIndex++;
    }
    _previousPhase = phase;
  }

  double _amplifyLevel(double level) {
    final normalized = level.clamp(0.0, 1.0);
    if (normalized < 0.002) return 0;
    return (math.pow(normalized, 0.5) * 1.18).clamp(0.0, 1.0);
  }

  void _updateDisplayLevel() {
    final response = _targetLevel > _displayLevel ? 0.76 : 0.3;
    _displayLevel += (_targetLevel - _displayLevel) * response;
  }

  @override
  void dispose() {
    _controller.removeListener(_handleAnimationTick);
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
          return CustomPaint(
            painter: _VoiceLevelPainter(
              scrollProgress: _controller.value,
              history: _history,
              currentLevel: _displayLevel,
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
  static const _liveBarCount = 7;

  const _VoiceLevelPainter({
    required this.scrollProgress,
    required this.history,
    required this.currentLevel,
    required this.quietColor,
    required this.activeColor,
  });

  final double scrollProgress;
  final List<double> history;
  final double currentLevel;
  final Color quietColor;
  final Color activeColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;

    const spacing = 5.5;
    final count = math.max(1, (size.width / spacing).ceil());
    final slotWidth = size.width / count;
    final centerY = size.height / 2;
    final visibleHistory = history.length > count
        ? history.sublist(history.length - count)
        : <double>[
            ...List<double>.filled(count - history.length, 0),
            ...history,
          ];

    for (var index = 0; index <= count; index++) {
      final historyLevel = index == count
          ? currentLevel
          : visibleHistory[index];
      final distanceFromRight = count - index;
      final isLive = distanceFromRight < math.min(_liveBarCount, count);
      final x = (index + 0.5 - scrollProgress) * slotWidth;
      if (x < -slotWidth || x > size.width + slotWidth) continue;

      final livePosition =
          (_liveBarCount - 1 - distanceFromRight).clamp(0, _liveBarCount - 1) /
          (_liveBarCount - 1);
      final liveMotion =
          0.56 +
          0.44 *
              math.sin(
                scrollProgress * math.pi * 2 + livePosition * math.pi * 2.4,
              );
      final liveEnvelope = 0.72 + 0.28 * math.sin(livePosition * math.pi);
      final liveLevel = math.max(
        historyLevel,
        currentLevel * liveMotion * liveEnvelope,
      );
      final normalizedLevel = (isLive ? liveLevel : historyLevel).clamp(
        0.0,
        1.0,
      );
      final height =
          3.2 + (size.height - 9) * math.pow(normalizedLevel, 0.72).toDouble();
      final recency = (index / count).clamp(0.0, 1.0);
      final color = Color.lerp(
        quietColor,
        activeColor,
        (normalizedLevel * 0.65 + recency * 0.18 + (isLive ? 0.17 : 0)).clamp(
          0.0,
          1.0,
        ),
      )!;
      final paint = Paint()
        ..color = color
        ..strokeWidth = normalizedLevel > 0.04 ? 3.6 : 3.2
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
    return oldDelegate.scrollProgress != scrollProgress ||
        oldDelegate.currentLevel != currentLevel ||
        oldDelegate.history != history ||
        oldDelegate.quietColor != quietColor ||
        oldDelegate.activeColor != activeColor;
  }
}
