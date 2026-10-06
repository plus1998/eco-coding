import 'dart:async';

import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'composer handoff seeds chrome without skipping the feed bootstrap',
    () async {
      final events = StreamController<EcoEventEnvelope>.broadcast();
      final rpc = _SeedTrackingDesktopRpc();
      final container = ProviderContainer(
        overrides: [
          ecoCenterClientProvider.overrideWithValue(_ConnectedCenterClient()),
          desktopRpcProvider.overrideWithValue(rpc),
          selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
          ecoEventsProvider.overrideWith((ref) => events.stream),
        ],
      );
      // Landing composer → session handoff seeds the summary for instant chrome.
      container.read(threadSessionSeedProvider.notifier).state = _thread;
      final subscription = container.listen(
        threadSessionProvider('thr_1'),
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(() async {
        subscription.close();
        container.dispose();
        await events.close();
      });

      await _waitUntil(
        () => container.read(threadSessionProvider('thr_1')).thread != null,
      );
      // The handoff only loads session chrome here. Ordered content is owned by
      // the V2 session provider; no retired projection RPC is issued.
      expect(container.read(threadSessionProvider('thr_1')).runProjection, isNull);
      expect(container.read(threadSessionSeedProvider), isNull);
    },
  );
}

class _ConnectedCenterClient extends EcoCenterClient {
  _ConnectedCenterClient() : super(store: CredentialStore());

  @override
  CenterServerConnectionStatus get status =>
      const CenterServerConnectionStatus(state: EcoConnectionState.connected);

  @override
  bool get hasActiveBindingChannel => true;
}

class _SeedTrackingDesktopRpc extends DesktopRpc {
  _SeedTrackingDesktopRpc()
    : super(EcoCenterClient(store: CredentialStore()), 'desktop_1');

  @override
  Future<List<ThreadSummary>> listThreads() async => [_thread];

  @override
  Future<ThreadSessionBootstrapResult> sessionBootstrap(String threadId) async {
    return const ThreadSessionBootstrapResult(thread: _thread);
  }

}

const _thread = ThreadSummary(
  id: 'thr_1',
  title: 'Greeting',
  prompt: 'hi',
  workspacePath: '/tmp/workspace',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  message: '',
);

Future<void> _waitUntil(bool Function() predicate) async {
  for (var attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('Timed out waiting for asynchronous provider work.');
}
