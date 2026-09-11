import 'dart:async';

import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/threads/activity_feed.dart';
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
        () =>
            container.read(threadSessionProvider('thr_1')).runProjection != null,
      );
      // The handoff must still load the full Feed projection (user prompts live
      // in its early sequence range), not just the seeded summary.
      expect(rpc.projectionRequests, hasLength(1));
      expect(rpc.projectionRequests.single.afterSequence, isNull);
      expect(rpc.projectionRequests.single.historyRevision, isNull);
      final projection = container
          .read(threadSessionProvider('thr_1'))
          .runProjection;
      final feed = buildActivityFeed(
        threadPrompt: _thread.prompt,
        threadId: _thread.id,
        runProjection: projection,
      );
      expect(
        feed.where((entry) => entry.kind == ActivityFeedKind.user).map((e) => e.text),
        ['hi'],
      );
      expect(container.read(threadSessionSeedProvider), isNull);
    },
  );
}

class _ProjectionRequest {
  const _ProjectionRequest({this.afterSequence, this.historyRevision});

  final int? afterSequence;
  final int? historyRevision;
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

  final projectionRequests = <_ProjectionRequest>[];

  @override
  Future<List<ThreadSummary>> listThreads() async => [_thread];

  @override
  Future<ThreadSessionBootstrapResult> sessionBootstrap(String threadId) async {
    return const ThreadSessionBootstrapResult(thread: _thread);
  }

  @override
  Future<ThreadRunProjectionSnapshot?> getRunProjection(
    String threadId, {
    String mode = 'full',
    int? afterSequence,
    int? historyRevision,
  }) async {
    projectionRequests.add(
      _ProjectionRequest(
        afterSequence: afterSequence,
        historyRevision: historyRevision,
      ),
    );
    return const ThreadRunProjectionSnapshot(
      threadId: 'thr_1',
      status: 'completed',
      generatedAt: '2026-01-01T00:00:00.000Z',
      agents: [],
      sourceEventCount: 2,
      timeline: [
        ThreadRunProjectionTimelineItem(
          id: 'user_prompt_1',
          sequence: 1,
          eventType: 'thread.status',
          scope: 'main',
          role: 'user',
          text: 'hi',
          at: '2026-01-01T00:00:00.000Z',
          metadata: {'liveType': 'thread.user_prompt'},
        ),
      ],
    );
  }

  @override
  Future<ThreadUsageSnapshotResult> getThreadUsageSnapshot(
    String threadId,
  ) async => const ThreadUsageSnapshotResult();
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
