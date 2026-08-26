import 'dart:ui';

import 'package:eco_mobile/core/utils/speech_text_segments.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('splitSpeechTextSegments', () {
    test('splits mixed Chinese and English runs', () {
      final segments = splitSpeechTextSegments('这是 Flutter 应用示例');

      expect(segments, hasLength(3));
      expect(segments[0].script, SpeechScript.chinese);
      expect(segments[0].text, '这是 ');
      expect(segments[1].script, SpeechScript.latin);
      expect(segments[1].text, 'Flutter ');
      expect(segments[2].script, SpeechScript.chinese);
      expect(segments[2].text, '应用示例');
    });

    test('keeps pure English as one latin segment', () {
      final segments = splitSpeechTextSegments('Hello world 123');

      expect(segments, hasLength(1));
      expect(segments.single.script, SpeechScript.latin);
      expect(segments.single.text, 'Hello world 123');
    });

    test('keeps pure Chinese as one chinese segment', () {
      final segments = splitSpeechTextSegments('你好，世界');

      expect(segments, hasLength(1));
      expect(segments.single.script, SpeechScript.chinese);
    });
  });

  group('languageCandidatesForSegment', () {
    test('prefers zh-CN for Chinese script', () {
      const segment = SpeechTextSegment(
        text: '你好',
        script: SpeechScript.chinese,
      );

      expect(
        languageCandidatesForSegment(segment, const Locale('zh')),
        contains('zh-CN'),
      );
    });

    test('prefers en-US for Latin script', () {
      const segment = SpeechTextSegment(
        text: 'Hello',
        script: SpeechScript.latin,
      );

      expect(
        languageCandidatesForSegment(segment, const Locale('zh')).first,
        'en-US',
      );
    });
  });
}
