import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_theme.dart';

/// Typeless-inspired floating voice bar shown while system speech recognition runs.
class VoiceDictationOverlay extends StatefulWidget {
  const VoiceDictationOverlay({super.key, required this.onStop});

  final VoidCallback onStop;

  @override
  State<VoiceDictationOverlay> createState() => _VoiceDictationOverlayState();
}

class _VoiceDictationOverlayState extends State<VoiceDictationOverlay>
    with TickerProviderStateMixin {
  late final AnimationController _enterController;
  late final AnimationController _pulseController;
  late final Animation<Offset> _slideAnimation;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _enterController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    );
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat();

    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.18), end: Offset.zero).animate(
          CurvedAnimation(parent: _enterController, curve: Curves.easeOutCubic),
        );
    _fadeAnimation = CurvedAnimation(
      parent: _enterController,
      curve: Curves.easeOut,
    );

    _enterController.forward();
  }

  @override
  void dispose() {
    _enterController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  void _handleStop() {
    widget.onStop();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final safeBottom = MediaQuery.paddingOf(context).bottom;

    return Material(
      color: Colors.transparent,
      child: FadeTransition(
        opacity: _fadeAnimation,
        child: GestureDetector(
          onTap: _handleStop,
          behavior: HitTestBehavior.opaque,
          child: Container(
            color: eco.shadowScrim.withValues(alpha: 0.18),
            alignment: Alignment.bottomCenter,
            child: SlideTransition(
              position: _slideAnimation,
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  0,
                  20,
                  safeBottom + bottomInset + 18,
                ),
                child: _VoiceDictationBar(
                  pulse: _pulseController,
                  onStop: _handleStop,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _VoiceDictationBar extends StatelessWidget {
  const _VoiceDictationBar({required this.pulse, required this.onStop});

  final Animation<double> pulse;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            color: eco.composerContextBg.withValues(alpha: 0.88),
            border: Border.all(color: eco.accent.withValues(alpha: 0.22)),
            boxShadow: [
              BoxShadow(
                color: eco.accent.withValues(alpha: 0.16),
                blurRadius: 28,
                spreadRadius: -4,
                offset: const Offset(0, 8),
              ),
              BoxShadow(
                color: eco.shadowScrim.withValues(alpha: 0.2),
                blurRadius: 20,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 14),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _VoiceWaveform(pulse: pulse, mirror: true),
                    const SizedBox(width: 14),
                    _VoiceListeningOrb(pulse: pulse),
                    const SizedBox(width: 14),
                    _VoiceWaveform(pulse: pulse, mirror: false),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  context.l10n.voiceListening,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: eco.textHeading,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  context.l10n.voiceTapToStop,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: eco.textMuted,
                    letterSpacing: 0.15,
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: onStop,
                  style: TextButton.styleFrom(
                    foregroundColor: eco.accentText,
                    backgroundColor: eco.accentSoft.withValues(alpha: 0.55),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 6,
                    ),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: Text(context.l10n.voiceStop),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _VoiceListeningOrb extends StatelessWidget {
  const _VoiceListeningOrb({required this.pulse});

  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return AnimatedBuilder(
      animation: pulse,
      builder: (context, child) {
        final t = pulse.value;
        final breathe = 0.5 + 0.5 * math.sin(t * math.pi * 2);
        final outerScale = 1.0 + breathe * 0.22;
        final glowOpacity = 0.18 + breathe * 0.2;

        return SizedBox(
          width: 56,
          height: 56,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Transform.scale(
                scale: outerScale,
                child: Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        eco.accent.withValues(alpha: glowOpacity),
                        eco.accent.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
              ),
              Transform.scale(
                scale: 0.92 + breathe * 0.08,
                child: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        eco.accent.withValues(alpha: 0.95),
                        eco.accentHover,
                      ],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: eco.accent.withValues(alpha: 0.45),
                        blurRadius: 14,
                        spreadRadius: -2,
                      ),
                    ],
                  ),
                  child: Center(
                    child: Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.92),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _VoiceWaveform extends StatelessWidget {
  const _VoiceWaveform({required this.pulse, required this.mirror});

  final Animation<double> pulse;
  final bool mirror;

  static const _barCount = 5;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return AnimatedBuilder(
      animation: pulse,
      builder: (context, _) {
        final indices = List<int>.generate(_barCount, (index) => index);
        final ordered = mirror ? indices.reversed : indices;

        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final index in ordered) ...[
              if (index > 0) const SizedBox(width: 3),
              _VoiceWaveBar(
                phase: pulse.value + index * 0.18,
                color: eco.accent.withValues(alpha: 0.55 + index * 0.08),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _VoiceWaveBar extends StatelessWidget {
  const _VoiceWaveBar({required this.phase, required this.color});

  final double phase;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final height = 8 + 14 * (0.5 + 0.5 * math.sin(phase * math.pi * 2));
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
      width: 3,
      height: height,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}
