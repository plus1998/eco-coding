import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/utils/thread_status.dart';
import 'package:eco_mobile/core/utils/thread_todo_live.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('threadStatusFromLiveEvent maps awaiting plan events', () {
    expect(
      threadStatusFromLiveEvent('thread.awaiting_plan', 'running'),
      'awaiting_plan',
    );
    expect(
      threadStatusFromLiveEvent('thread.execution_failed', 'running'),
      'awaiting_plan',
    );
    expect(threadStatusFromLiveEvent('thread.running', 'idle'), 'running');
  });

  test('resolveThreadMessageFromLiveEvent prefixes execution failures', () {
    expect(
      resolveThreadMessageFromLiveEvent('thread.execution_failed', '模型超时'),
      '执行失败，已回退更改。模型超时',
    );
    expect(extractPlanFailureMessage('执行失败，已回退更改。模型超时'), '模型超时');
  });

  test('shouldUpdateThreadSummaryFromLiveEvent ignores telemetry events', () {
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.usage_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.runtime_config_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.run_projection_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.subagent_timing_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.awaiting_plan'),
      isTrue,
    );
  });

  test(
    'ThreadLiveEvent drops tool previews from live and incremental payloads',
    () {
      final event = ThreadLiveEvent.fromJson({
        'threadId': 'thr_1',
        'type': 'thread.run_projection_updated',
        'message': 'updated',
        'tool': {
          'name': 'Bash',
          'detail': 'bun test',
          'outputPreview': 'live output',
          'outputPreviewTruncated': true,
        },
        'projection': {
          'thread': {
            'threadId': 'thr_1',
            'status': 'running',
            'generatedAt': '2026-01-01T00:00:00.000Z',
          },
          'sourceEventCount': 1,
          'agents': const [],
          'timeline': [
            {
              'id': 'tool_1',
              'sequence': 1,
              'eventType': 'tool.completed',
              'scope': 'main',
              'text': 'Tool: Bash · bun test',
              'at': '2026-01-01T00:00:00.000Z',
              'metadata': {
                'tool': {
                  'name': 'Bash',
                  'detail': 'bun test',
                  'outputPreview': 'projection output',
                  'outputPreviewTruncated': true,
                },
              },
            },
          ],
        },
      });

      expect(event.tool?.detail, 'bun test');
      expect(event.tool?.outputPreview, isNull);
      expect(event.tool?.outputPreviewTruncated, isFalse);
      final projectionTool =
          event.projection?.timeline.single.metadata?['tool']
              as Map<String, dynamic>;
      expect(projectionTool.containsKey('outputPreview'), isFalse);
      expect(projectionTool.containsKey('outputPreviewTruncated'), isFalse);
    },
  );

  test('ThreadLiveEvent parses task progress snapshots', () {
    final event = ThreadLiveEvent.fromJson({
      'threadId': 'thr_1',
      'type': 'thread.todos_updated',
      'message': 'TODO 已更新',
      'todoList': [
        {
          'id': 'todo_1',
          'threadId': 'thr_1',
          'title': 'Wire progress',
          'detail': 'Wire progress',
          'status': 'running',
          'position': 0,
          'updatedAt': '2026-08-09T00:00:00.000Z',
        },
      ],
    });

    expect(event.todoList, hasLength(1));
    expect(event.todoList?.single.title, 'Wire progress');
    expect(event.todoList?.single.status, 'running');
  });

  test('task progress live updates are filtered by thread and sorted', () {
    final payload = {
      'threadId': 'thr_1',
      'type': 'thread.todos_updated',
      'message': 'TODO 已更新',
      'todoList': [
        {
          'id': 'todo_2',
          'threadId': 'thr_1',
          'title': 'Second',
          'detail': 'Second',
          'status': 'pending',
          'position': 1,
          'updatedAt': '2026-08-09T00:00:00.000Z',
        },
        {
          'id': 'todo_1',
          'threadId': 'thr_1',
          'title': 'First',
          'detail': 'First',
          'status': 'completed',
          'position': 0,
          'updatedAt': '2026-08-09T00:00:00.000Z',
        },
      ],
    };

    final todos = threadTodoListFromLiveEvent(
      threadId: 'thr_1',
      envelopeThreadId: 'thr_1',
      payload: payload,
    );

    expect(todos?.map((todo) => todo.title), ['First', 'Second']);
    expect(
      threadTodoListFromLiveEvent(
        threadId: 'thr_other',
        envelopeThreadId: 'thr_1',
        payload: payload,
      ),
      isNull,
    );
    expect(
      threadTodoListFromLiveEvent(
        threadId: 'thr_1',
        payload: {
          'threadId': 'thr_1',
          'type': 'thread.todos_updated',
          'message': 'TODO 已更新',
          'todoList': const [],
        },
      ),
      isEmpty,
    );
  });

  test('task panel reloads persisted progress after reconnect', () {
    expect(
      shouldReloadThreadTodosAfterConnection(
        previous: EcoConnectionState.disconnected,
        current: EcoConnectionState.connected,
      ),
      isTrue,
    );
    expect(
      shouldReloadThreadTodosAfterConnection(
        previous: EcoConnectionState.connected,
        current: EcoConnectionState.connected,
      ),
      isFalse,
    );
  });
}
