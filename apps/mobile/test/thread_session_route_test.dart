import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/features/threads/thread_session_route.dart';

void main() {
  group('resolveThreadSessionPageKey', () {
    const defaultKey = ValueKey<String>('default-thread-page');

    test('uses composer key for new landing', () {
      expect(
        resolveThreadSessionPageKey(
          rawThreadId: threadSessionNewPathSegment,
          defaultPageKey: defaultKey,
        ),
        threadSessionComposerPageKey,
      );
    });

    test('uses composer key for handoff into a real thread', () {
      expect(
        resolveThreadSessionPageKey(
          rawThreadId: 'thr_123',
          defaultPageKey: defaultKey,
          extra: const ThreadSessionRouteExtra(handoff: true),
        ),
        threadSessionComposerPageKey,
      );
    });

    test('keeps default key when opening an existing thread', () {
      expect(
        resolveThreadSessionPageKey(
          rawThreadId: 'thr_123',
          defaultPageKey: defaultKey,
        ),
        defaultKey,
      );
    });
  });
}
