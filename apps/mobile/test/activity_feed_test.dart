import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/core/utils/agent_mission.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
import 'package:eco_mobile/core/theme/eco_theme.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';
import 'package:eco_mobile/core/utils/subagent_projection_feed.dart';
import 'package:eco_mobile/features/threads/activity_feed.dart';

void main() {
  test('configuredOrchestrationSubagentRoles hides unconfigured roles', () {
    const profile = OrchestrationProfile(
      id: 'p1',
      name: 'Test',
      agents: [
        OrchestrationAgentInstance(agentKey: 'coder', enabled: true),
      ],
    );

    expect(
      configuredOrchestrationSubagentRoles(profile),
      ['explore', 'coder'],
    );
  });

  test('buildActivityFeed returns empty without projection', () {
    final feed = buildActivityFeed(
      threadPrompt: '',
      threadId: 't1',
    );
    expect(feed, isEmpty);
  });

  test('parseToolActionDisplayLabel normalizes tool lines', () {
    expect(
      parseToolActionDisplayLabel('Tool: Read · lib/main.dart'),
      'lib/main.dart',
    );
    expect(
      isUsageNoiseMessage('Usage recorded'),
      isTrue,
    );
  });

  test('subagentMissionBorderColor uses unknown blue for non-standard roles', () {
    expect(
      resolveSubagentThemeColor('researcher'),
      subagentUnknownThemeColor,
    );
  });

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

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.bashRun?.title, 'Run unit tests');
  });

  test('buildActivityFeed merges bash approval lifecycle into one completed card', () {
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

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.lifecycle, ToolActionLifecycle.completed);
    expect(actions.first.bashRun?.body, '36 pass');
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.assistant &&
            (entry.text.contains('等待确认') ||
                entry.text.contains('已允许本次')),
      ),
      isFalse,
    );
  });

  test('buildActivityFeed keeps bash approval out of assistant body after approval', () {
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

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
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
    expect(
      feed.any((entry) => entry.kind == ActivityFeedKind.action),
      isFalse,
    );
  });

  test('isSubagentMissionEnvelope matches legacy and structured mission lines', () {
    expect(isSubagentMissionEnvelope('@mission explore: scan src'), isTrue);
    expect(
      isSubagentMissionEnvelope(
        '@mission {"role":"explore","summary":"scan","prompt":"scan src"}',
      ),
      isTrue,
    );
    expect(isSubagentMissionEnvelope('Plain task prompt'), isFalse);
  });

  test('buildActivityFeed does not echo attributed @mission in main feed', () {
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
      feed.where((entry) => entry.kind == ActivityFeedKind.subagentMission).length,
      1,
    );
    expect(
      feed.any((entry) => entry.text.contains('@mission')),
      isFalse,
    );
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.assistant &&
            entry.text == 'Checking CPU topology.',
      ),
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

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.bashRun?.title, 'Run unit tests');
  });

  test('buildActivityFeed injects cards for concurrent projection subagents', () {
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
    expect(
      missions.map((entry) => entry.agentId).toSet(),
      {'agent_explore_1', 'agent_coder_1'},
    );
    final exploreIndex = feed.indexWhere(
      (entry) => entry.agentId == 'agent_explore_1',
    );
    final plannerIndex = feed.indexWhere(
      (entry) => entry.kind == ActivityFeedKind.assistant,
    );
    expect(exploreIndex, lessThan(plannerIndex));
  });

  test('buildActivityFeed keeps subagent mission before later assistant text', () {
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
  });

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

    final reconnectEntries =
        feed.where((entry) => entry.reconnecting).toList(growable: false);
    expect(reconnectEntries, hasLength(1));
    expect(reconnectEntries.first.text, '重连 2/5');
    expect(reconnectEntries.first.detail, isNull);
  });

  test('buildActivityFeed treats recorded user prompts as right-aligned user bubbles', () {
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

    final userEntries =
        feed.where((entry) => entry.kind == ActivityFeedKind.user).toList();
    expect(userEntries, hasLength(1));
    expect(userEntries.first.text, '请继续实现登录页');
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.phase &&
            entry.text == '请继续实现登录页',
      ),
      isFalse,
    );
  });

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

  test('buildActivityFeed renders clarification answers as right-aligned cards', () {
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
  });

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

  test('resolveSubagentCardMissionText falls back to main timeline @mission by parentToolUseId', () {
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
  });

  test('resolveSubagentCardMissionText falls back to agent.started timeline metadata', () {
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
  });

  test('buildActivityFeed shows subagent mission from parentToolUseId fallback', () {
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
  });
}
