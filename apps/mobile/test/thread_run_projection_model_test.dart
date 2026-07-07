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
              'output': 'full output',
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

    expect(tool['output'], 'full output');
    expect(tool['fileChange'], isA<Map<String, dynamic>>());
  });
}

ThreadRunProjectionSnapshot _projection({
  int sourceEventCount = 1,
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
    timeline: timeline,
  );
}

ThreadRunProjectionAgent _agent({
  List<ThreadRunProjectionTimelineItem> timeline = const [],
}) {
  return ThreadRunProjectionAgent(
    agentId: 'agent_1',
    role: 'coder',
    kind: 'subagent',
    status: 'active',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
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
    metadata: metadata,
  );
}
