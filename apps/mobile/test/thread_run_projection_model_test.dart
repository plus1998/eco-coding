import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mergeThreadRunProjectionSnapshots preserves cached agent timeline', () {
    final current = _projection(
      sourceEventCount: 2,
      agents: [
        _agent(timeline: [_item('agent_evt_1', 1, text: 'agent detail')]),
      ],
    );
    final incoming = _projection(
      sourceEventCount: 3,
      generatedAt: '2026-01-01T00:00:01.000Z',
      timeline: [_item('main_evt_1', 2, text: 'main update', scope: 'main')],
      agents: [_agent(timeline: const [])],
    );

    final merged = mergeThreadRunProjectionSnapshots(current, incoming);

    expect(merged.timeline.map((item) => item.id), ['main_evt_1']);
    expect(merged.agents.single.timeline.map((item) => item.id), [
      'agent_evt_1',
    ]);
    expect(merged.sourceEventCount, 3);
  });

  test(
    'mergeThreadRunProjectionDetailResult keeps agent detail without cached agent shell',
    () {
      final current = _projection(sourceEventCount: 2);
      final detail = ThreadRunProjectionDetailResult(
        threadId: 'thr_1',
        kind: 'agent',
        key: 'agent_missing_from_feed',
        generatedAt: '2026-01-01T00:00:01.000Z',
        sourceEventCount: 3,
        hasMore: false,
        timeline: [
          _item(
            'agent_evt_1',
            1,
            text: 'agent detail',
            role: 'coder',
            agentId: 'agent_missing_from_feed',
          ),
        ],
      );

      final merged = mergeThreadRunProjectionDetailResult(current, detail);

      expect(merged.agents.single.agentId, 'agent_missing_from_feed');
      expect(merged.agents.single.role, 'coder');
      expect(merged.agents.single.timeline.map((item) => item.id), [
        'agent_evt_1',
      ]);
    },
  );

  test(
    'mergeThreadRunProjectionSnapshots appends incremental main timeline',
    () {
      final current = _projection(
        sourceEventCount: 2,
        timeline: [_item('main_evt_1', 1, scope: 'main', text: 'one')],
      );
      final incoming = _projection(
        sourceEventCount: 3,
        generatedAt: '2026-01-01T00:00:01.000Z',
        timeline: [_item('main_evt_2', 2, scope: 'main', text: 'two')],
      );

      final merged = mergeThreadRunProjectionSnapshots(current, incoming);

      expect(merged.timeline.map((item) => item.id), [
        'main_evt_1',
        'main_evt_2',
      ]);
      expect(merged.sourceEventCount, 3);
    },
  );

  test('projection parsing preserves earlier history availability', () {
    final projection = ThreadRunProjectionSnapshot.fromJson({
      'thread': {
        'threadId': 'thr_1',
        'status': 'completed',
        'generatedAt': '2026-01-01T00:00:00.000Z',
      },
      'sourceEventCount': 200,
      'historyRevision': 3,
      'hasEarlier': true,
      'agents': const [],
      'timeline': const [],
    });

    expect(projection.historyRevision, 3);
    expect(projection.hasEarlier, isTrue);
  });

  test('merging an earlier main page prepends and closes pagination', () {
    final current = _projection(
      sourceEventCount: 200,
      historyRevision: 4,
      hasEarlier: true,
      timeline: [
        _item('main_101', 101, scope: 'main'),
        _item('main_102', 102, scope: 'main'),
      ],
    );
    final page = ThreadRunProjectionDetailResult(
      threadId: 'thr_1',
      kind: 'main',
      key: 'thr_1',
      generatedAt: '2026-01-01T00:00:01.000Z',
      timeline: [
        _item('main_1', 1, scope: 'main'),
        _item('main_100', 100, scope: 'main'),
      ],
      sourceEventCount: 200,
      hasMore: false,
      hasEarlier: false,
      previousBeforeSequence: 1,
    );

    final merged = mergeThreadRunProjectionDetailResult(current, page);

    expect(merged.historyRevision, 4);
    expect(merged.hasEarlier, isFalse);
    expect(merged.timeline.map((item) => item.sequence), [1, 100, 101, 102]);
  });

  test('incremental live projection keeps exhausted earlier history state', () {
    final current = _projection(
      historyRevision: 2,
      hasEarlier: false,
      timeline: [_item('main_1', 1, scope: 'main')],
    );
    final incoming = _projection(
      historyRevision: 2,
      generatedAt: '2026-01-01T00:00:02.000Z',
      hasEarlier: true,
      timeline: [_item('main_100', 100, scope: 'main')],
    );

    final merged = mergeThreadRunProjectionSnapshots(current, incoming);

    expect(merged.hasEarlier, isFalse);
    expect(merged.timeline.map((item) => item.sequence), [1, 100]);
  });

  test('mergeThreadRunProjectionSnapshots keeps longer stream text', () {
    final current = _projection(
      sourceEventCount: 2,
      timeline: [
        _item(
          'think_1',
          1,
          eventType: 'thinking.delta',
          text: List.filled(1500, 'a').join(),
        ),
      ],
    );
    final incoming = _projection(
      sourceEventCount: 3,
      generatedAt: '2026-01-01T00:00:01.000Z',
      timeline: [
        _item(
          'think_1',
          1,
          eventType: 'thinking.delta',
          text: List.filled(1200, 'a').join(),
        ),
      ],
    );

    final merged = mergeThreadRunProjectionSnapshots(current, incoming);

    expect(merged.timeline.single.text.length, 1500);
  });

  test(
    'mergeThreadRunProjectionSnapshots resets cached items after history rewind',
    () {
      final current = _projection(
        sourceEventCount: 10,
        historyRevision: 1,
        timeline: [_item('old_evt', 10, scope: 'main', text: 'old')],
      );
      final incoming = _projection(
        sourceEventCount: 1,
        historyRevision: 2,
        generatedAt: '2026-01-01T00:00:01.000Z',
        timeline: [_item('new_evt', 1, scope: 'main', text: 'new')],
      );

      final merged = mergeThreadRunProjectionSnapshots(current, incoming);

      expect(merged.historyRevision, 2);
      expect(merged.timeline.map((item) => item.id), ['new_evt']);
      expect(merged.sourceEventCount, 1);
    },
  );

  test(
    'mergeThreadRunProjectionSnapshots accepts a reset revision after desktop restart',
    () {
      final current = _projection(
        sourceEventCount: 10,
        historyRevision: 2,
        timeline: [_item('old_evt', 10, scope: 'main', text: 'old')],
      );
      final incoming = _projection(
        sourceEventCount: 1,
        historyRevision: 0,
        generatedAt: '2026-01-01T00:00:01.000Z',
        timeline: [_item('new_evt', 1, scope: 'main', text: 'new')],
      );

      final merged = mergeThreadRunProjectionSnapshots(current, incoming);

      expect(merged.historyRevision, 0);
      expect(merged.timeline.map((item) => item.id), ['new_evt']);
    },
  );

  test('mergeThreadRunProjectionSnapshots preserves cached tool detail', () {
    final current = _projection(
      sourceEventCount: 2,
      timeline: [
        _item(
          'tool_1',
          1,
          eventType: 'tool.completed',
          scope: 'main',
          text: 'Tool: Bash · bun test',
          metadata: const {
            'tool': {
              'name': 'Bash',
              'detail': 'bun test',
              'toolUseId': 'toolu_1',
              'status': 'completed',
              'outputPreview': 'bounded output',
              'fileChange': {
                'path': 'lib/main.dart',
                'additions': 1,
                'deletions': 0,
                'previewLines': [
                  {'kind': 'add', 'text': 'line'},
                ],
              },
            },
          },
        ),
      ],
    );
    final incoming = _projection(
      sourceEventCount: 3,
      generatedAt: '2026-01-01T00:00:01.000Z',
      timeline: [
        _item(
          'tool_1',
          1,
          eventType: 'tool.completed',
          scope: 'main',
          text: 'Tool: Bash · bun test',
          metadata: const {
            'tool': {
              'name': 'Bash',
              'detail': 'bun test',
              'toolUseId': 'toolu_1',
              'status': 'completed',
            },
          },
        ),
      ],
    );

    final merged = mergeThreadRunProjectionSnapshots(current, incoming);
    final tool =
        merged.timeline.single.metadata?['tool'] as Map<String, dynamic>;

    expect(tool['outputPreview'], 'bounded output');
    expect(tool['fileChange'], isA<Map<String, dynamic>>());
  });

  test('feed projection parsing drops tool output fields', () {
    final projection = ThreadRunProjectionSnapshot.fromJson({
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
              'output': 'legacy raw output',
              'outputPreview': 'bounded output',
              'outputPreviewTruncated': true,
            },
          },
        },
      ],
    }, includeToolOutputPreview: false);

    final tool =
        projection.timeline.single.metadata?['tool'] as Map<String, dynamic>;
    expect(tool['detail'], 'bun test');
    expect(tool.containsKey('output'), isFalse);
    expect(tool.containsKey('outputPreview'), isFalse);
    expect(tool.containsKey('outputPreviewTruncated'), isFalse);
  });

  test('tool detail parsing preserves bounded Bash preview', () {
    final detail = ThreadRunProjectionDetailResult.fromJson({
      'threadId': 'thr_1',
      'kind': 'tool',
      'key': 'toolu_1',
      'generatedAt': '2026-01-01T00:00:00.000Z',
      'sourceEventCount': 1,
      'hasMore': false,
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
              'outputPreview': '36 pass',
              'outputPreviewTruncated': true,
            },
          },
        },
      ],
    });

    final tool =
        detail.timeline.single.metadata?['tool'] as Map<String, dynamic>;
    expect(tool['outputPreview'], '36 pass');
    expect(tool['outputPreviewTruncated'], isTrue);
  });

  test('projection merges preserve attempt ownership', () {
    final current = _projection(
      sourceEventCount: 1,
      timeline: [
        _item('message-1', 1, scope: 'main', runAttemptId: 'attempt-1'),
      ],
      agents: [_agent(runAttemptId: 'attempt-1')],
    );
    final incoming = _projection(
      sourceEventCount: 2,
      generatedAt: '2026-01-01T00:00:01.000Z',
      timeline: [_item('message-1', 1, scope: 'main')],
      agents: [_agent()],
    );

    final merged = mergeThreadRunProjectionSnapshots(current, incoming);

    expect(merged.timeline.single.runAttemptId, 'attempt-1');
    expect(merged.agents.single.runAttemptId, 'attempt-1');
  });
}

