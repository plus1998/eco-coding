import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/widgets/allow_native_platform_view.dart';

void main() {
  group('isShellCoveredLocation', () {
    test('allows bare shell tabs', () {
      expect(isShellCoveredLocation('/threads'), isFalse);
      expect(isShellCoveredLocation('/settings'), isFalse);
      expect(isShellCoveredLocation('/connect'), isFalse);
    });

    test('covers root session and new-thread routes', () {
      expect(isShellCoveredLocation('/threads/new'), isTrue);
      expect(isShellCoveredLocation('/threads/abc-123'), isTrue);
    });

    test('covers settings detail routes', () {
      expect(isShellCoveredLocation('/settings/theme'), isTrue);
      expect(isShellCoveredLocation('/settings/language'), isTrue);
    });
  });
}
