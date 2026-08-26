import 'package:eco_mobile/core/utils/center_server_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final cases = <String, CenterServerAuthRecovery>{
    'Refresh token is invalid or expired.': CenterServerAuthRecovery.relogin,
    'Invalid Refresh Token': CenterServerAuthRecovery.relogin,
    'refresh_token_not_found': CenterServerAuthRecovery.relogin,
    'Device credentials are invalid.': CenterServerAuthRecovery.relogin,
    '登录已失效，请重新登录。': CenterServerAuthRecovery.relogin,
    '连接配置不完整，请重新登录。': CenterServerAuthRecovery.relogin,
    'Device is not active.': CenterServerAuthRecovery.deviceInactive,
    'Token device is not active.': CenterServerAuthRecovery.deviceInactive,
    'Refresh token device is not active.':
        CenterServerAuthRecovery.deviceInactive,
    'Token user is not active.': CenterServerAuthRecovery.accountUnusable,
    'Refresh token subject is not active.':
        CenterServerAuthRecovery.accountUnusable,
    'Connection timed out.': CenterServerAuthRecovery.network,
    'Request failed with HTTP 503.': CenterServerAuthRecovery.network,
    'SocketException: Failed host lookup': CenterServerAuthRecovery.network,
    'ClientException: Connection closed': CenterServerAuthRecovery.network,
    'Something else': CenterServerAuthRecovery.unknown,
    // Bare Realtime/Edge wording must not force relogin.
    'Unauthorized': CenterServerAuthRecovery.unknown,
    'not authorized': CenterServerAuthRecovery.unknown,
  };

  for (final entry in cases.entries) {
    test('classifyCenterServerAuthError: ${entry.key}', () {
      expect(classifyCenterServerAuthError(entry.key), entry.value);
    });
  }

  test('isCenterServerAuthCredentialError excludes network errors', () {
    expect(isCenterServerAuthCredentialError('Connection timed out.'), isFalse);
    expect(isCenterServerAuthCredentialError('Device is not active.'), isTrue);
    expect(isCenterServerAuthCredentialError('Unauthorized'), isFalse);
  });

  test('recoveryForSessionRefreshFailure keeps session on transient failures', () {
    expect(
      recoveryForSessionRefreshFailure('SocketException: Failed host lookup'),
      CenterServerAuthRecovery.network,
    );
    expect(
      recoveryForSessionRefreshFailure('Connection timed out.'),
      CenterServerAuthRecovery.network,
    );
    expect(
      recoveryForSessionRefreshFailure('Unauthorized'),
      CenterServerAuthRecovery.network,
    );
    expect(
      recoveryForSessionRefreshFailure('Something ambiguous happened'),
      CenterServerAuthRecovery.network,
    );
    expect(
      recoveryForSessionRefreshFailure('Refresh token is invalid or expired.'),
      CenterServerAuthRecovery.relogin,
    );
    expect(
      recoveryForSessionRefreshFailure('Invalid Refresh Token'),
      CenterServerAuthRecovery.relogin,
    );
  });
}
