import 'package:flutter/widgets.dart';

/// Lightweight global tracker for app foreground state.
///
/// Set up once in [appForegroundProvider]; other code (timers, network
/// probes) checks [AppLifecycleTracker.isForeground] to decide whether to
/// keep running periodic work.
class AppLifecycleTracker {
  AppLifecycleTracker._();

  static bool _foreground = true;

  /// `true` when the app is in [AppLifecycleState.resumed] or
  /// [AppLifecycleState.inactive].
  static bool get isForeground => _foreground;

  /// Update the tracked state. Called from [WidgetsBindingObserver].
  static void update(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
      case AppLifecycleState.inactive:
        _foreground = true;
        break;
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        _foreground = false;
        break;
    }
  }
}
