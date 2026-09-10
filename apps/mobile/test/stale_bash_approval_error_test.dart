import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('stale bash approval errors are discardable after a cross-device race', () {
    expect(
      isStalePendingBashApprovalError(
        EcoCenterException.native('No pending Bash approval for this tool use.'),
      ),
      isTrue,
    );
    expect(
      isStalePendingBashApprovalError(
        EcoCenterException.native('找不到待处理的审批请求。'),
      ),
      isTrue,
    );
    expect(
      isStalePendingBashApprovalError(
        EcoCenterException.native('Wait for the current run to finish.'),
      ),
      isFalse,
    );
  });
}
