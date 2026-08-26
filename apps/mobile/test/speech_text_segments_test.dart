import 'dart:ui';

import 'package:eco_mobile/core/utils/speech_text_segments.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('planSpeechLanguage', () {
    test('prefers Chinese voice for Chinese-dominant mixed text even in English UI', () {
      final plan = planSpeechLanguage(
        '这是 Flutter 应用示例',
        const Locale('en'),
      );

      expect(plan.preferChinese, isTrue);
      expect(plan.candidates, contains('zh-CN'));
    });

    test('prefers Chinese voice for pure Chinese text', () {
      final plan = planSpeechLanguage(
        '你好，这是纯中文内容。',
        const Locale('en'),
      );

      expect(plan.preferChinese, isTrue);
      expect(plan.candidates.first, 'zh-CN');
    });

    test('prefers English voice for English-dominant text', () {
      final plan = planSpeechLanguage(
        'Hello world from Eco Mobile client',
        const Locale('zh'),
      );

      expect(plan.preferChinese, isFalse);
      expect(plan.candidates.first, 'en-US');
    });

    test('detects Chinese characters in text', () {
      expect(containsChineseSpeechText('你好'), isTrue);
      expect(containsChineseSpeechText('Hello'), isFalse);
    });
  });
}
