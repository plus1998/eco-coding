import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/home/setup_status.dart';
import 'eco_launch_splash.dart';

/// Holds the native splash look through Flutter's first frames, then fades a
/// spinner in under the mark. Dismisses only after cold-start bootstrap ends.
class LaunchSplashHandoff extends ConsumerStatefulWidget {
  const LaunchSplashHandoff({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<LaunchSplashHandoff> createState() =>
      _LaunchSplashHandoffState();
}

class _LaunchSplashHandoffState extends ConsumerState<LaunchSplashHandoff>
    with TickerProviderStateMixin {
  late final AnimationController _spinner = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );
  late final AnimationController _exit = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 280),
  );

  var _spinnerScheduled = false;
  var _exiting = false;
  var _gone = false;

  static const _spinnerDelay = Duration(milliseconds: 420);

  @override
  void initState() {
    super.initState();
    _scheduleSpinner();
  }

  @override
  void dispose() {
    _spinner.dispose();
    _exit.dispose();
    super.dispose();
  }

  void _scheduleSpinner() {
    if (_spinnerScheduled) return;
    _spinnerScheduled = true;
    Future<void>.delayed(_spinnerDelay, () {
      if (!mounted || _exiting || _gone) return;
      _spinner.forward();
    });
  }

  Future<void> _beginExit() async {
    if (_exiting || _gone) return;
    _exiting = true;
    await _exit.forward();
    if (!mounted) return;
    setState(() => _gone = true);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(setupOverviewProvider, (previous, next) {
      if (_gone || _exiting) return;
      if (!next.isBootstrapping) {
        _beginExit();
      }
    });

    // Fast path: bootstrap already finished before first listen fire.
    final bootstrapping = ref.watch(
      setupOverviewProvider.select((o) => o.isBootstrapping),
    );
    if (!bootstrapping && !_gone && !_exiting) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _beginExit();
      });
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (!_gone)
          IgnorePointer(
            child: FadeTransition(
              opacity: Tween<double>(begin: 1, end: 0).animate(
                CurvedAnimation(parent: _exit, curve: Curves.easeOut),
              ),
              child: AnimatedBuilder(
                animation: _spinner,
                builder: (context, _) {
                  return EcoLaunchSplashSurface(
                    spinnerOpacity: _spinner.value,
                  );
                },
              ),
            ),
          ),
      ],
    );
  }
}
