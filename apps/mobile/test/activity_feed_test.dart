import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/core/utils/agent_mission.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
import 'package:eco_mobile/core/utils/stream_text.dart';
import 'package:eco_mobile/core/theme/eco_theme.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';
import 'package:eco_mobile/core/utils/subagent_projection_feed.dart';
import 'package:eco_mobile/features/threads/activity_feed.dart';

List<ActivityFeedEntry> _toolActions(List<ActivityFeedEntry> entries) => [
  for (final entry in entries)
    if (entry.kind == ActivityFeedKind.action)
      entry
    else if (entry.kind == ActivityFeedKind.actionGroup)
      ...entry.actionChildren,
];

ThreadRunProjectionTimelineItem _toolTimelineItem({
  required String id,
  required int sequence,
  required String at,
  required String eventType,
  required String toolUseId,
  required String toolName,
  required String detail,
  required String requestId,
}) {
  final status = eventType == 'tool.completed' ? 'completed' : 'running';
  return ThreadRunProjectionTimelineItem(
    id: id,
    sequence: sequence,
    eventType: eventType,
    scope: 'main',
    role: 'tool',
    requestId: requestId,
    text: 'Tool: $toolName · $detail',
    at: at,
    metadata: {
      'liveType': eventType,
      'tool': {
        'name': toolName,
        'detail': detail,
        'toolUseId': toolUseId,
        'status': status,
      },
    },
  );
}

ThreadRunProjectionTimelineItem _codexMessageTimelineItem({
  required String id,
  required int sequence,
  required String at,
  required String text,
  required String requestId,
}) {
  final streamKey = 'msg_$id';
  return ThreadRunProjectionTimelineItem(
    id: id,
    sequence: sequence,
    eventType: 'message.final',
    scope: 'main',
    role: 'assistant',
    text: text,
    at: at,
    requestId: requestId,
    streamKey: streamKey,
    metadata: {
      'codexMethod': 'item/completed',
      'logicalEntityId': streamKey,
      'itemId': streamKey,
      'itemType': 'agentMessage',
    },
  );
}

