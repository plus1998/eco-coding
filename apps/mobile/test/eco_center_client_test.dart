import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/network/eco_realtime.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('normalizeSupabaseProjectUrl', () {
    test('strips trailing slash', () {
      expect(
        normalizeSupabaseProjectUrl('https://abc.supabase.co/'),
        'https://abc.supabase.co',
      );
    });

    test('rejects unsupported scheme', () {
      expect(
        () => normalizeSupabaseProjectUrl('ftp://example.com'),
        throwsA(isA<EcoCenterException>()),
      );
    });
  });

  group('normalizeCenterServerHttpUrl', () {
    test('delegates to supabase normalizer', () {
      expect(
        normalizeCenterServerHttpUrl('http://127.0.0.1:54321/'),
        'http://127.0.0.1:54321',
      );
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

  group('eco realtime envelope', () {
    test('wrap and unwrap round-trip', () {
      final message = buildEcoPingRequest('ping_1');
      final envelope = wrapEcoRpcForBroadcast(message);
      expect(envelope['event'], EcoRealtimeTopics.broadcastEvent);
      expect(unwrapEcoRpcFromBroadcast(envelope)?['id'], 'ping_1');
    });

    test('bind topic', () {
      expect(
        EcoRealtimeTopics.bindTopic('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'),
        'eco:bind:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      );
    });
  });

  group('parsePairingQrPayload', () {
    test('parses legacy quick-join uri', () {
      final payload = parsePairingQrPayload(
        'eco://pair?server=http%3A%2F%2F192.168.1.2%3A3128&code=abcd1234&token=secret-token',
      );
      expect(payload.code, 'ABCD1234');
      expect(payload.serverUrl, 'http://192.168.1.2:3128');
      expect(payload.projectUrl, 'http://192.168.1.2:3128');
      expect(payload.bootstrapToken, 'secret-token');
      expect(payload.canQuickJoin, isTrue);
    });

    test('parses supabase url + anon key', () {
      final payload = parsePairingQrPayload(
        'eco://pair?supabase=https%3A%2F%2Fabc.supabase.co&anon=anon-public&code=xyzw9876&token=boot',
      );
      expect(payload.code, 'XYZW9876');
      expect(payload.supabaseUrl, 'https://abc.supabase.co');
      expect(payload.anonKey, 'anon-public');
      expect(payload.projectUrl, 'https://abc.supabase.co');
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
    test('requires anon key for project config', () {
      const ready = AppCredentials(
        supabaseUrl: 'https://abc.supabase.co',
        anonKey: 'anon',
      );
      expect(ready.hasProjectConfig, isTrue);
      expect(ready.serverUrl, 'https://abc.supabase.co');

      const missingAnon = AppCredentials(
        supabaseUrl: 'https://abc.supabase.co',
      );
      expect(missingAnon.hasProjectConfig, isFalse);
    });

    test('keeps user and device token bundles separate', () {
      const credentials = AppCredentials(
        supabaseUrl: 'https://abc.supabase.co',
        anonKey: 'anon',
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

  group('EcoSupabaseFunctions', () {
    test('documents Track A function names', () {
      expect(EcoSupabaseFunctions.deviceRegister, 'device-register');
      expect(EcoSupabaseFunctions.pairingJoin, 'pairing-join');
      expect(EcoSupabaseFunctions.pairingCreate, 'pairing-create');
    });
  });
}
