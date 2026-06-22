import 'package:eco_mobile/core/utils/center_server_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final cases = <String, CenterServerAuthRecovery>{
    'Refresh token is invalid or expired.': CenterServerAuthRecovery.relogin,
    'Device credentials are invalid.': CenterServerAuthRecovery.relogin,
    '登录已失效，请重新登录。': CenterServerAuthRecovery.relogin,
    'Device is not active.': CenterServerAuthRecovery.deviceInactive,
    'Token device is not active.': CenterServerAuthRecovery.deviceInactive,
    'Refresh token device is not active.': CenterServerAuthRecovery.deviceInactive,
    'Token user is not active.': CenterServerAuthRecovery.accountUnusable,
    'Refresh token subject is not active.': CenterServerAuthRecovery.accountUnusable,
    'Connection timed out.': CenterServerAuthRecovery.network,
    'Request failed with HTTP 503.': CenterServerAuthRecovery.network,
    'Something else': CenterServerAuthRecovery.unknown,
  };

  for (final entry in cases.entries) {
    test('classifyCenterServerAuthError: ${entry.key}', () {
      expect(classifyCenterServerAuthError(entry.key), entry.value);
    });
  }

  test('isCenterServerAuthCredentialError excludes network errors', () {
    expect(isCenterServerAuthCredentialError('Connection timed out.'), isFalse);
    expect(isCenterServerAuthCredentialError('Device is not active.'), isTrue);
  });
}
