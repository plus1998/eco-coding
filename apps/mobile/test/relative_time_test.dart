import 'package:eco_mobile/core/utils/relative_time.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.utc(2026, 7, 24, 12);
  final en = lookupAppLocalizations(const Locale('en', 'US'));
  final zh = lookupAppLocalizations(const Locale('zh', 'CN'));

  test('formats relative time in English', () {
    expect(formatRelativeTime(now.toIso8601String(), en, now), 'Just now');
    expect(
      formatRelativeTime(
        now.subtract(const Duration(minutes: 1)).toIso8601String(),
        en,
        now,
      ),
      '1 minute',
    );
    expect(
      formatRelativeTime(
        now.subtract(const Duration(hours: 3)).toIso8601String(),
        en,
        now,
      ),
      '3 hours',
    );
  });

  test('formats relative time in Chinese', () {
    expect(
      formatRelativeTime(
        now.subtract(const Duration(days: 6)).toIso8601String(),
        zh,
        now,
      ),
      '6 天',
    );
    expect(
      formatRelativeTime(
        now.subtract(const Duration(days: 21)).toIso8601String(),
        zh,
        now,
      ),
      '3 周',
    );
  });

  test('handles invalid and future timestamps', () {
    expect(formatRelativeTime('invalid', en, now), isEmpty);
    expect(
      formatRelativeTime(
        now.add(const Duration(minutes: 2)).toIso8601String(),
        en,
        now,
      ),
      'Just now',
    );
  });
}
