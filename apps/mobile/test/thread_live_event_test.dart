import 'package:eco_mobile/core/utils/thread_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('threadStatusFromLiveEvent maps awaiting plan events', () {
    expect(
      threadStatusFromLiveEvent('thread.awaiting_plan', 'running'),
      'awaiting_plan',
    );
    expect(
      threadStatusFromLiveEvent('thread.execution_failed', 'running'),
      'awaiting_plan',
    );
    expect(
      threadStatusFromLiveEvent('thread.running', 'idle'),
      'running',
    );
  });

  test('resolveThreadMessageFromLiveEvent prefixes execution failures', () {
    expect(
      resolveThreadMessageFromLiveEvent('thread.execution_failed', '模型超时'),
      '执行失败，已回退更改。模型超时',
    );
    expect(
      extractPlanFailureMessage('执行失败，已回退更改。模型超时'),
      '模型超时',
    );
  });

  test('shouldUpdateThreadSummaryFromLiveEvent ignores telemetry events', () {
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.usage_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.runtime_config_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.run_projection_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.subagent_timing_updated'),
      isFalse,
    );
    expect(
      shouldUpdateThreadSummaryFromLiveEvent('thread.awaiting_plan'),
      isTrue,
    );
  });
}
