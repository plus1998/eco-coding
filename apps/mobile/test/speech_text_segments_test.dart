import 'dart:ui';

import 'package:eco_mobile/core/utils/speech_text_segments.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('speechLanguageCandidatesForText', () {
    test('prefers Chinese voice for Chinese-dominant mixed text', () {
      expect(
        speechLanguageCandidatesForText('这是 Flutter 应用示例', const Locale('zh')),
        contains('zh-CN'),
      );
    });

    test('prefers English voice for English-dominant text', () {
      expect(
        speechLanguageCandidatesForText('Hello world from Eco', const Locale('zh')).first,
        'en-US',
      );
    });

    test('falls back to app locale when text has no script', () {
      expect(
        speechLanguageCandidatesForText('…', const Locale('zh')),
        contains('zh-CN'),
      );
    });
  });
}