void main() {
  test('configuredOrchestrationSubagentRoles hides unconfigured roles', () {
    const profile = OrchestrationProfile(
      id: 'p1',
      name: 'Test',
      agents: [OrchestrationAgentInstance(agentKey: 'coder', enabled: true)],
    );

    expect(configuredOrchestrationSubagentRoles(profile), ['coder']);
  });

  test('buildActivityFeed returns empty without projection', () {
    final feed = buildActivityFeed(threadPrompt: '', threadId: 't1');
    expect(feed, isEmpty);
  });

  test('buildActivityFeed hides Codex connection status messages', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: const ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 4,
        agents: [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'starting',
            sequence: 1,
            eventType: 'thread.status',
            scope: 'main',
            text: '正在启动Codex…',
            at: '2026-01-01T00:00:00.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'connected',
            sequence: 2,
            eventType: 'thread.status',
            scope: 'main',
            text: 'Codex 已连接 · gpt-5.6-sol',
            at: '2026-01-01T00:00:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'approval-waiting',
            sequence: 3,
            eventType: 'thread.status',
            scope: 'main',
            text: '等待工具权限确认…',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'assistant',
            sequence: 4,
            eventType: 'message.final',
            scope: 'main',
            text: '开始处理任务。',
            at: '2026-01-01T00:00:03.000Z',
          ),
        ],
      ),
    );

    expect(feed.map((entry) => entry.text), ['开始处理任务。']);
  });

  test('parseToolActionDisplayLabel normalizes tool lines', () {
    expect(
      parseToolActionDisplayLabel('Tool: Read · lib/main.dart'),
      'lib/main.dart',
    );
    expect(isUsageNoiseMessage('Usage recorded'), isTrue);
  });

  test('groupActivityFeedActionEntries summarizes consecutive actions', () {
    final grouped = groupActivityFeedActionEntries(const [
      ActivityFeedEntry(
        id: 'edit-1',
        kind: ActivityFeedKind.action,
        text: 'lib/editor.dart',
        actionIcon: ActivityActionIcon.edit,
        lifecycle: ToolActionLifecycle.completed,
      ),
      ActivityFeedEntry(
        id: 'read-1',
        kind: ActivityFeedKind.action,
        text: 'lib/feed.dart',
        actionIcon: ActivityActionIcon.file,
        lifecycle: ToolActionLifecycle.completed,
      ),
      ActivityFeedEntry(
        id: 'grep-1',
        kind: ActivityFeedKind.action,
        text: 'search ActivityFeed',
        actionIcon: ActivityActionIcon.search,
        lifecycle: ToolActionLifecycle.completed,
      ),
    ]);

    expect(grouped.length, 1);
    expect(grouped.first.kind, ActivityFeedKind.actionGroup);
    expect(grouped.first.text, '已读取 1 个文件、已编辑 1 个文件和已搜索代码');
    expect(grouped.first.actionIcon, ActivityActionIcon.edit);
    expect(grouped.first.actionChildren.map((entry) => entry.id), [
      'edit-1',
      'read-1',
      'grep-1',
    ]);
  });

  test('groupActivityFeedActionEntries wraps isolated actions', () {
    final grouped = groupActivityFeedActionEntries(const [
      ActivityFeedEntry(
        id: 'read-1',
        kind: ActivityFeedKind.action,
        text: 'lib/feed.dart',
        actionIcon: ActivityActionIcon.file,
      ),
      ActivityFeedEntry(
        id: 'assistant-1',
        kind: ActivityFeedKind.assistant,
        text: 'done',
      ),
    ]);

    expect(grouped.map((entry) => entry.kind), [
      ActivityFeedKind.actionGroup,
      ActivityFeedKind.assistant,
    ]);
    expect(grouped.first.text, '已读取 lib/feed.dart');
  });

  test('buildActivityFeed keeps tool groups between assistant text blocks', () {
    const requestId = 'req_planner';
    final timeline = <ThreadRunProjectionTimelineItem>[
      _codexMessageTimelineItem(
        id: 'body-1',
        sequence: 1,
        text: '正文输出1',
        at: '2026-01-01T00:00:01.000Z',
        requestId: requestId,
      ),
      for (var index = 0; index < 3; index++)
        _toolTimelineItem(
          id: 'bash-$index-start',
          sequence: 2 + index,
          eventType: 'tool.started',
          toolUseId: 'toolu_bash_$index',
          toolName: 'Bash',
          detail: 'bash${index + 1}',
          at: '2026-01-01T00:00:0${2 + index}.000Z',
          requestId: requestId,
        ),
      _codexMessageTimelineItem(
        id: 'body-2',
        sequence: 5,
        text: '正文输出2',
        at: '2026-01-01T00:00:05.000Z',
        requestId: requestId,
      ),
      for (var index = 0; index < 3; index++)
        _toolTimelineItem(
          id: 'edit-$index-start',
          sequence: 6 + index,
          eventType: 'tool.started',
          toolUseId: 'toolu_edit_$index',
          toolName: 'Edit',
          detail: 'lib/file_${index + 1}.dart',
          at: '2026-01-01T00:00:0${6 + index}.000Z',
          requestId: requestId,
        ),
      _codexMessageTimelineItem(
        id: 'body-3',
        sequence: 9,
        text: '正文输出3',
        at: '2026-01-01T00:00:09.000Z',
        requestId: requestId,
      ),
      for (var index = 0; index < 3; index++)
        _toolTimelineItem(
          id: 'bash-$index-complete',
          sequence: 10 + index,
          eventType: 'tool.completed',
          toolUseId: 'toolu_bash_$index',
          toolName: 'Bash',
          detail: 'bash${index + 1}',
          at: '2026-01-01T00:00:${10 + index}.000Z',
          requestId: requestId,
        ),
      for (var index = 0; index < 3; index++)
        _toolTimelineItem(
          id: 'edit-$index-complete',
          sequence: 13 + index,
          eventType: 'tool.completed',
          toolUseId: 'toolu_edit_$index',
          toolName: 'Edit',
          detail: 'lib/file_${index + 1}.dart',
          at: '2026-01-01T00:00:${13 + index}.000Z',
          requestId: requestId,
        ),
    ];

    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'idle',
        generatedAt: '2026-01-01T00:00:16.000Z',
        sourceEventCount: timeline.length,
        agents: const [],
        requestSpans: const [
          ThreadRunProjectionRequestSpan(
            requestId: requestId,
            status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:16.000Z',
          ),
        ],
        timeline: timeline,
      ),
    );

    expect(feed.map((entry) => entry.kind), [
      ActivityFeedKind.assistant,
      ActivityFeedKind.actionGroup,
      ActivityFeedKind.assistant,
      ActivityFeedKind.actionGroup,
      ActivityFeedKind.assistant,
    ]);
    expect(feed.map((entry) => entry.text), [
      '正文输出1',
      '已运行 3 条命令',
      '正文输出2',
      '已编辑 3 个文件',
      '正文输出3',
    ]);
    expect(feed[1].actionChildren, hasLength(3));
    expect(feed[3].actionChildren, hasLength(3));
  });

  test(
    'groupActivityFeedActionEntries groups adjacent tools across attempts',
    () {
      final grouped = groupActivityFeedActionEntries(const [
        ActivityFeedEntry(
          id: 'read-attempt-1',
          kind: ActivityFeedKind.action,
          text: 'lib/first.dart',
          runAttemptId: 'attempt-1',
        ),
        ActivityFeedEntry(
          id: 'read-attempt-2',
          kind: ActivityFeedKind.action,
          text: 'lib/second.dart',
          runAttemptId: 'attempt-2',
        ),
      ]);

      expect(grouped, hasLength(1));
      expect(grouped.single.kind, ActivityFeedKind.actionGroup);
      expect(grouped.single.runAttemptId, isNull);
    },
  );

  test('empty terminal thinking does not split adjacent tool summaries', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: const ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'completed',
        generatedAt: '2026-01-01T00:00:03.000Z',
        sourceEventCount: 3,
        agents: [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'read-a',
            sequence: 1,
            eventType: 'tool.completed',
            scope: 'main',
            text: 'Tool: Read · lib/a.dart',
            at: '2026-01-01T00:00:01.000Z',
            metadata: {
              'tool': {
                'name': 'Read',
                'detail': 'lib/a.dart',
                'toolUseId': 'toolu_read_a',
                'status': 'completed',
              },
            },
          ),
          ThreadRunProjectionTimelineItem(
            id: 'empty-reasoning',
            sequence: 2,
            eventType: 'thinking.final',
            scope: 'main',
            role: 'thinking',
            text: '',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'read-b',
            sequence: 3,
            eventType: 'tool.completed',
            scope: 'main',
            text: 'Tool: Read · lib/b.dart',
            at: '2026-01-01T00:00:03.000Z',
            metadata: {
              'tool': {
                'name': 'Read',
                'detail': 'lib/b.dart',
                'toolUseId': 'toolu_read_b',
                'status': 'completed',
              },
            },
          ),
        ],
      ),
    );

    expect(feed, hasLength(1));
    expect(feed.single.kind, ActivityFeedKind.actionGroup);
    expect(feed.single.actionChildren.map((entry) => entry.id), [
      'main:lifecycle:toolu_read_a',
      'main:lifecycle:toolu_read_b',
    ]);
    expect(
      feed.any((entry) => entry.kind == ActivityFeedKind.thinking),
      isFalse,
    );
  });

  test('completed attempt separates process from final output', () {
    final feed = buildActivityFeed(
      threadPrompt: '修复 Feed',
      threadId: 't1',
      runProjection: const ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'completed',
        generatedAt: '2026-01-01T00:00:04.000Z',
        sourceEventCount: 4,
        agents: [],
        attempts: [
          ThreadRunProjectionAttempt(
            attemptId: 'attempt-1',
            phase: 'initial',
            retryIndex: 0,
            status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:04.000Z',
          ),
        ],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'user-1',
            sequence: 1,
            eventType: 'thread.status',
            scope: 'main',
            role: 'user',
            runAttemptId: 'attempt-1',
            text: '修复 Feed',
            at: '2026-01-01T00:00:00.000Z',
            metadata: {'liveType': 'thread.user_prompt'},
          ),
          ThreadRunProjectionTimelineItem(
            id: 'narrative-1',
            sequence: 2,
            eventType: 'message.final',
            scope: 'main',
            runAttemptId: 'attempt-1',
            text: '我先检查投影数据。',
            at: '2026-01-01T00:00:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'tool-1',
            sequence: 3,
            eventType: 'tool.completed',
            scope: 'main',
            runAttemptId: 'attempt-1',
            text: 'Tool: Read · lib/feed.dart',
            at: '2026-01-01T00:00:02.000Z',
            metadata: {
              'tool': {
                'name': 'Read',
                'detail': 'lib/feed.dart',
                'status': 'completed',
              },
            },
          ),
          ThreadRunProjectionTimelineItem(
            id: 'final-1',
            sequence: 4,
            eventType: 'message.final',
            scope: 'main',
            runAttemptId: 'attempt-1',
            text: 'Feed 已按轮次完成整理。',
            at: '2026-01-01T00:00:04.000Z',
          ),
        ],
      ),
    );

    expect(feed.first.kind, ActivityFeedKind.user);
    final turn = feed.singleWhere(
      (entry) => entry.kind == ActivityFeedKind.turn,
    );
    expect(turn.running, isFalse);
    expect(turn.finalOutput?.text, 'Feed 已按轮次完成整理。');
    expect(
      turn.processEntries.map((entry) => entry.text),
      contains('我先检查投影数据。'),
    );
    expect(
      turn.processEntries.any(
        (entry) =>
            entry.kind == ActivityFeedKind.action ||
            entry.kind == ActivityFeedKind.actionGroup,
      ),
      isTrue,
    );
    expect(turn.processEntries.any((entry) => entry.id == 'final-1'), isFalse);
  });

  test('running attempt keeps all assistant output in process', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: const ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:02.000Z',
        sourceEventCount: 1,
        agents: [],
        attempts: [
          ThreadRunProjectionAttempt(
            attemptId: 'attempt-running',
            phase: 'follow_up',
            retryIndex: 0,
            status: 'running',
            startedAt: '2026-01-01T00:00:00.000Z',
          ),
        ],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'message-running',
            sequence: 1,
            eventType: 'message.final',
            scope: 'main',
            runAttemptId: 'attempt-running',
            text: '正在检查剩余文件。',
            at: '2026-01-01T00:00:01.000Z',
          ),
        ],
      ),
    );

    final turn = feed.single;
    expect(turn.kind, ActivityFeedKind.turn);
    expect(turn.running, isTrue);
    expect(turn.finalOutput, isNull);
    expect(turn.processEntries.single.text, '正在检查剩余文件。');
  });

  testWidgets(
    'completed turn collapses process and keeps final output visible',
    (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildEcoDarkTheme(),
          home: Scaffold(
            body: ActivityFeedList(
              scrollController: controller,
              shrinkWrap: true,
              entries: const [
                ActivityFeedEntry(
                  id: 'turn-1',
                  kind: ActivityFeedKind.turn,
                  text: '',
                  durationMs: 2000,
                  processEntries: [
                    ActivityFeedEntry(
                      id: 'process-1',
                      kind: ActivityFeedKind.assistant,
                      text: '执行过程正文',
                    ),
                  ],
                  finalOutput: ActivityFeedEntry(
                    id: 'final-1',
                    kind: ActivityFeedKind.assistant,
                    text: '最终输出正文',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.textContaining('已处理'), findsOneWidget);
      expect(find.text('最终输出正文'), findsOneWidget);
      expect(find.text('执行过程正文'), findsNothing);

      await tester.tap(find.textContaining('已处理'));
      await tester.pumpAndSettle();
      expect(find.text('执行过程正文'), findsOneWidget);
    },
  );

  testWidgets('completed thinking hides content until expanded', (
    tester,
  ) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        home: Scaffold(
          body: ActivityFeedList(
            scrollController: controller,
            shrinkWrap: true,
            entries: const [
              ActivityFeedEntry(
                id: 'thinking-1',
                kind: ActivityFeedKind.thinking,
                text: '这段思考只能在展开后显示',
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('思考'), findsOneWidget);
    expect(find.text('这段思考只能在展开后显示'), findsNothing);

    await tester.tap(find.text('思考'));
    await tester.pumpAndSettle();
    expect(find.text('这段思考只能在展开后显示'), findsOneWidget);
  });

  testWidgets('primary feed rows share one font size', (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        home: Scaffold(
          body: ActivityFeedList(
            scrollController: controller,
            shrinkWrap: true,
            entries: const [
              ActivityFeedEntry(
                id: 'user-font',
                kind: ActivityFeedKind.user,
                text: '用户消息字号',
              ),
              ActivityFeedEntry(
                id: 'assistant-font',
                kind: ActivityFeedKind.assistant,
                text: '正文输出字号',
                streaming: true,
              ),
              ActivityFeedEntry(
                id: 'thinking-font',
                kind: ActivityFeedKind.thinking,
                text: '',
                streaming: true,
              ),
              ActivityFeedEntry(
                id: 'turn-font',
                kind: ActivityFeedKind.turn,
                text: '',
                durationMs: 2000,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    for (var index = 0; index < 12; index++) {
      await tester.pump(pacedStreamInterval);
    }

    double? fontSize(String text) =>
        tester.widget<Text>(find.text(text)).style?.fontSize;
    final expected = fontSize('用户消息字号');
    expect(expected, isNotNull);
    expect(fontSize('正文输出字号'), expected);
    expect(fontSize('正在思考'), expected);
  });

  test('groupActivityFeedActionEntries includes Bash cards in tool groups', () {
    final grouped = groupActivityFeedActionEntries(const [
      ActivityFeedEntry(
        id: 'read-1',
        kind: ActivityFeedKind.action,
        text: 'lib/feed.dart',
        actionIcon: ActivityActionIcon.file,
      ),
      ActivityFeedEntry(
        id: 'edit-1',
        kind: ActivityFeedKind.action,
        text: 'lib/editor.dart',
        actionIcon: ActivityActionIcon.edit,
      ),
      ActivityFeedEntry(
        id: 'bash-1',
        kind: ActivityFeedKind.action,
        text: 'Run unit tests',
        actionIcon: ActivityActionIcon.terminal,
        bashRun: BashRunCardDisplay(
          title: 'Run unit tests',
          meta: 'npm, 1.2s',
          command: 'npm test',
          output: '36 pass',
        ),
      ),
      ActivityFeedEntry(
        id: 'search-1',
        kind: ActivityFeedKind.action,
        text: 'search ActivityFeed',
        actionIcon: ActivityActionIcon.search,
      ),
      ActivityFeedEntry(
        id: 'read-2',
        kind: ActivityFeedKind.action,
        text: 'lib/theme.dart',
        actionIcon: ActivityActionIcon.file,
      ),
    ]);

    expect(grouped, hasLength(1));
    expect(grouped.single.id, 'action-group:read-1');
    expect(grouped.single.actionChildren, hasLength(5));
    expect(grouped.single.actionChildren[2].bashRun?.command, 'npm test');
    expect(grouped.single.actionChildren[2].bashRun?.output, '36 pass');
  });

  test('tool group shows the latest running action as 正在...', () {
    final grouped = groupActivityFeedActionEntries(const [
      ActivityFeedEntry(
        id: 'read-1',
        kind: ActivityFeedKind.action,
        text: 'lib/feed.dart',
        toolName: 'Read',
        actionIcon: ActivityActionIcon.file,
        lifecycle: ToolActionLifecycle.completed,
      ),
      ActivityFeedEntry(
        id: 'bash-1',
        kind: ActivityFeedKind.action,
        text: 'npm test',
        toolName: 'Bash',
        actionIcon: ActivityActionIcon.terminal,
        lifecycle: ToolActionLifecycle.running,
      ),
    ]);

    expect(grouped.single.text, '正在运行 npm test');
    expect(grouped.single.lifecycle, ToolActionLifecycle.running);
    expect(grouped.single.id, 'action-group:read-1');
  });

  test(
    'subagentMissionBorderColor uses unknown blue for non-standard roles',
    () {
      expect(
        resolveSubagentThemeColor('researcher'),
        subagentUnknownThemeColor,
      );
    },
  );

  test('parseSubagentMissionMessage extracts summary from @mission JSON', () {
    const payload =
        '@mission {"role":"explore","summary":"梳理 auth 模块","prompt":"check auth flow"}';
    final mission = parseSubagentMissionMessage(payload);
    expect(mission?.role, 'explore');
    expect(mission?.summary, '梳理 auth 模块');
    expect(mission?.prompt, 'check auth flow');
  });

  test('bash approval merges into the same action row by toolUseId', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 2,
        agents: const [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'approval-1',
            sequence: 1,
            eventType: 'bash_approval.requested',
            scope: 'main',
            text: '等待确认 Bash：npm test',
            at: '2026-01-01T00:00:00.000Z',
            metadata: const {
              'bashApproval': {
                'toolUseId': 'toolu_bash_1',
                'toolName': 'Bash',
                'detail': 'npm test',
                'description': 'Run unit tests',
                'phase': 'approved',
              },
            },
          ),
          ThreadRunProjectionTimelineItem(
            id: 'tool-1',
            sequence: 2,
            eventType: 'tool.started',
            scope: 'main',
            role: 'tool',
            agentId: 'agent_coder_1',
            text: 'Tool: Bash · npm test',
            at: '2026-01-01T00:00:01.000Z',
            metadata: const {
              'tool': {
                'name': 'Bash',
                'detail': 'npm test',
                'toolUseId': 'toolu_bash_1',
                'description': 'Run unit tests',
                'status': 'running',
              },
            },
          ),
        ],
      ),
    );

    final actions = _toolActions(feed);
    expect(actions.length, 1);
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.bashRun?.title, 'Run unit tests');
  });

  test(
    'buildActivityFeed merges bash approval lifecycle into one completed card',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 3,
          agents: const [],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'approval-wait',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'tool',
              text: '等待确认 Bash：npm test',
              at: '2026-01-01T00:00:00.000Z',
              metadata: const {
                'liveType': 'bash_approval.requested',
                'bashApproval': {
                  'toolUseId': 'toolu_bash_1',
                  'toolName': 'Bash',
                  'detail': 'npm test',
                  'description': 'Run unit tests',
                  'phase': 'requested',
                },
              },
            ),
            ThreadRunProjectionTimelineItem(
              id: 'approval-approved',
              sequence: 2,
              eventType: 'message.final',
              scope: 'main',
              role: 'tool',
              text: '已允许本次 Bash：npm test',
              at: '2026-01-01T00:00:00.500Z',
              metadata: const {
                'liveType': 'bash_approval.approved',
                'bashApproval': {
                  'toolUseId': 'toolu_bash_1',
                  'toolName': 'Bash',
                  'detail': 'npm test',
                  'description': 'Run unit tests',
                  'phase': 'approved',
                },
              },
            ),
            ThreadRunProjectionTimelineItem(
              id: 'bash-completed',
              sequence: 3,
              eventType: 'tool.completed',
              scope: 'main',
              role: 'tool',
              text: 'Tool: Bash · npm test',
              at: '2026-01-01T00:00:01.000Z',
              metadata: const {
                'liveType': 'tool.completed',
                'tool': {
                  'name': 'Bash',
                  'detail': 'npm test',
                  'toolUseId': 'toolu_bash_1',
                  'description': 'Run unit tests',
                  'status': 'completed',
                  'output': '36 pass',
                },
              },
            ),
          ],
        ),
      );

      final actions = _toolActions(feed);
      expect(actions.length, 1);
      expect(actions.first.toolUseId, 'toolu_bash_1');
      expect(actions.first.text, 'Run unit tests');
      expect(actions.first.lifecycle, ToolActionLifecycle.completed);
      expect(actions.first.bashRun?.command, 'npm test');
      expect(actions.first.bashRun?.output, '36 pass');
      expect(
        feed.any(
          (entry) =>
              entry.kind == ActivityFeedKind.assistant &&
              (entry.text.contains('等待确认') || entry.text.contains('已允许本次')),
        ),
        isFalse,
      );
    },
  );

  test(
    'buildActivityFeed keeps bash approval out of assistant body after approval',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 2,
          agents: const [],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'approval-approved',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'tool',
              text: '已允许本次 Bash：npm test',
              at: '2026-01-01T00:00:00.000Z',
              metadata: const {
                'liveType': 'bash_approval.approved',
                'bashApproval': {
                  'toolUseId': 'toolu_bash_1',
                  'toolName': 'Bash',
                  'detail': 'npm test',
                  'description': 'Run unit tests',
                  'phase': 'approved',
                },
              },
            ),
            ThreadRunProjectionTimelineItem(
              id: 'planner-note',
              sequence: 2,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              text: '正在执行测试命令。',
              at: '2026-01-01T00:00:00.500Z',
            ),
          ],
        ),
      );

      final actions = _toolActions(feed);
      expect(actions.length, 1);
      expect(actions.first.lifecycle, ToolActionLifecycle.approvalApproved);
      expect(
        feed.any(
          (entry) =>
              entry.kind == ActivityFeedKind.assistant &&
              entry.text.contains('已允许本次'),
        ),
        isFalse,
      );
    },
  );

  testWidgets(
    'ActivityFeedList expands Bash title before showing command and output',
    (tester) async {
      final scrollController = ScrollController();
      addTearDown(scrollController.dispose);
      var detailOpenCount = 0;

      await tester.pumpWidget(
        MaterialApp(
          theme: buildEcoDarkTheme(),
          home: Scaffold(
            body: ActivityFeedList(
              entries: const [
                ActivityFeedEntry(
                  id: 'bash-1',
                  kind: ActivityFeedKind.action,
                  text: 'Run unit tests',
                  actionIcon: ActivityActionIcon.terminal,
                  lifecycle: ToolActionLifecycle.completed,
                  toolUseId: 'toolu_bash_1',
                  bashRun: BashRunCardDisplay(
                    title: 'Run unit tests',
                    meta: 'npm, 1.2s',
                    command: 'npm test',
                    output: '36 pass',
                  ),
                ),
              ],
              scrollController: scrollController,
              onOpenToolDetail: (_) {
                detailOpenCount += 1;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('已运行 Run unit tests'), findsOneWidget);
      expect(find.text('36 pass'), findsNothing);
      expect(find.text('npm test'), findsNothing);

      await tester.tap(find.text('已运行 Run unit tests'));
      await tester.pumpAndSettle();

      expect(find.text('36 pass'), findsOneWidget);
      expect(find.text('npm test'), findsOneWidget);
      expect(detailOpenCount, 0);
    },
  );

  test('Bash title uses description or Shell without command fallback', () {
    expect(
      resolveBashRunCardDisplay(toolName: 'Bash', command: 'npm test')?.title,
      'Shell',
    );
    expect(
      resolveBashRunCardDisplay(
        toolName: 'Bash',
        command: 'npm test',
        description: 'Run unit tests',
      )?.title,
      'Run unit tests',
    );
  });

  test('Bash metadata hides zero duration and keeps real duration', () {
    expect(formatBashRunMeta('npm test', durationMs: 0), 'npm');
    expect(formatBashRunMeta('npm test', durationMs: 1250), 'npm, 1.3s');
  });

  test('subagent mission card gets duration and timeline from projection', () {
    final feed = buildActivityFeed(
      threadPrompt: '实现登录',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot.fromJson({
        'thread': {
          'threadId': 't1',
          'status': 'running',
          'generatedAt': '2026-01-01T00:00:00.000Z',
        },
        'sourceEventCount': 2,
        'agents': [
          {
            'agentId': 'agent_coder_1',
            'role': 'coder',
            'kind': 'subagent',
            'status': 'active',
            'startedAt': '2026-01-01T00:00:00.000Z',
            'durationMs': 4200,
            'delegationPrompt': 'add login',
            'delegationSummary': '实现登录',
            'timeline': [
              {
                'id': 'tl1',
                'sequence': 1,
                'eventType': 'tool.started',
                'scope': 'agent',
                'text': 'Reading src/auth.ts',
                'at': '2026-01-01T00:00:01.000Z',
                'role': 'coder',
                'agentId': 'agent_coder_1',
                'metadata': {
                  'tool': {
                    'name': 'Read',
                    'detail': 'src/auth.ts',
                    'toolUseId': 'toolu_read_1',
                  },
                },
              },
            ],
          },
        ],
      }),
      subagentSessions: const [
        ThreadSubagentSessionTiming(
          agentId: 'agent_coder_1',
          role: 'coder',
          status: 'active',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:04.000Z',
          accumulatedMs: 4200,
          durationMs: 4200,
        ),
      ],
    );

    final missions = feed
        .where((entry) => entry.kind == ActivityFeedKind.subagentMission)
        .toList();
    expect(missions.length, 1);
    final card = missions.first;
    expect(card.kind, ActivityFeedKind.subagentMission);
    expect(card.agentId, 'agent_coder_1');
    expect(card.text, '实现登录');
    expect(card.running, isTrue);
    expect(card.durationMs, greaterThan(0));
    expect(card.timeline.length, 1);
    expect(feed.any((entry) => entry.kind == ActivityFeedKind.action), isFalse);
  });

  test(
    'isSubagentMissionEnvelope matches legacy and structured mission lines',
    () {
      expect(isSubagentMissionEnvelope('@mission explore: scan src'), isTrue);
      expect(
        isSubagentMissionEnvelope(
          '@mission {"role":"explore","summary":"scan","prompt":"scan src"}',
        ),
        isTrue,
      );
      expect(isSubagentMissionEnvelope('Plain task prompt'), isFalse);
    },
  );

  test('buildActivityFeed keeps subagent content inside its mission card', () {
    const missionText =
        '@mission {"role":"explore","summary":"Gather CPU info","prompt":"Gather CPU info","agentId":"agent_explore_a"}';
    final feed = buildActivityFeed(
      runProjection: ThreadRunProjectionSnapshot.fromJson({
        'thread': {
          'threadId': 't1',
          'status': 'running',
          'generatedAt': '2026-01-01T00:00:00.000Z',
        },
        'sourceEventCount': 2,
        'agents': [
          {
            'agentId': 'agent_explore_a',
            'role': 'explore',
            'kind': 'subagent',
            'status': 'active',
            'startedAt': '2026-01-01T00:00:01.000Z',
            'durationMs': 1000,
            'delegationPrompt': 'Gather CPU info',
            'delegationSummary': 'Gather CPU info',
            'timeline': [
              {
                'id': 'mission-echo',
                'sequence': 2,
                'eventType': 'message.final',
                'scope': 'agent',
                'text': missionText,
                'at': '2026-01-01T00:00:01.100Z',
                'role': 'explore',
                'agentId': 'agent_explore_a',
              },
              {
                'id': 'agent-speech',
                'sequence': 3,
                'eventType': 'message.final',
                'scope': 'agent',
                'text': 'Checking CPU topology.',
                'at': '2026-01-01T00:00:02.000Z',
                'role': 'explore',
                'agentId': 'agent_explore_a',
              },
            ],
          },
        ],
      }),
    );

    expect(
      feed
          .where((entry) => entry.kind == ActivityFeedKind.subagentMission)
          .length,
      1,
    );
    expect(feed.any((entry) => entry.text.contains('@mission')), isFalse);
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.assistant &&
            entry.text == 'Checking CPU topology.',
      ),
      isFalse,
    );
    final mission = feed.singleWhere(
      (entry) => entry.kind == ActivityFeedKind.subagentMission,
    );
    expect(
      mission.timeline.any((item) => item.label == 'Checking CPU topology.'),
      isTrue,
    );
  });

  test('buildActivityFeed renders bash action cards from history text', () {
    final feed = buildActivityFeed(
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 1,
        agents: [
          ThreadRunProjectionAgent(
            agentId: 'agent_planner',
            role: 'planner',
            kind: 'main',
            status: 'active',
            startedAt: '2026-01-01T00:00:00.000Z',
            durationMs: 1000,
            timeline: [
              ThreadRunProjectionTimelineItem(
                id: 'bash-done',
                sequence: 1,
                eventType: 'tool.completed',
                scope: 'main',
                text: 'Tool: Bash · npm test',
                at: '2026-01-01T00:00:01.000Z',
                metadata: const {
                  'tool': {
                    'name': 'Bash',
                    'detail': 'npm test',
                    'toolUseId': 'toolu_bash_1',
                    'description': 'Run unit tests',
                  },
                },
              ),
            ],
          ),
        ],
      ),
    );

    final actions = _toolActions(feed);
    expect(actions.length, 1);
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.bashRun?.title, 'Run unit tests');
  });

  test(
    'buildActivityFeed injects cards for concurrent projection subagents',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '并发子代理',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 3,
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'user-1',
              sequence: 0,
              eventType: 'thread.status',
              scope: 'main',
              role: 'user',
              text: '并发子代理',
              at: '2026-01-01T00:00:00.000Z',
              metadata: const {'liveType': 'thread.user_prompt'},
            ),
            ThreadRunProjectionTimelineItem(
              id: 'planner-1',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              text: '主代理先说明计划。',
              at: '2026-01-01T00:00:02.000Z',
            ),
          ],
          agents: [
            ThreadRunProjectionAgent(
              agentId: 'agent_explore_1',
              role: 'explore',
              kind: 'subagent',
              status: 'active',
              startedAt: '2026-01-01T00:00:00.500Z',
              durationMs: 1000,
              timeline: const [],
              delegationSummary: '梳理模块 A',
            ),
            ThreadRunProjectionAgent(
              agentId: 'agent_coder_1',
              role: 'coder',
              kind: 'subagent',
              status: 'active',
              startedAt: '2026-01-01T00:00:01.000Z',
              durationMs: 2000,
              timeline: const [],
              delegationSummary: '实现功能 B',
            ),
          ],
        ),
      );

      final missions = feed
          .where((entry) => entry.kind == ActivityFeedKind.subagentMission)
          .toList();
      expect(missions.length, 2);
      expect(missions.map((entry) => entry.agentId).toSet(), {
        'agent_explore_1',
        'agent_coder_1',
      });
      final exploreIndex = feed.indexWhere(
        (entry) => entry.agentId == 'agent_explore_1',
      );
      final plannerIndex = feed.indexWhere(
        (entry) => entry.kind == ActivityFeedKind.assistant,
      );
      expect(exploreIndex, lessThan(plannerIndex));
    },
  );

  test('buildActivityFeed preserves user prompt image previews', () {
    final feed = buildActivityFeed(
      threadPrompt: '分析图片',
      threadId: 't-image',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't-image',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 1,
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'user-image',
            sequence: 1,
            eventType: 'thread.status',
            scope: 'main',
            role: 'user',
            text: '分析图片',
            at: '2026-01-01T00:00:00.000Z',
            metadata: const {
              'liveType': 'thread.user_prompt',
              'promptImagePreviews': [
                {'id': 'preview-1', 'mediaType': 'image/jpeg', 'data': 'YWJj'},
              ],
            },
          ),
        ],
        agents: const [],
      ),
    );

    final user = feed.firstWhere(
      (entry) => entry.kind == ActivityFeedKind.user,
    );
    expect(user.attachments, hasLength(1));
    expect(user.attachments.single.mediaType, 'image/jpeg');
  });

  test(
    'buildActivityFeed keeps subagent mission before later assistant text',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '修复登录',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot.fromJson({
          'thread': {
            'threadId': 't1',
            'status': 'running',
            'generatedAt': '2026-01-01T00:00:00.000Z',
          },
          'sourceEventCount': 3,
          'timeline': [
            {
              'id': 'user-1',
              'sequence': 0,
              'eventType': 'thread.status',
              'scope': 'main',
              'role': 'user',
              'text': '修复登录',
              'at': '2026-01-01T00:00:00.000Z',
              'metadata': {'liveType': 'thread.user_prompt'},
            },
            {
              'id': 'planner-1',
              'sequence': 3,
              'eventType': 'message.final',
              'scope': 'main',
              'role': 'planner',
              'text': '子代理完成后我继续总结。',
              'at': '2026-01-01T00:00:06.000Z',
            },
          ],
          'agents': [
            {
              'agentId': 'agent_coder_1',
              'role': 'coder',
              'kind': 'subagent',
              'status': 'stopped',
              'startedAt': '2026-01-01T00:00:01.000Z',
              'endedAt': '2026-01-01T00:00:05.000Z',
              'durationMs': 4000,
              'delegationPrompt': 'add login',
              'delegationSummary': '实现登录',
              'timeline': [],
            },
          ],
        }),
      );

      final missionIndex = feed.indexWhere(
        (entry) => entry.kind == ActivityFeedKind.subagentMission,
      );
      final assistantIndex = feed.indexWhere(
        (entry) => entry.kind == ActivityFeedKind.assistant,
      );
      expect(missionIndex, greaterThanOrEqualTo(0));
      expect(assistantIndex, greaterThan(missionIndex));
      expect(feed[missionIndex].agentId, 'agent_coder_1');
    },
  );

  test('GitWorkingTreeStatus exposes workspace changes summary', () {
    const status = GitWorkingTreeStatus(
      workspacePath: '/tmp/repo',
      isGitRepository: true,
      hasGitCommits: true,
      dirtyFileCount: 3,
      insertions: 12,
      deletions: 4,
      canCommit: true,
      aheadCount: 0,
      behindCount: 0,
      hasUpstream: false,
    );

    expect(status.toChangesSummary().fileCount, 3);
    expect(status.toChangesSummary().totalAdditions, 12);
    expect(status.toChangesSummary().hasChanges, isTrue);
  });

  test('buildActivityFeed still renders truncated projection text', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'idle',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 1,
        agents: const [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'evt_truncated',
            sequence: 1,
            eventType: 'message.final',
            scope: 'main',
            text: 'preview only',
            at: '2026-01-01T00:00:00.000Z',
            metadata: const {'textTruncated': true},
          ),
        ],
      ),
    );

    expect(feed, isNotEmpty);
    expect(feed.first.text, 'preview only');
  });

  test('buildActivityFeed hides model request lifecycle from mobile feed', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 5,
        agents: const [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'request-done',
            sequence: 1,
            eventType: 'request.completed',
            scope: 'main',
            text: '模型请求完成',
            at: '2026-01-01T00:00:00.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'request-failed',
            sequence: 2,
            eventType: 'request.failed',
            scope: 'main',
            text: '模型请求失败',
            at: '2026-01-01T00:00:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'request-cancelled',
            sequence: 3,
            eventType: 'request.cancelled',
            scope: 'main',
            text: '模型请求已取消',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'route-changed',
            sequence: 4,
            eventType: 'thread.status',
            scope: 'main',
            text: '模型路由已变更，将尝试接续原 session；若失败会自动改用对话摘要。',
            at: '2026-01-01T00:00:03.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'cache-drift',
            sequence: 5,
            eventType: 'context.cache_config_drift',
            scope: 'main',
            text: '模型路由已变更：主模型',
            at: '2026-01-01T00:00:04.000Z',
          ),
        ],
      ),
    );

    expect(feed.any((entry) => entry.text == '模型请求完成'), isFalse);
    expect(feed.any((entry) => entry.text == '模型请求失败'), isFalse);
    expect(feed.any((entry) => entry.text == '模型请求已取消'), isFalse);
    expect(feed.any((entry) => entry.text.contains('模型路由已变更')), isFalse);
  });

  test('buildActivityFeed drops reconnect after agent recovers', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 2,
        agents: const [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'reconnect-1',
            sequence: 1,
            eventType: 'request.retry_scheduled',
            scope: 'main',
            text: 'API retry 2/5…',
            at: '2026-01-01T00:00:00.000Z',
            metadata: {
              'activityOrigin': 'sdk.api_retry',
              'retry': {'attempt': 2, 'maxRetries': 5},
            },
          ),
          ThreadRunProjectionTimelineItem(
            id: 'reply-1',
            sequence: 2,
            eventType: 'message.final',
            scope: 'main',
            text: '好的，我已经完成分析。',
            at: '2026-01-01T00:00:00.001Z',
          ),
        ],
      ),
    );

    expect(feed.where((entry) => entry.reconnecting), isEmpty);
    expect(feed.any((entry) => entry.text.contains('完成分析')), isTrue);
  });

  test('hasFollowingValidFeedContent waits for substantive feed rows', () {
    final thinking = ActivityFeedEntry(
      id: 'think-1',
      kind: ActivityFeedKind.thinking,
      text: '分析项目结构',
    );
    final phase = ActivityFeedEntry(
      id: 'phase-1',
      kind: ActivityFeedKind.phase,
      text: '上下文压缩已暂停',
    );
    final assistant = ActivityFeedEntry(
      id: 'reply-1',
      kind: ActivityFeedKind.assistant,
      text: '好的，我来处理。',
    );

    expect(hasFollowingValidFeedContent([thinking], 0), isFalse);
    expect(hasFollowingValidFeedContent([thinking, phase], 0), isFalse);
    expect(hasFollowingValidFeedContent([thinking, assistant], 0), isTrue);
    expect(
      hasFollowingValidFeedContent([
        thinking,
        ActivityFeedEntry(
          id: 'tool-1',
          kind: ActivityFeedKind.action,
          text: '读取 src/main.dart',
        ),
      ], 0),
      isTrue,
    );
  });

  test('buildActivityFeed maps reconnect activity to collapsible phase', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 2,
        agents: const [],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'reconnect-1',
            sequence: 1,
            eventType: 'message.final',
            scope: 'main',
            text:
                '【连接失败】HTTP 500：upstream error: do request failed (request id: abc)',
            at: '2026-01-01T00:00:00.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'reconnect-2',
            sequence: 2,
            eventType: 'request.retry_scheduled',
            scope: 'main',
            text: 'API retry 2/5…',
            at: '2026-01-01T00:00:00.001Z',
            metadata: {
              'activityOrigin': 'sdk.api_retry',
              'retry': {'attempt': 2, 'maxRetries': 5},
            },
          ),
        ],
      ),
    );

    final reconnectEntries = feed
        .where((entry) => entry.reconnecting)
        .toList(growable: false);
    expect(reconnectEntries, hasLength(1));
    expect(reconnectEntries.first.text, '重连 2/5');
    expect(reconnectEntries.first.detail, isNull);
  });

  test(
    'buildActivityFeed treats recorded user prompts as right-aligned user bubbles',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '请继续实现登录页',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 1,
          agents: const [],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'prompt',
              sequence: 0,
              eventType: 'thread.status',
              scope: 'main',
              role: 'user',
              text: '请继续实现登录页',
              at: '2026-01-01T00:00:00.000Z',
              metadata: const {'liveType': 'thread.user_prompt'},
            ),
          ],
        ),
      );

      final userEntries = feed
          .where((entry) => entry.kind == ActivityFeedKind.user)
          .toList();
      expect(userEntries, hasLength(1));
      expect(userEntries.first.text, '请继续实现登录页');
      expect(
        feed.any(
          (entry) =>
              entry.kind == ActivityFeedKind.phase && entry.text == '请继续实现登录页',
        ),
        isFalse,
      );
    },
  );

  test('parseClarificationAnswersSummary extracts question answer rows', () {
    final rows = parseClarificationAnswersSummary(
      '澄清回答：是否自动分配？ → 自动启用；导出范围 → 已启用、备选',
    );
    expect(rows, isNotNull);
    expect(rows, hasLength(2));
    expect(rows![0].question, '是否自动分配？');
    expect(rows[0].answer, '自动启用');
    expect(rows[1].question, '导出范围');
    expect(rows[1].answer, '已启用、备选');
    expect(parseClarificationAnswersSummary('普通助手回复'), isNull);
  });

  test(
    'buildActivityFeed renders clarification answers as right-aligned cards',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 1,
          agents: const [],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'clarification-answer',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              text: '澄清回答：是否自动分配？ → 自动启用',
              at: '2026-01-01T00:00:01.000Z',
            ),
          ],
        ),
      );

      final answers = feed
          .where((entry) => entry.kind == ActivityFeedKind.clarificationAnswer)
          .toList();
      expect(answers, hasLength(1));
      expect(
        feed.any((entry) => entry.kind == ActivityFeedKind.assistant),
        isFalse,
      );
    },
  );

  testWidgets('ActivityFeedList collapses long user prompts to five lines', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final scrollController = ScrollController();
    addTearDown(scrollController.dispose);

    final longText = List.filled(12, '这是一段较长的用户输入内容').join('\n');

    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: ActivityFeedList(
              entries: [
                ActivityFeedEntry(
                  id: 'user-long',
                  kind: ActivityFeedKind.user,
                  text: longText,
                ),
              ],
              scrollController: scrollController,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('展开全文'), findsOneWidget);

    await tester.tap(find.text('展开全文'));
    await tester.pumpAndSettle();

    expect(find.text('收起'), findsOneWidget);
  });

  testWidgets('ActivityFeedList keeps short user prompts fully visible', (
    tester,
  ) async {
    final scrollController = ScrollController();
    addTearDown(scrollController.dispose);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        home: Scaffold(
          body: ActivityFeedList(
            entries: const [
              ActivityFeedEntry(
                id: 'user-short',
                kind: ActivityFeedKind.user,
                text: '短消息',
              ),
            ],
            scrollController: scrollController,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('展开全文'), findsNothing);
    expect(find.text('短消息'), findsOneWidget);
  });

  testWidgets('ActivityFeedList shrinkWrap grows until constrained', (
    tester,
  ) async {
    const maxHeight = 220.0;
    final scrollController = ScrollController();
    addTearDown(scrollController.dispose);
    final listKey = GlobalKey();

    Future<void> pumpList(List<ActivityFeedEntry> entries) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildEcoDarkTheme(),
          home: Scaffold(
            body: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: maxHeight),
                child: ActivityFeedList(
                  key: listKey,
                  entries: entries,
                  scrollController: scrollController,
                  shrinkWrap: true,
                  showScrollJumpButton: false,
                  padding: EdgeInsets.zero,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    await pumpList(const [
      ActivityFeedEntry(
        id: 'phase-short',
        kind: ActivityFeedKind.phase,
        text: '短状态',
      ),
    ]);
    expect(tester.getSize(find.byKey(listKey)).height, lessThan(maxHeight));

    await pumpList(
      List.generate(
        16,
        (index) => ActivityFeedEntry(
          id: 'assistant-$index',
          kind: ActivityFeedKind.assistant,
          text: '这是一段用于撑高详情弹窗的内容 $index',
        ),
      ),
    );
    expect(tester.getSize(find.byKey(listKey)).height, maxHeight);
  });

  test(
    'resolveSubagentCardMissionText falls back to main timeline @mission by parentToolUseId',
    () {
      const missionText =
          '@mission {"role":"coder","summary":"Implement export filters in src/api.ts","prompt":"Implement export filters in src/api.ts"}';
      final text = resolveSubagentCardMissionText(
        ThreadRunProjectionAgent(
          agentId: 'agent_coder_a',
          role: 'coder',
          kind: 'subagent',
          status: 'active',
          startedAt: '2026-01-01T00:00:01.000Z',
          durationMs: 0,
          parentToolUseId: 'toolu_agent_1',
          timeline: const [],
        ),
        mainTimeline: [
          ThreadRunProjectionTimelineItem(
            id: 'delegate-coder',
            sequence: 1,
            eventType: 'tool.started',
            scope: 'main',
            role: 'coder',
            text: missionText,
            at: '2026-01-01T00:00:00.000Z',
            metadata: const {
              'liveType': 'tool.started',
              'tool': {
                'name': 'Agent',
                'detail': 'coder',
                'toolUseId': 'toolu_agent_1',
                'status': 'running',
              },
            },
          ),
        ],
      );
      expect(text, 'Implement export filters in src/api.ts');
    },
  );

  test(
    'resolveSubagentCardMissionText falls back to agent.started timeline metadata',
    () {
      final text = resolveSubagentCardMissionText(
        ThreadRunProjectionAgent(
          agentId: 'coder_a',
          role: 'coder',
          kind: 'subagent',
          status: 'active',
          startedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 0,
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'agent-started',
              sequence: 1,
              eventType: 'agent.started',
              scope: 'agent',
              role: 'coder',
              agentId: 'coder_a',
              text: 'Subagent coder started',
              at: '2026-01-01T00:00:00.000Z',
              metadata: const {
                'lifecycle': 'started',
                'delegationPrompt': 'Review export filters in src/api.ts',
                'delegationSummary': '审查：export filters',
              },
            ),
          ],
        ),
      );
      expect(text, 'Review export filters in src/api.ts');
    },
  );

  test(
    'buildActivityFeed shows subagent mission from parentToolUseId fallback',
    () {
      const missionText =
          '@mission {"role":"coder","summary":"Implement export filters in src/api.ts","prompt":"Implement export filters in src/api.ts"}';
      final feed = buildActivityFeed(
        runProjection: ThreadRunProjectionSnapshot.fromJson({
          'thread': {
            'threadId': 't1',
            'status': 'running',
            'generatedAt': '2026-01-01T00:00:00.000Z',
          },
          'sourceEventCount': 2,
          'timeline': [
            {
              'id': 'delegate-coder',
              'sequence': 1,
              'eventType': 'tool.started',
              'scope': 'main',
              'role': 'coder',
              'text': missionText,
              'at': '2026-01-01T00:00:00.000Z',
              'metadata': {
                'liveType': 'tool.started',
                'tool': {
                  'name': 'Agent',
                  'detail': 'coder',
                  'toolUseId': 'toolu_agent_1',
                  'status': 'running',
                },
              },
            },
          ],
          'agents': [
            {
              'agentId': 'agent_coder_a',
              'role': 'coder',
              'kind': 'subagent',
              'status': 'active',
              'startedAt': '2026-01-01T00:00:01.000Z',
              'durationMs': 0,
              'parentToolUseId': 'toolu_agent_1',
              'timeline': [],
            },
          ],
        }),
      );

      final card = feed.firstWhere(
        (entry) => entry.kind == ActivityFeedKind.subagentMission,
      );
      expect(card.missionPrompt, 'Implement export filters in src/api.ts');
    },
  );

  test(
    'buildActivityFeed keeps completed planner replies from prior turns',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'idle',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 3,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_turn_1',
              status: 'completed',
              startedAt: '2026-01-01T00:00:01.000Z',
              endedAt: '2026-01-01T00:00:03.000Z',
            ),
            ThreadRunProjectionRequestSpan(
              requestId: 'req_turn_2',
              status: 'completed',
              startedAt: '2026-01-01T00:01:00.000Z',
              endedAt: '2026-01-01T00:01:05.000Z',
            ),
          ],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: 'turn-1-final',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              requestId: 'req_turn_1',
              streamKey: 'thr_view:planner',
              text: '第一轮回复。',
              at: '2026-01-01T00:00:03.000Z',
            ),
            ThreadRunProjectionTimelineItem(
              id: 'turn-2-user',
              sequence: 2,
              eventType: 'thread.status',
              scope: 'main',
              role: 'user',
              text: '继续帮我查一下。',
              at: '2026-01-01T00:00:59.000Z',
              metadata: const {'liveType': 'thread.user_prompt'},
            ),
            ThreadRunProjectionTimelineItem(
              id: 'turn-2-final',
              sequence: 3,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              requestId: 'req_turn_2',
              streamKey: 'thr_view:planner',
              text: '第二轮回复。',
              at: '2026-01-01T00:01:05.000Z',
            ),
          ],
        ),
      );

      final assistantTexts = feed
          .where((entry) => entry.kind == ActivityFeedKind.assistant)
          .map((entry) => entry.text)
          .toList();
      expect(assistantTexts, ['第一轮回复。', '第二轮回复。']);
    },
  );

  test('buildActivityFeed keeps early turns after many thinking deltas', () {
    final deltas = List<ThreadRunProjectionTimelineItem>.generate(
      100,
      (index) => ThreadRunProjectionTimelineItem(
        id: 'thinking-delta-$index',
        sequence: index + 1,
        eventType: 'thinking.delta',
        scope: 'main',
        role: 'thinking',
        requestId: 'req_long',
        streamKey: 'thr_test:thinking',
        text: 'x' * (index + 1),
        at: '2026-01-01T00:00:${(index + 1).toString().padLeft(2, '0')}.000Z',
      ),
    );
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'idle',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: deltas.length + 2,
        agents: const [],
        requestSpans: const [
          ThreadRunProjectionRequestSpan(
            requestId: 'req_long',
            status: 'completed',
            startedAt: '2026-01-01T00:00:01.000Z',
            endedAt: '2026-01-01T00:02:00.000Z',
          ),
          ThreadRunProjectionRequestSpan(
            requestId: 'req_turn_2',
            status: 'completed',
            startedAt: '2026-01-01T00:03:00.000Z',
            endedAt: '2026-01-01T00:03:05.000Z',
          ),
        ],
        timeline: [
          ...deltas,
          ThreadRunProjectionTimelineItem(
            id: 'turn-1-final',
            sequence: 101,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            requestId: 'req_long',
            streamKey: 'thr_test:planner',
            text: '第一轮回复。',
            at: '2026-01-01T00:02:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-2-final',
            sequence: 102,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            requestId: 'req_turn_2',
            streamKey: 'thr_test:planner',
            text: '第二轮回复。',
            at: '2026-01-01T00:03:05.000Z',
          ),
        ],
      ),
    );

    final assistantTexts = feed
        .where((entry) => entry.kind == ActivityFeedKind.assistant)
        .map((entry) => entry.text)
        .toList();
    expect(assistantTexts, ['第一轮回复。', '第二轮回复。']);
  });

  test(
    'buildActivityFeed keeps separate SDK text blocks in one completed request',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'idle',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 2,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_planner',
              status: 'completed',
              startedAt: '2026-01-01T00:00:01.000Z',
              endedAt: '2026-01-01T00:00:04.000Z',
            ),
          ],
          timeline: const [
            ThreadRunProjectionTimelineItem(
              id: 'text-block-0',
              sequence: 1,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              requestId: 'req_planner',
              streamKey: 'thr_view:planner:block:text:0',
              text: '第一句正文。',
              at: '2026-01-01T00:00:02.000Z',
            ),
            ThreadRunProjectionTimelineItem(
              id: 'text-block-2',
              sequence: 2,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              requestId: 'req_planner',
              streamKey: 'thr_view:planner:block:text:2',
              text: '第二句正文。',
              at: '2026-01-01T00:00:04.000Z',
            ),
          ],
        ),
      );

      final assistantTexts = feed
          .where((entry) => entry.kind == ActivityFeedKind.assistant)
          .map((entry) => entry.text)
          .toList();
      expect(assistantTexts, ['第一句正文。', '第二句正文。']);
    },
  );

  test('buildActivityFeed keeps SDK block streams from separate turns', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'idle',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 10,
        agents: const [],
        requestSpans: const [
          ThreadRunProjectionRequestSpan(
            requestId: 'req_turn_1',
            status: 'completed',
            startedAt: '2026-01-01T00:00:01.000Z',
            endedAt: '2026-01-01T00:00:05.000Z',
            role: 'planner',
          ),
          ThreadRunProjectionRequestSpan(
            requestId: 'req_turn_2',
            status: 'completed',
            startedAt: '2026-01-01T00:01:01.000Z',
            endedAt: '2026-01-01T00:01:05.000Z',
            role: 'planner',
          ),
        ],
        timeline: const [
          ThreadRunProjectionTimelineItem(
            id: 'turn-1-user',
            sequence: 1,
            eventType: 'thread.status',
            scope: 'main',
            role: 'user',
            text: '第一轮。',
            at: '2026-01-01T00:00:00.000Z',
            metadata: {'liveType': 'thread.user_prompt'},
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-1-request',
            sequence: 2,
            eventType: 'request.started',
            scope: 'main',
            role: 'planner',
            requestId: 'req_turn_1',
            text: '',
            at: '2026-01-01T00:00:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-1-thinking',
            sequence: 3,
            eventType: 'thinking.final',
            scope: 'main',
            role: 'thinking',
            requestId: 'req_turn_1',
            streamKey: 'thr_view:thinking:block:thinking:0',
            text: '第一轮思考。',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-1-message',
            sequence: 4,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            streamKey: 'thr_view:planner:block:text:1',
            text: '第一轮回复。',
            at: '2026-01-01T00:00:04.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-2-user',
            sequence: 5,
            eventType: 'thread.status',
            scope: 'main',
            role: 'user',
            text: '第二轮。',
            at: '2026-01-01T00:01:00.000Z',
            metadata: {'liveType': 'thread.user_prompt'},
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-2-request',
            sequence: 6,
            eventType: 'request.started',
            scope: 'main',
            role: 'planner',
            requestId: 'req_turn_2',
            text: '',
            at: '2026-01-01T00:01:01.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-2-thinking',
            sequence: 7,
            eventType: 'thinking.final',
            scope: 'main',
            role: 'thinking',
            requestId: 'req_turn_2',
            streamKey: 'thr_view:thinking:block:thinking:0',
            text: '第二轮思考。',
            at: '2026-01-01T00:01:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'turn-2-message',
            sequence: 8,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            streamKey: 'thr_view:planner:block:text:1',
            text: '第二轮回复。',
            at: '2026-01-01T00:01:04.000Z',
          ),
        ],
      ),
    );

    expect(feed.map((entry) => entry.id).toList(), [
      'turn-1-user',
      'main:stream:thinking:sk:thr_view:thinking:block:thinking:0:req:req_turn_1',
      'main:stream:message:sk:thr_view:planner:block:text:1:req:req_turn_1',
      'turn-2-user',
      'main:stream:thinking:sk:thr_view:thinking:block:thinking:0:req:req_turn_2',
      'main:stream:message:sk:thr_view:planner:block:text:1:req:req_turn_2',
    ]);
    final assistantTexts = feed
        .where((entry) => entry.kind == ActivityFeedKind.assistant)
        .map((entry) => entry.text)
        .toList();
    expect(assistantTexts, ['第一轮回复。', '第二轮回复。']);
  });

  test('buildActivityFeed hides duplicate final echoes for SDK block rows', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'idle',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 4,
        agents: const [],
        requestSpans: const [
          ThreadRunProjectionRequestSpan(
            requestId: 'req_planner',
            status: 'completed',
            startedAt: '2026-01-01T00:00:01.000Z',
            endedAt: '2026-01-01T00:00:04.000Z',
          ),
        ],
        timeline: const [
          ThreadRunProjectionTimelineItem(
            id: 'thinking-legacy-final',
            sequence: 1,
            eventType: 'thinking.final',
            scope: 'main',
            role: 'thinking',
            requestId: 'req_planner',
            streamKey: 'thr_view:thinking',
            text: '旧思考。',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'thinking-block-final',
            sequence: 2,
            eventType: 'thinking.final',
            scope: 'main',
            role: 'thinking',
            streamKey: 'thr_view:thinking:block:thinking:0',
            text: '旧思考。',
            at: '2026-01-01T00:00:02.001Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'message-legacy-final',
            sequence: 3,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            requestId: 'req_planner',
            streamKey: 'thr_view:planner',
            text: '最终回复。',
            at: '2026-01-01T00:00:04.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'message-block-final',
            sequence: 4,
            eventType: 'message.final',
            scope: 'main',
            role: 'planner',
            streamKey: 'thr_view:planner:block:text:1',
            text: '最终回复。',
            at: '2026-01-01T00:00:04.001Z',
          ),
        ],
      ),
    );

    expect(feed.map((entry) => entry.id).toList(), [
      'main:stream:thinking:sk:thr_view:thinking:block:thinking:0:req:req_planner',
      'main:stream:message:sk:thr_view:planner:block:text:1:req:req_planner',
    ]);
    expect(feed.map((entry) => entry.text).toList(), ['旧思考。', '最终回复。']);
  });

  test(
    'buildActivityFeed keeps settled stream delta while hiding assistant final echo',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'idle',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 2,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_planner',
              status: 'completed',
              startedAt: '2026-01-01T00:00:01.000Z',
              endedAt: '2026-01-01T00:00:03.000Z',
            ),
          ],
          timeline: const [
            ThreadRunProjectionTimelineItem(
              id: 'thinking-block-delta',
              sequence: 1,
              eventType: 'thinking.delta',
              scope: 'main',
              role: 'thinking',
              requestId: 'req_planner',
              streamKey: 'thr_view:thinking:block:thinking:0',
              text: '已流式输出的思考。',
              at: '2026-01-01T00:00:02.000Z',
            ),
            ThreadRunProjectionTimelineItem(
              id: 'thinking-assistant-final',
              sequence: 2,
              eventType: 'thinking.final',
              scope: 'main',
              role: 'thinking',
              streamKey: 'thr_view:thinking:block:thinking:0',
              text: '已流式输出的思考。',
              at: '2026-01-01T00:00:02.001Z',
            ),
          ],
        ),
      );

      expect(feed.length, 1);
      expect(
        feed.first.id,
        'main:stream:thinking:sk:thr_view:thinking:block:thinking:0:req:req_planner',
      );
      expect(feed.first.kind, ActivityFeedKind.thinking);
      expect(feed.first.text, '已流式输出的思考。');
      expect(feed.first.streaming, isFalse);
    },
  );

  test(
    'buildActivityFeed keeps settled message delta while hiding assistant final echo',
    () {
      final feed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'idle',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 2,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_planner',
              status: 'completed',
              startedAt: '2026-01-01T00:00:01.000Z',
              endedAt: '2026-01-01T00:00:03.000Z',
              role: 'planner',
            ),
          ],
          timeline: const [
            ThreadRunProjectionTimelineItem(
              id: 'message-block-delta',
              sequence: 1,
              eventType: 'message.delta',
              scope: 'main',
              role: 'planner',
              requestId: 'req_planner',
              streamKey: 'thr_view:planner:block:text:1',
              text: '已流式输出的正文。',
              at: '2026-01-01T00:00:02.000Z',
            ),
            ThreadRunProjectionTimelineItem(
              id: 'message-assistant-final',
              sequence: 2,
              eventType: 'message.final',
              scope: 'main',
              role: 'planner',
              streamKey: 'thr_view:planner:block:text:1',
              text: '已流式输出的正文。',
              at: '2026-01-01T00:00:02.001Z',
            ),
          ],
        ),
      );

      expect(feed.length, 1);
      expect(
        feed.first.id,
        'main:stream:message:sk:thr_view:planner:block:text:1:req:req_planner',
      );
      expect(feed.first.kind, ActivityFeedKind.assistant);
      expect(feed.first.text, '已流式输出的正文。');
      expect(feed.first.streaming, isFalse);
    },
  );

  test('buildActivityFeed appends incremental message stream batches', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
      runProjection: const ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 2,
        agents: [],
        requestSpans: [
          ThreadRunProjectionRequestSpan(
            requestId: 'req_stream',
            status: 'streaming',
            startedAt: '2026-01-01T00:00:01.000Z',
          ),
        ],
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'message-batch-1',
            sequence: 1,
            eventType: 'message.delta',
            scope: 'main',
            role: 'planner',
            requestId: 'req_stream',
            streamKey: 'thr_test:planner:block:text:1',
            text: '第一批内容，',
            at: '2026-01-01T00:00:02.000Z',
          ),
          ThreadRunProjectionTimelineItem(
            id: 'message-batch-2',
            sequence: 2,
            eventType: 'message.delta',
            scope: 'main',
            role: 'planner',
            requestId: 'req_stream',
            streamKey: 'thr_test:planner:block:text:1',
            text: '第二批内容。',
            at: '2026-01-01T00:00:03.000Z',
          ),
        ],
      ),
    );

    expect(feed, hasLength(1));
    expect(feed.single.text, '第一批内容，第二批内容。');
    expect(feed.single.streaming, isTrue);
  });

  testWidgets(
    'ActivityFeedList keeps rendered text while appending the next projection batch',
    (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      ThreadRunProjectionSnapshot projection(
        String id,
        String text,
        int eventCount,
      ) {
        return ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:0$eventCount.000Z',
          sourceEventCount: eventCount,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_stream',
              status: 'streaming',
              startedAt: '2026-01-01T00:00:01.000Z',
            ),
          ],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: id,
              sequence: eventCount,
              eventType: 'message.delta',
              scope: 'main',
              role: 'planner',
              requestId: 'req_stream',
              streamKey: 'thr_test:planner:block:text:1',
              text: text,
              at: '2026-01-01T00:00:02.000Z',
            ),
          ],
        );
      }

      Widget app(ThreadRunProjectionSnapshot snapshot) {
        final entries = buildActivityFeed(
          threadPrompt: '',
          threadId: 't1',
          runProjection: snapshot,
        );
        return MaterialApp(
          theme: buildEcoDarkTheme(),
          home: Scaffold(
            body: ActivityFeedList(
              entries: entries,
              scrollController: controller,
              shrinkWrap: true,
            ),
          ),
        );
      }

      var current = projection('message-batch-1', '第一批内容，', 1);
      await tester.pumpWidget(app(current));
      for (var index = 0; index < 10; index++) {
        await tester.pump(pacedStreamInterval);
      }
      expect(find.text('第一批内容，'), findsOneWidget);

      current = mergeThreadRunProjectionSnapshots(
        current,
        projection('message-batch-2', '第二批内容。', 2),
      );
      await tester.pumpWidget(app(current));
      expect(find.text('第一批内容，'), findsOneWidget);

      for (var index = 0; index < 10; index++) {
        await tester.pump(pacedStreamInterval);
      }
      expect(find.text('第一批内容，第二批内容。'), findsOneWidget);
    },
  );

  test(
    'buildActivityFeed keeps stable ids while streaming thinking advances',
    () {
      ThreadRunProjectionSnapshot projectionForDelta(String id, String text) {
        return ThreadRunProjectionSnapshot(
          threadId: 't1',
          status: 'running',
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceEventCount: 1,
          agents: const [],
          requestSpans: const [
            ThreadRunProjectionRequestSpan(
              requestId: 'req_stream',
              status: 'streaming',
              startedAt: '2026-01-01T00:00:01.000Z',
            ),
          ],
          timeline: [
            ThreadRunProjectionTimelineItem(
              id: id,
              sequence: 1,
              eventType: 'thinking.delta',
              scope: 'main',
              role: 'thinking',
              requestId: 'req_stream',
              streamKey: 'thr_test:thinking',
              text: text,
              at: '2026-01-01T00:00:02.000Z',
            ),
          ],
        );
      }

      final firstFeed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: projectionForDelta('delta-1', '第一段思考'),
      );
      final secondFeed = buildActivityFeed(
        threadPrompt: '',
        threadId: 't1',
        runProjection: projectionForDelta('delta-2', '第一段思考扩展'),
      );

      expect(firstFeed.length, 1);
      expect(secondFeed.length, 1);
      expect(firstFeed.first.id, secondFeed.first.id);
      expect(secondFeed.first.text, '第一段思考扩展');
    },
  );

  test('shouldAutoScrollActivityFeed ignores bash action insertions', () {
    const previous = [
      ActivityFeedEntry(
        id: 'user-1',
        kind: ActivityFeedKind.user,
        text: '帮我跑测试',
      ),
      ActivityFeedEntry(
        id: 'thinking-1',
        kind: ActivityFeedKind.thinking,
        text: '思考中',
        streaming: true,
      ),
    ];
    final next = [
      previous[0],
      const ActivityFeedEntry(
        id: 'bash-1',
        kind: ActivityFeedKind.action,
        text: 'Run tests',
      ),
      previous[1],
    ];

    expect(
      shouldAutoScrollActivityFeed(previous: previous, next: next),
      isFalse,
    );
    expect(
      listMiddleInsertedFeedEntries(previous: previous, next: next).single.id,
      'bash-1',
    );
  });

  test('shouldFollowStreamingTail only tracks assistant and thinking', () {
    const previous = [
      ActivityFeedEntry(
        id: 'assistant-1',
        kind: ActivityFeedKind.assistant,
        text: 'hello',
        streaming: true,
      ),
    ];
    final next = [
      const ActivityFeedEntry(
        id: 'assistant-1',
        kind: ActivityFeedKind.assistant,
        text: 'hello world',
        streaming: true,
      ),
    ];

    expect(shouldFollowStreamingTail(previous: previous, next: next), isTrue);
  });
}
