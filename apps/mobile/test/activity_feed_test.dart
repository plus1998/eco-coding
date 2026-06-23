import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/core/utils/agent_mission.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';
import 'package:eco_mobile/features/threads/activity_feed.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';

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

  test('buildActivityFeed filters tool noise and keeps user narrative', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '修复登录 bug'),
        ActivityItem(
          id: '2',
          role: 'planner',
          message: '我先检查 auth 模块。',
        ),
        ActivityItem(
          id: '3',
          role: 'planner',
          message: 'Tool: Read · lib/auth.dart',
          tool: ThreadRunToolMetadata(
            name: 'Read',
            detail: 'lib/auth.dart',
            toolUseId: 'toolu_read_1',
          ),
        ),
        ActivityItem(
          id: '4',
          role: 'coder',
          message: 'Tool: Grep · token',
          tool: ThreadRunToolMetadata(
            name: 'Grep',
            detail: 'token',
            toolUseId: 'toolu_grep_1',
          ),
        ),
        ActivityItem(
          id: '5',
          role: 'planner',
          message: 'Usage recorded',
        ),
      ],
      threadPrompt: '',
      threadId: 't1',
    );

    expect(feed.any((entry) => entry.kind == ActivityFeedKind.user), isTrue);
    expect(feed.any((entry) => entry.kind == ActivityFeedKind.assistant), isTrue);
    expect(
      feed.any(
        (entry) =>
            entry.kind == ActivityFeedKind.action &&
            entry.text.contains('auth.dart'),
      ),
      isTrue,
    );
    expect(feed.any((entry) => entry.text.contains('Usage recorded')), isFalse);
    expect(
      feed.any(
        (entry) => entry.kind == ActivityFeedKind.action && entry.text == 'token',
      ),
      isFalse,
    );
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

  test('filters internal status and internal agent roles', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'system', message: '标题已更新'),
        ActivityItem(id: '2', role: 'system', message: '运行投影已更新'),
        ActivityItem(
          id: '3',
          role: 'generate_session_title',
          message: 'Rename thread to mobile polish',
        ),
        ActivityItem(id: '4', role: 'planner', message: '↑12k ↓340'),
        ActivityItem(id: '5', role: 'planner', message: '这是 **Markdown** 回复'),
      ],
      threadPrompt: '',
      threadId: 't1',
    );

    expect(feed.any((e) => e.text.contains('标题')), isFalse);
    expect(feed.any((e) => e.text.contains('运行投影')), isFalse);
    expect(feed.any((e) => e.kind == ActivityFeedKind.subagentMission), isFalse);
    expect(
      feed.any((e) => e.text.contains('Rename thread')),
      isFalse,
    );
    final assistant = feed.where((e) => e.kind == ActivityFeedKind.assistant);
    expect(assistant.length, 1);
    expect(assistant.first.text, contains('Markdown'));
    expect(assistant.first.usageBadge, '↑12k ↓340');
  });

  test('only standard subagent roles get mission cards', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'coder',
          message: 'Review authentication module for edge cases',
        ),
        ActivityItem(
          id: '2',
          role: 'sdk',
          message: 'Internal sdk helper should not become a card',
        ),
      ],
      threadPrompt: '',
      threadId: 't1',
    );

    expect(feed.where((e) => e.kind == ActivityFeedKind.subagentMission).length, 1);
    expect(feed.first.subagentRole, 'coder');
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

    final feed = buildActivityFeed(
      lines: [
        ActivityItem(id: '1', role: 'explore', message: payload),
      ],
      threadPrompt: '',
      threadId: 't1',
    );
    expect(feed.length, 1);
    expect(feed.first.kind, ActivityFeedKind.subagentMission);
    expect(feed.first.text, '梳理 auth 模块');
    expect(feed.first.missionPrompt, 'check auth flow');
  });

  test('buildActivityFeed renders bash approval from history text without tool metadata', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '下载模型'),
        ActivityItem(
          id: '2',
          role: 'tool',
          message: '等待确认 Bash：npm test',
        ),
        ActivityItem(
          id: '3',
          role: 'tool',
          message: '已允许本次 Bash：npm test',
        ),
      ],
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
      lines: const [
        ActivityItem(
          id: '1',
          role: 'tool',
          message: '已允许本次 Bash：npm test',
          agentId: 'agent_coder_1',
          tool: ThreadRunToolMetadata(
            name: 'Bash',
            detail: 'npm test',
            toolUseId: 'toolu_bash_1',
            description: 'Run unit tests',
            status: 'running',
          ),
        ),
      ],
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
  });

  test('subagent mission card gets duration and timeline from projection', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '实现登录'),
      ],
      threadPrompt: '',
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

  test('buildActivityFeed keeps thinking blocks before assistant reply', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '分析登录流程'),
        ActivityItem(
          id: '2',
          role: 'thinking',
          message: '先梳理 auth ',
          stream: true,
        ),
        ActivityItem(
          id: '3',
          role: 'thinking',
          message: '先梳理 auth 模块入口',
          stream: false,
        ),
        ActivityItem(
          id: '4',
          role: 'planner',
          message: '登录流程如下…',
        ),
      ],
    );

    final thinkingIndex = feed.indexWhere(
      (entry) => entry.kind == ActivityFeedKind.thinking,
    );
    expect(thinkingIndex, greaterThanOrEqualTo(0));
    expect(feed[thinkingIndex].text, contains('auth'));
    expect(
      feed.indexWhere((entry) => entry.kind == ActivityFeedKind.assistant),
      greaterThan(thinkingIndex),
    );
  });

  test('buildActivityFeed emits streaming thinking placeholder at end', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(id: '1', role: 'user', message: 'hello'),
        ActivityItem(
          id: '2',
          role: 'thinking',
          message: '',
          stream: true,
        ),
      ],
    );

    expect(feed.last.kind, ActivityFeedKind.thinking);
    expect(feed.last.streaming, isTrue);
    expect(feed.last.text, isEmpty);
  });

  test('buildActivityFeed keeps separate generic web searches by toolUseId', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: 'Tool: WebSearch',
          tool: ThreadRunToolMetadata(
            name: 'WebSearch',
            toolUseId: 'toolu_search_1',
          ),
        ),
        ActivityItem(
          id: '2',
          role: 'planner',
          message: 'Tool: WebSearch (2.1s)',
          tool: ThreadRunToolMetadata(
            name: 'WebSearch',
            toolUseId: 'toolu_search_1',
            status: 'completed',
            durationMs: 2100,
          ),
        ),
        ActivityItem(
          id: '3',
          role: 'planner',
          message: 'Tool: WebSearch',
          tool: ThreadRunToolMetadata(
            name: 'WebSearch',
            toolUseId: 'toolu_search_2',
          ),
        ),
      ],
    );

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 2);
  });

  test('buildActivityFeed preserves web search query on completion', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: 'Tool: WebSearch · flutter keyboard dismiss',
          tool: ThreadRunToolMetadata(
            name: 'WebSearch',
            detail: 'flutter keyboard dismiss',
            toolUseId: 'toolu_search_1',
          ),
        ),
        ActivityItem(
          id: '2',
          role: 'planner',
          message: 'Tool: WebSearch (1.2s)',
          tool: ThreadRunToolMetadata(
            name: 'WebSearch',
            detail: 'flutter keyboard dismiss',
            toolUseId: 'toolu_search_1',
            status: 'completed',
            durationMs: 1200,
          ),
        ),
      ],
    );

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.text, 'flutter keyboard dismiss');
  });

  test('buildActivityFeed renders bash tool actions as cards', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: 'Tool: Bash · npm test',
          tool: ThreadRunToolMetadata(
            name: 'Bash',
            detail: 'npm test',
            toolUseId: 'toolu_bash_1',
          ),
        ),
      ],
    );

    expect(feed.length, 1);
    expect(feed.first.kind, ActivityFeedKind.action);
    expect(feed.first.bashRun, isNotNull);
    expect(feed.first.bashRun!.title, 'npm test');
    expect(feed.first.bashRun!.body, 'npm test');
  });

  test('buildActivityFeed prefers structured tool description on live activity', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: 'Tool: Bash · npm test',
          tool: ThreadRunToolMetadata(
            name: 'Bash',
            detail: 'npm test',
            toolUseId: 'toolu_bash_1',
            description: 'Run unit tests',
          ),
        ),
      ],
    );

    expect(feed.first.bashRun?.title, 'Run unit tests');
  });

  test('buildActivityFeed renders bash action cards from history text', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: 'Tool: Bash · npm test',
        ),
      ],
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
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '并发子代理'),
        ActivityItem(
          id: '2',
          role: 'planner',
          message: '主代理先说明计划。',
        ),
      ],
      runProjection: ThreadRunProjectionSnapshot(
        threadId: 't1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceEventCount: 2,
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
      lines: const [
        ActivityItem(id: '1', role: 'user', message: '修复登录'),
        ActivityItem(
          id: '2',
          role: 'coder',
          message:
              '@mission {"role":"coder","summary":"实现登录","prompt":"add login"}',
        ),
        ActivityItem(
          id: '3',
          role: 'planner',
          message: '子代理完成后我继续总结。',
        ),
      ],
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
}
