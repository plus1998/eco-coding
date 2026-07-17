import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/features/composer/follow_up_queue_bar.dart';

void main() {
  testWidgets('follow-up queue uses compact mobile spacing', (tester) async {
    const followUps = [
      ThreadPendingFollowUp(
        id: 'follow-up-1',
        threadId: 'thread-1',
        prompt: '第一条排队消息',
        status: 'queued',
        createdAt: '2026-01-01T00:00:00.000Z',
      ),
      ThreadPendingFollowUp(
        id: 'follow-up-2',
        threadId: 'thread-1',
        prompt: '第二条排队消息',
        status: 'queued',
        createdAt: '2026-01-01T00:00:01.000Z',
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: FollowUpQueueBar(
              followUps: followUps,
              cancelBusyId: null,
              escalateBusyId: null,
              onEscalate: (_) async {},
              onEdit: (_) {},
              onDelete: (_) async {},
              onReorder: (_, _) async {},
            ),
          ),
        ),
      ),
    );

    expect(tester.getSize(find.byType(FollowUpQueueBar)).height, lessThan(90));
  });
}
