import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/core/utils/agent_mission.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
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
        ),
        ActivityItem(
          id: '4',
          role: 'coder',
          message: 'Tool: Grep · token',
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
  });

  test('bash approval merges into the same action row', () {
    final feed = buildActivityFeed(
      lines: const [
        ActivityItem(
          id: '1',
          role: 'planner',
          message: '等待确认 Bash：npm test',
        ),
        ActivityItem(
          id: '2',
          role: 'planner',
          message: 'Running npm test · Bash',
        ),
      ],
      threadPrompt: '',
      threadId: 't1',
    );

    final actions =
        feed.where((entry) => entry.kind == ActivityFeedKind.action).toList();
    expect(actions.length, 1);
    expect(actions.first.text, 'npm test');
  });
}
