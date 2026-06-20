import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
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
}
