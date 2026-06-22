import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/core/utils/thread_usage_display.dart';

void main() {
  test('formatCostUsd formats small and large values', () {
    expect(formatCostUsd(0), '\$0');
    expect(formatCostUsd(0.0042), '\$0.0042');
    expect(formatCostUsd(1.23), '\$1.23');
  });

  test('resolvePlannerOccupancyPct prefers planner role', () {
    final context = ThreadContextSnapshot.fromJson({
      'occupied': 1000,
      'limit': 200000,
      'occupancyPct': 1,
      'limitsResolved': true,
      'roles': [
        {
          'role': 'planner',
          'occupied': 120000,
          'limit': 200000,
          'occupancyPct': 60,
          'limitsResolved': true,
          'segments': [],
        },
      ],
    });

    expect(resolvePlannerOccupancyPct(context), 60);
  });

  test('roleDisplayLabel uses Main Agent for planner', () {
    expect(roleDisplayLabel('planner'), 'Main Agent');
    expect(roleDisplayLabel('explore'), '探索');
  });

  test('buildFlatSubagentContextRows prefers instances over role aggregates', () {
    final context = ThreadContextSnapshot.fromJson({
      'occupied': 1000,
      'limit': 200000,
      'occupancyPct': 1,
      'limitsResolved': true,
      'roles': [
        {
          'role': 'coder',
          'occupied': 5000,
          'limit': 200000,
          'occupancyPct': 3,
          'limitsResolved': true,
          'segments': [],
        },
      ],
      'instances': [
        {
          'agentId': 'agent_coder_1',
          'role': 'coder',
          'occupied': 12000,
          'limit': 200000,
          'occupancyPct': 6,
          'limitsResolved': true,
          'segments': [],
        },
      ],
    });

    final rows = buildFlatSubagentContextRows(context);
    expect(rows, hasLength(1));
    expect(rows.first.key, 'agent_coder_1');
    expect(rows.first.title, contains('编码'));
  });

  test('ThreadUsageSnapshotResult parses billing byModel and context instances', () {
    final result = ThreadUsageSnapshotResult.fromJson({
      'billing': {
        'plannerTokenCostUsd': 0.12,
        'ecoCostUsd': 0.05,
        'savedUsd': 0.07,
        'savedPct': 58,
        'pricingResolved': true,
        'totalTokens': {'input': 100, 'output': 20},
        'byModel': [
          {
            'modelId': 'anthropic/claude-sonnet-4',
            'roles': ['planner', 'coder'],
            'inputTokens': 80,
            'outputTokens': 20,
            'cacheReadTokens': 0,
            'cacheCreationTokens': 0,
            'ecoCostUsd': 0.04,
          },
        ],
      },
      'context': {
        'occupied': 1000,
        'limit': 200000,
        'occupancyPct': 1,
        'limitsResolved': true,
        'segments': [],
        'instances': [
          {
            'agentId': 'agent_explore_1',
            'role': 'explore',
            'occupied': 8000,
            'limit': 200000,
            'occupancyPct': 4,
            'limitsResolved': true,
            'segments': [],
          },
        ],
      },
    });

    expect(result.billing?.ecoCostUsd, 0.05);
    expect(result.billing?.byModel, hasLength(1));
    expect(result.billing?.byModel.first.ecoCostUsd, 0.04);
    expect(result.context?.instances, hasLength(1));
  });
}
