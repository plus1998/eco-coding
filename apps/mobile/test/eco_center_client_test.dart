import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('normalizeCenterServerHttpUrl', () {
    test('strips trailing slash', () {
      expect(
        normalizeCenterServerHttpUrl('http://127.0.0.1:3128/'),
        'http://127.0.0.1:3128',
      );
    });

    test('rejects unsupported scheme', () {
      expect(
        () => normalizeCenterServerHttpUrl('ftp://example.com'),
        throwsA(isA<EcoCenterException>()),
      );
    });
  });

  group('buildCenterServerWebSocketUrl', () {
    test('builds ws rpc url with token', () {
      final url = buildCenterServerWebSocketUrl(
        'http://192.168.1.2:3128',
        'token_abc',
      );
      expect(url, contains('ws://192.168.1.2:3128/v1/rpc'));
      expect(url, contains('access_token=token_abc'));
    });
  });

  group('tokenStillValid', () {
    test('returns false when expiring within 30s', () {
      final now = DateTime.parse('2030-01-01T00:00:00Z');
      expect(tokenStillValid('2030-01-01T00:00:20Z', now), isFalse);
    });

    test('returns true when more than 30s remain', () {
      final now = DateTime.parse('2030-01-01T00:00:00Z');
      expect(tokenStillValid('2030-01-01T00:01:00Z', now), isTrue);
    });
  });

  group('unwrapInvokeResult', () {
    test('unwraps desktop invoke envelope', () {
      final value = EcoCenterClient.unwrapInvokeResult<Map<String, dynamic>>({
        'channel': 'thread:list',
        'result': {'ok': true},
      });
      expect(value['ok'], isTrue);
    });

    test('returns raw result when not wrapped', () {
      expect(EcoCenterClient.unwrapInvokeResult<List<dynamic>>([1, 2]), [1, 2]);
    });
  });

  group('parsePairingQrPayload', () {
    test('parses full quick-join uri', () {
      final payload = parsePairingQrPayload(
        'eco://pair?server=http%3A%2F%2F192.168.1.2%3A3128&code=abcd1234&token=secret-token',
      );
      expect(payload.code, 'ABCD1234');
      expect(payload.serverUrl, 'http://192.168.1.2:3128');
      expect(payload.bootstrapToken, 'secret-token');
      expect(payload.canQuickJoin, isTrue);
    });

    test('parses legacy eco pair uri', () {
      final payload = parsePairingQrPayload('eco://pair?code=abcd1234');
      expect(payload.code, 'ABCD1234');
      expect(payload.canQuickJoin, isFalse);
    });

    test('uppercases manual code', () {
      expect(parsePairingQrPayload('abcd1234').code, 'ABCD1234');
    });
  });

  group('parsePairingCodeFromQr', () {
    test('parses eco pair uri', () {
      expect(parsePairingCodeFromQr('eco://pair?code=abcd1234'), 'ABCD1234');
    });

    test('uppercases manual code', () {
      expect(parsePairingCodeFromQr('abcd1234'), 'ABCD1234');
    });
  });

  group('AppCredentials', () {
    test('keeps user and device token bundles separate', () {
      const credentials = AppCredentials(
        serverUrl: 'http://127.0.0.1:3128',
        userEmail: 'owner@example.com',
        userRefreshToken: 'user_refresh',
        userAccessToken: 'user_access',
        userAccessTokenExpiresAt: '2030-01-01T00:10:00Z',
        deviceId: 'dev_mobile',
        deviceSecret: 'device_secret',
        deviceRefreshToken: 'device_refresh',
        deviceAccessToken: 'device_access',
        deviceAccessTokenExpiresAt: '2030-01-01T00:10:00Z',
        selectedDesktopId: 'dev_desktop',
      );

      expect(credentials.hasUserSession, isTrue);
      expect(credentials.hasDeviceCredentials, isTrue);

      final signedOut = credentials.copyWith(
        clearUserSession: true,
        clearDeviceCredentials: true,
        clearSelectedDesktop: true,
      );

      expect(signedOut.hasUserSession, isFalse);
      expect(signedOut.hasDeviceCredentials, isFalse);
      expect(signedOut.userRefreshToken, isNull);
      expect(signedOut.deviceRefreshToken, isNull);
      expect(signedOut.selectedDesktopId, isNull);
    });
  });
}
