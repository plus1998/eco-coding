import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(clearGlobalSettingsDigestCacheForTest);

  test('ThreadLiveEvent parses settingsDigest', () {
    final event = ThreadLiveEvent.fromJson({
      'threadId': 'settings',
      'type': 'settings.updated',
      'message': 'saved',
      'settingsDigest': 'abc123',
    });
    expect(event.settingsDigest, 'abc123');
  });

  test('getSettingsDigest uses settings:digest channel', () async {
    final client = _DigestEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');
    final result = await rpc.getSettingsDigest();
    expect(client.channel, 'settings:digest');
    expect(result.digest, 'digest_1');
  });

  test('sync skips reload when digest matches cache', () async {
    var reloads = 0;
    final changed = await syncGlobalSettingsIfDigestChanged(
      desktopId: 'desktop_1',
      knownDigest: 'same',
      cachedDigest: 'same',
      fetchDigest: () async => 'unused',
      reloadAll: () async {
        reloads += 1;
      },
      rememberDigest: (_) {},
      forceReloadWithoutDigest: () {
        reloads += 1;
      },
    );
    expect(changed, isFalse);
    expect(reloads, 0);
  });

  test('sync reloads and remembers when digest changes', () async {
    var remembered = '';
    var reloads = 0;
    final changed = await syncGlobalSettingsIfDigestChanged(
      desktopId: 'desktop_1',
      knownDigest: 'new',
      cachedDigest: 'old',
      fetchDigest: () async => 'unused',
      reloadAll: () async {
        reloads += 1;
      },
      rememberDigest: (digest) {
        remembered = digest;
      },
      forceReloadWithoutDigest: () {},
    );
    expect(changed, isTrue);
    expect(reloads, 1);
    expect(remembered, 'new');
  });

  test('sync fetches digest then reloads on reconnect path', () async {
    var fetchCount = 0;
    var reloads = 0;
    final changed = await syncGlobalSettingsIfDigestChanged(
      desktopId: 'desktop_1',
      knownDigest: null,
      cachedDigest: null,
      fetchDigest: () async {
        fetchCount += 1;
        return 'fresh';
      },
      reloadAll: () async {
        reloads += 1;
      },
      rememberDigest: (digest) {
        globalSettingsDigestByDesktopId['desktop_1'] = digest;
      },
      forceReloadWithoutDigest: () {},
    );
    expect(changed, isTrue);
    expect(fetchCount, 1);
    expect(reloads, 1);
    expect(globalSettingsDigestByDesktopId['desktop_1'], 'fresh');
  });

  test('sync falls back when digest RPC fails', () async {
    var forced = 0;
    final changed = await syncGlobalSettingsIfDigestChanged(
      desktopId: 'desktop_1',
      knownDigest: null,
      cachedDigest: 'stale',
      fetchDigest: () async {
        throw EcoCenterException.app(EcoCenterErrorKind.rpcFailed);
      },
      reloadAll: () async {},
      rememberDigest: (_) {},
      forceReloadWithoutDigest: () {
        forced += 1;
      },
    );
    expect(changed, isTrue);
    expect(forced, 1);
  });
}

class _DigestEcoCenterClient extends EcoCenterClient {
  _DigestEcoCenterClient() : super(store: CredentialStore());

  String? channel;

  @override
  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    this.channel = channel;
    if (channel == 'settings:digest') {
      return {'digest': 'digest_1'} as T;
    }
    throw StateError('unexpected channel $channel');
  }
}
