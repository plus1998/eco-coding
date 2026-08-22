import 'package:flutter/material.dart';

import '../../core/widgets/eco_launch_splash.dart';

/// Full-screen boot overlay.
///
/// Cold start should go through [LaunchSplashHandoff] (app-level). This widget
/// is for route-level boot (connect / session) and can reuse the same native
/// splash twin when [continueFromLaunchSplash] is true.
class SessionContentBootLoading extends StatefulWidget {
  const SessionContentBootLoading({
    super.key,
    required this.semanticLabel,
    this.continueFromLaunchSplash = true,
  });

  final String semanticLabel;
  final bool continueFromLaunchSplash;

  @override
  State<SessionContentBootLoading> createState() =>
      _SessionContentBootLoadingState();
}

class _SessionContentBootLoadingState extends State<SessionContentBootLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _spinner = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(milliseconds: 420), () {
      if (mounted) _spinner.forward();
    });
  }

  @override
  void dispose() {
    _spinner.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.continueFromLaunchSplash) {
      return AnimatedBuilder(
        animation: _spinner,
        builder: (context, _) {
          return EcoLaunchSplashSurface(
            semanticLabel: widget.semanticLabel,
            spinnerOpacity: _spinner.value,
          );
        },
      );
    }

    return Semantics(
      label: widget.semanticLabel,
      liveRegion: true,
      child: ColoredBox(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: Image.asset(
                ecoLaunchSplashMarkAsset,
                width: 96,
                height: 96,
                fit: BoxFit.contain,
                excludeFromSemantics: true,
              ),
            ),
            Center(
              child: Transform.translate(
                offset: const Offset(0, 48 + 28),
                child: FadeTransition(
                  opacity: _spinner,
                  child: const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