ThreadRunProjectionSnapshot _projection({
  int sourceEventCount = 1,
  int historyRevision = 0,
  bool hasEarlier = false,
  String generatedAt = '2026-01-01T00:00:00.000Z',
  List<ThreadRunProjectionTimelineItem> timeline = const [],
  List<ThreadRunProjectionAgent> agents = const [],
}) {
  return ThreadRunProjectionSnapshot(
    threadId: 'thr_1',
    status: 'running',
    generatedAt: generatedAt,
    agents: agents,
    sourceEventCount: sourceEventCount,
    historyRevision: historyRevision,
    hasEarlier: hasEarlier,
    timeline: timeline,
  );
}

ThreadRunProjectionAgent _agent({
  List<ThreadRunProjectionTimelineItem> timeline = const [],
  String? runAttemptId,
}) {
  return ThreadRunProjectionAgent(
    agentId: 'agent_1',
    role: 'coder',
    kind: 'subagent',
    status: 'active',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
    runAttemptId: runAttemptId,
    timeline: timeline,
  );
}

ThreadRunProjectionTimelineItem _item(
  String id,
  int sequence, {
  String eventType = 'message.final',
  String scope = 'agent',
  String text = 'text',
  String? role,
  String? agentId,
  String? runAttemptId,
  Map<String, dynamic>? metadata,
}) {
  return ThreadRunProjectionTimelineItem(
    id: id,
    sequence: sequence,
    eventType: eventType,
    scope: scope,
    text: text,
    at: '2026-01-01T00:00:00.000Z',
    role: role,
    agentId: agentId,
    runAttemptId: runAttemptId,
    metadata: metadata,
  );
}
