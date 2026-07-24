import 'package:flutter/material.dart';

import '../../core/constants/session_mode.dart';
import '../../core/theme/eco_icons.dart';

/// Shared hit target for composer footer icon buttons.
const double kComposerToolbarHitSize = 36;

/// Shared logical icon size; individual glyphs are optically tuned around this.
const double kComposerToolbarIconSize = 20;

double composerToolbarGlyphSize(IconData icon) {
  if (icon == EcoIcons.agentMode) {
    return kComposerToolbarIconSize * 1.05;
  }
  if (icon == EcoIcons.askMode || icon == EcoIcons.planMode) {
    return kComposerToolbarIconSize * 0.9;
  }
  if (icon == EcoIcons.mcp) {
    return kComposerToolbarIconSize * 0.95;
  }
  return kComposerToolbarIconSize;
}

class ComposerToolbarIcon extends StatelessWidget {
  const ComposerToolbarIcon({
    super.key,
    required this.icon,
    required this.color,
    this.size = kComposerToolbarIconSize,
  });

  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final glyphSize = composerToolbarGlyphSize(icon);
    return SizedBox(
      width: size,
      height: size,
      child: Center(
        child: Icon(icon, size: glyphSize, color: color),
      ),
    );
  }
}

class ComposerToolbarIconButton extends StatelessWidget {
  const ComposerToolbarIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.tooltip,
    this.color,
  });

  final Widget icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(
        minWidth: kComposerToolbarHitSize,
        minHeight: kComposerToolbarHitSize,
      ),
      color: color,
      icon: icon,
    );
  }
}

IconData sessionModeIcon(SessionMode mode) {
  if (mode == 'plan') {
    return EcoIcons.planMode;
  }
  if (mode == 'ask') {
    return EcoIcons.askMode;
  }
  return EcoIcons.agentMode;
}

class SessionModeIcon extends StatelessWidget {
  const SessionModeIcon({
    super.key,
    required this.mode,
    required this.color,
    this.size = kComposerToolbarIconSize,
  });

  final SessionMode mode;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return ComposerToolbarIcon(
      icon: sessionModeIcon(mode),
      color: color,
      size: size,
    );
  }
}

class ComposerBashReviewToolbarIcon extends StatelessWidget {
  const ComposerBashReviewToolbarIcon({
    super.key,
    required this.mode,
    required this.color,
    this.size = kComposerToolbarIconSize,
  });

  final String mode;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final icon = switch (mode) {
      'auto' => EcoIcons.shieldAuto,
      'allow_all' => EcoIcons.shieldAllowAll,
      _ => EcoIcons.shieldManual,
    };

    if (mode != 'auto') {
      return ComposerToolbarIcon(icon: icon, color: color, size: size);
    }

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Icon(icon, size: composerToolbarGlyphSize(icon), color: color),
          Positioned(
            bottom: size * 0.14,
            child: Icon(EcoIcons.terminal, size: size * 0.36, color: color),
          ),
        ],
      ),
    );
  }
}
