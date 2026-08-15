import 'package:eco_mobile/core/models/acp_host_ui_features.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fromJson missing object is all show', () {
    expect(AcpHostUiFeatures.fromJson(null).showContextUsage, isTrue);
    expect(AcpHostUiFeatures.fromJson(null).showBilling, isTrue);
  });

  test('fromJson keeps valid hide and falls dirty columns back to show', () {
    final features = AcpHostUiFeatures.fromJson({
      'contextUsage': 'hide',
      'billing': 'nope',
    });
    expect(features.showContextUsage, isFalse);
    expect(features.showBilling, isTrue);
  });

  test('ThreadSummary.fromJson reads hostUiFeatures', () {
    final thread = ThreadSummary.fromJson({
      'id': 'thr_1',
      'title': 't',
      'prompt': 'p',
      'workspacePath': '/tmp',
      'status': 'idle',
      'createdAt': '',
      'updatedAt': '',
      'message': '',
      'coreKind': 'acp',
      'hostUiFeatures': {'contextUsage': 'hide', 'billing': 'hide'},
    });
    expect(thread.hostUiFeatures.showContextUsage, isFalse);
    expect(thread.hostUiFeatures.showBilling, isFalse);
  });
}
