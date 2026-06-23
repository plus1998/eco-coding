import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/core/utils/agent_mission.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';
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

  test('buildActivityFeed renders bash approval from projection metadata', () {
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
        ],
      ),
    );

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.text, 'Run unit tests');
    expect(actions.first.toolUseId, 'toolu_bash_1');
    expect(actions.first.bashRun?.title, 'Run unit tests');
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.assistant &&
            entry.text.contains('等待确认'),
      ),
      isFalse,
    );
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
            eventType: 'thread.user_prompt',
            scope: 'main',
            text: '并发子代理',
            at: '2026-01-01T00:00:00.000Z',
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
            'eventType': 'thread.user_prompt',
            'scope': 'main',
            'text': '修复登录',
            'at': '2026-01-01T00:00:00.000Z',
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
            text: '【自动重试 2/5】upstream error',
            at: '2026-01-01T00:00:00.001Z',
          ),
        ],
      ),
    );

    final reconnectEntries =
        feed.where((entry) => entry.reconnecting).toList(growable: false);
    expect(reconnectEntries, hasLength(1));
    expect(reconnectEntries.first.text, '重连 2/5');
    expect(reconnectEntries.first.detail, 'upstream error');
  });
}
