import 'package:eco_mobile/core/platform/session_wake_lock.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('SessionWakeLock enable/disable is idempotent', () async {
    final toggles = <bool>[];
    final lock = SessionWakeLock(
      toggle: (enable) async {
        toggles.add(enable);
      },
    );

    await lock.sync(true);
    await lock.enable();
    expect(toggles, [true]);
    expect(lock.isEnabled, isTrue);

    await lock.sync(false);
    await lock.disable();
    expect(toggles, [true, false]);
    expect(lock.isEnabled, isFalse);
  });

  test('SessionWakeLock retries after a toggle failure', () async {
    var failOnce = true;
    final toggles = <bool>[];
    final lock = SessionWakeLock(
      toggle: (enable) async {
        if (failOnce) {
          failOnce = false;
          throw StateError('platform failed');
        }
        toggles.add(enable);
      },
    );

    await lock.sync(true);
    expect(lock.isEnabled, isNull);
    expect(toggles, isEmpty);

    await lock.sync(true);
    expect(toggles, [true]);
    expect(lock.isEnabled, isTrue);
  });
}
