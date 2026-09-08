import 'package:wakelock_plus/wakelock_plus.dart';

typedef WakeLockToggle = Future<void> Function(bool enable);

/// Keeps the screen from sleeping while a live thread session is in progress.
///
/// Brightness may still lower; the device should not idle-lock/sleep.
class SessionWakeLock {
  SessionWakeLock({WakeLockToggle? toggle}) : _toggle = toggle ?? _defaultToggle;

  final WakeLockToggle _toggle;
  bool? _enabled;

  bool? get isEnabled => _enabled;

  Future<void> sync(bool shouldEnable) async {
    if (_enabled == shouldEnable) {
      return;
    }
    try {
      await _toggle(shouldEnable);
      _enabled = shouldEnable;
    } catch (_) {
      // Allow a later sync to retry after a platform failure.
      _enabled = null;
    }
  }

  Future<void> enable() => sync(true);

  Future<void> disable() => sync(false);

  static Future<void> _defaultToggle(bool enable) async {
    if (enable) {
      await WakelockPlus.enable();
    } else {
      await WakelockPlus.disable();
    }
  }
}

/// Shared instance used by thread session UI.
final sessionWakeLock = SessionWakeLock();
