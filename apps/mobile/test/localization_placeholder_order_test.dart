import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final zh = lookupAppLocalizations(const Locale('zh'));

  test('commit file summary maps count, additions, and deletions', () {
    const count = 22;
    const additions = 11;
    const deletions = 33;

    expect(
      en.commitFilesSummary(count, additions, deletions),
      '22 files · +11 -33',
    );
    expect(
      zh.commitFilesSummary(count, additions, deletions),
      '22 个文件 · +11 -33',
    );
  });

  test('diff line placeholders accept numeric values', () {
    expect(en.diffLine(7), 'Line 7');
    expect(en.diffLineRange(7, 9), 'Lines 7-9');
    expect(zh.diffLine(7), '第 7 行');
    expect(zh.diffLineRange(7, 9), '第 7-9 行');
  });
}
