import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
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
      expect(
        tokenStillValid('2030-01-01T00:00:20Z', now),
        isFalse,
      );
    });

    test('returns true when more than 30s remain', () {
      final now = DateTime.parse('2030-01-01T00:00:00Z');
      expect(
        tokenStillValid('2030-01-01T00:01:00Z', now),
        isTrue,
      );
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
      expect(
        EcoCenterClient.unwrapInvokeResult<List<dynamic>>([1, 2]),
        [1, 2],
      );
    });
  });

  group('parsePairingCodeFromQr', () {
    test('parses eco pair uri', () {
      expect(
        parsePairingCodeFromQr('eco://pair?code=abcd1234'),
        'ABCD1234',
      );
    });

    test('uppercases manual code', () {
      expect(parsePairingCodeFromQr('abcd1234'), 'ABCD1234');
    });
  });
}
