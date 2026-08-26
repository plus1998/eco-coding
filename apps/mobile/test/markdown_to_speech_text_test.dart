import 'package:eco_mobile/core/utils/markdown_to_speech_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('markdownToSpeechText', () {
    test('removes inline web citations', () {
      expect(
        markdownToSpeechText('模型输出。 \u{E200}cite\u{E202}turn0search0\u{E201}'),
        '模型输出。',
      );
    });

    test('replaces fenced code blocks with omission hint', () {
      expect(
        markdownToSpeechText('说明如下：\n```dart\nvoid main() {}\n```\n结束'),
        '说明如下：\n$speechCodeBlockOmitted\n结束',
      );
    });

    test('keeps link text and drops url', () {
      expect(
        markdownToSpeechText('查看 [Flutter 文档](https://flutter.dev) 了解更多'),
        '查看 Flutter 文档 了解更多',
      );
    });

    test('strips heading and list markers', () {
      expect(
        markdownToSpeechText('# 标题\n\n- 第一项\n- 第二项'),
        '标题\n第一项\n第二项',
      );
    });

    test('returns empty for whitespace-only input', () {
      expect(markdownToSpeechText('   \n\n  '), '');
    });
  });
}
