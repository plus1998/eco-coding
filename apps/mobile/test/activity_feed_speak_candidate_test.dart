import 'package:eco_mobile/core/utils/activity_feed_speak_candidate.dart';
import 'package:eco_mobile/features/threads/activity_feed.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('findLatestAssistantSpeakCandidate returns the last assistant block', () {
    final candidate = findLatestAssistantSpeakCandidate(const [
      ActivityFeedEntry(
        id: 'user-1',
        kind: ActivityFeedKind.user,
        text: '你好',
      ),
      ActivityFeedEntry(
        id: 'assistant-1',
        kind: ActivityFeedKind.assistant,
        text: '第一段回复',
      ),
      ActivityFeedEntry(
        id: 'turn-1',
        kind: ActivityFeedKind.turn,
        text: '',
        finalOutput: ActivityFeedEntry(
          id: 'assistant-2',
          kind: ActivityFeedKind.assistant,
          text: '最终输出',
        ),
      ),
    ]);

    expect(candidate?.id, 'assistant-2');
    expect(candidate?.text, '最终输出');
  });

  test('ignores streaming assistant blocks for auto-read selection', () {
    final candidate = findLatestAssistantSpeakCandidate(const [
      ActivityFeedEntry(
        id: 'assistant-streaming',
        kind: ActivityFeedKind.assistant,
        text: '正在输出',
        streaming: true,
      ),
    ]);

    expect(candidate?.streaming, isTrue);
  });
}
