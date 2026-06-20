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

  test('ThreadUsageSnapshotResult parses billing and context', () {
    final result = ThreadUsageSnapshotResult.fromJson({
      'billing': {
        'plannerTokenCostUsd': 0.12,
        'ecoCostUsd': 0.05,
        'savedUsd': 0.07,
        'savedPct': 58,
        'pricingResolved': true,
        'totalTokens': {'input': 100, 'output': 20},
      },
      'context': {
        'occupied': 1000,
        'limit': 200000,
        'occupancyPct': 1,
        'limitsResolved': true,
        'segments': [],
      },
    });

    expect(result.billing?.ecoCostUsd, 0.05);
    expect(result.context?.occupied, 1000);
  });
}
