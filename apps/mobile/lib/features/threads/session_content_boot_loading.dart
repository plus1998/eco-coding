import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

/// Asset path for the shared Eco splash icon (same file as desktop
/// `public/splash-icon.png`).
const sessionContentBootIconAsset = 'assets/splash-icon.png';

/// Full-screen session boot overlay aligned with desktop `codex-main-boot-loading`.
class SessionContentBootLoading extends StatefulWidget {
  const SessionContentBootLoading({super.key, required this.semanticLabel});

  final String semanticLabel;

  @override
  State<SessionContentBootLoading> createState() =>
      _SessionContentBootLoadingState();
}

class _SessionContentBootLoadingState extends State<SessionContentBootLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Semantics(
      label: widget.semanticLabel,
      liveRegion: true,
      child: ColoredBox(
        color: eco.bgFeed,
        child: Center(
          child: FadeTransition(
            opacity: Tween<double>(begin: 0.42, end: 1).animate(
              CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
            ),
            child: ScaleTransition(
              scale: Tween<double>(begin: 0.94, end: 1).animate(
                CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
              ),
              child: Image.asset(
                sessionContentBootIconAsset,
                width: 56,
                height: 56,
                fit: BoxFit.contain,
                excludeFromSemantics: true,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
