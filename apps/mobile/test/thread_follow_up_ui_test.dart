import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/utils/thread_follow_up_ui.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';

final _zh = lookupAppLocalizations(const Locale('zh'));

ThreadPendingFollowUp followUp(
  String id, {
  String status = 'queued',
  String priority = 'normal',
  String createdAt = '2024-01-01T00:00:00.000Z',
  String prompt = 'message',
}) {
  return ThreadPendingFollowUp(
    id: id,
    threadId: 'thr_1',
    prompt: prompt,
    status: status,
    createdAt: createdAt,
    priority: priority,
  );
}

void main() {
  test('isFollowUpThreadLiveEvent matches follow-up topics and payloads', () {
    expect(
      isFollowUpThreadLiveEvent(
        kind: 'thread.follow_up',
        liveType: 'thread.follow_up.queued',
      ),
      isTrue,
    );
    expect(
      isFollowUpThreadLiveEvent(
        kind: 'thread.lifecycle',
        liveType: 'thread.follow_up.applied',
      ),
      isTrue,
    );
    expect(
      isFollowUpThreadLiveEvent(
        kind: 'thread.stream',
        liveType: 'thread.running',
        hasFollowUp: true,
      ),
      isTrue,
    );
    expect(
      isFollowUpThreadLiveEvent(
        kind: 'thread.stream',
        liveType: 'thread.running',
      ),
      isFalse,
    );
  });

  test('resolveThreadEventThreadId prefers envelope thread id', () {
    expect(
      resolveThreadEventThreadId(
        envelopeThreadId: 'thr_envelope',
        payloadThreadId: 'thr_payload',
      ),
      'thr_envelope',
    );
    expect(
      resolveThreadEventThreadId(payloadThreadId: 'thr_payload'),
      'thr_payload',
    );
    expect(resolveThreadEventThreadId(), isNull);
  });

  test('isLiveFollowUpThreadStatus only opens running and queued UI', () {
    expect(isLiveFollowUpThreadStatus('running'), isTrue);
    expect(isLiveFollowUpThreadStatus('queued'), isTrue);
    expect(isLiveFollowUpThreadStatus('awaiting_plan'), isFalse);
    expect(isLiveFollowUpThreadStatus('completed'), isFalse);
  });

  test('queuedThreadFollowUps hides non-queued records', () {
    final normal = followUp('normal');
    final cancelled = followUp('cancelled', status: 'cancelled');
    final escalated = followUp(
      'escalated',
      priority: 'escalated',
      createdAt: '2024-01-01T00:00:01.000Z',
    );

    expect(
      queuedThreadFollowUps([
        normal,
        cancelled,
        escalated,
      ]).map((item) => item.id),
      ['escalated', 'normal'],
    );
  });

  test('mergeThreadFollowUp replaces existing records by id', () {
    final original = followUp('same', prompt: '旧消息');
    final updated = followUp('same', prompt: '已取消', status: 'cancelled');

    expect(mergeThreadFollowUp([original], updated), [updated]);
  });

  test('formatThreadFollowUpPreview clips long prompts', () {
    final preview = formatThreadFollowUpPreview(
      followUp('long', prompt: 'a' * 130),
      _zh,
    );

    expect(preview.length, 120);
    expect(preview.endsWith('...'), isTrue);
  });

  test('formatThreadFollowUpPreview includes image count', () {
    final item = ThreadPendingFollowUp(
      id: 'image-follow-up',
      threadId: 'thread-1',
      prompt: '看一下',
      status: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
      attachments: const [
        PromptImageAttachment(mediaType: 'image/jpeg', data: 'YWJj'),
      ],
    );

    expect(formatThreadFollowUpPreview(item, _zh), '看一下 (1 张图片)');
  });
}
