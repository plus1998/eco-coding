import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';

/// Stops TTS when the app leaves the foreground so playback cannot resume later.
class TtsLifecycleBinder extends ConsumerStatefulWidget {
  const TtsLifecycleBinder({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<TtsLifecycleBinder> createState() => _TtsLifecycleBinderState();
}

class _TtsLifecycleBinderState extends ConsumerState<TtsLifecycleBinder>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        unawaited(ref.read(ecoTtsServiceProvider).stop());
      case AppLifecycleState.resumed:
        break;
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
