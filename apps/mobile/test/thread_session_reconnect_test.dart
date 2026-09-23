import 'dart:async';

import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/providers/desktop_bind_ready.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('thread session reconnect never calls retired projection RPCs', () async {
    final statuses = StreamController<CenterServerConnectionStatus>.broadcast();
    final events = StreamController<EcoEventEnvelope>.broadcast();
    final rpc = _TrackingDesktopRpc();
    final container = ProviderContainer(
      overrides: [
        desktopRpcProvider.overrideWithValue(rpc),
        selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
        connectionStatusProvider.overrideWith((ref) => statuses.stream),
        ecoEventsProvider.overrideWith((ref) => events.stream),
        desktopBindReadyOverrideProvider.overrideWithValue(true),
      ],
    );
    final subscription = container.listen(
      threadSessionProvider('thr_1'),
      (_, _) {},
      fireImmediately: true,
    );
    addTearDown(() async {
      subscription.close();
      container.dispose();
      await statuses.close();
      await events.close();
    });

    await _waitUntil(() => rpc.sessionBootstrapRequests >= 1);
    expect(container.read(threadSessionProvider('thr_1')).thread?.id, 'thr_1');
    expect(rpc.retiredProjectionCalls, 0);

    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.disconnected),
    );
    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.connected),
    );
    await _waitUntil(() => rpc.sessionBootstrapRequests >= 2);
    expect(rpc.retiredProjectionCalls, 0);
    expect(container.read(threadSessionProvider('thr_1')).runProjection, isNull);
  });

  test(
    'composer recovery lookup failure does not replace the thread session',
    () async {
      final statuses =
          StreamController<CenterServerConnectionStatus>.broadcast();
      final events = StreamController<EcoEventEnvelope>.broadcast();
      final rpc = _TrackingDesktopRpc(failComposerDraft: true);
      final container = ProviderContainer(
        overrides: [
          desktopRpcProvider.overrideWithValue(rpc),
          selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
          connectionStatusProvider.overrideWith((ref) => statuses.stream),
          ecoEventsProvider.overrideWith((ref) => events.stream),
          // See the first case: the Realtime bind gate is not under test here.
          desktopBindReadyOverrideProvider.overrideWithValue(true),
        ],
      );
      final subscription = container.listen(
        threadSessionProvider('thr_1'),
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(() async {
        subscription.close();
        container.dispose();
        await statuses.close();
        await events.close();
      });

      await _waitUntil(
        () => container.read(threadSessionProvider('thr_1')).thread?.id == 'thr_1',
      );
      final state = container.read(threadSessionProvider('thr_1'));
      expect(state.error, isNull);
      expect(state.thread?.id, 'thr_1');
      expect(state.composerRestore, isNull);
    },
  );

  test(
    'thread session refreshes and acknowledges durable composer recovery',
    () async {
      final statuses =
          StreamController<CenterServerConnectionStatus>.broadcast();
      final events = StreamController<EcoEventEnvelope>.broadcast();
      final rpc = _TrackingDesktopRpc()
        ..composerDraft = const ComposerDraftRecord(
          contextKey: 'thread:thr_1',
          prompt: 'restore me',
          revision: 'revision_1',
          updatedAt: '2026-08-22T00:00:00.000Z',
          recoveryReason: 'Cursor session failed',
          attachments: [
            PromptImageAttachment(mediaType: 'image/png', data: 'AQI='),
          ],
        );
      final container = ProviderContainer(
        overrides: [
          desktopRpcProvider.overrideWithValue(rpc),
          selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
          connectionStatusProvider.overrideWith((ref) => statuses.stream),
          ecoEventsProvider.overrideWith((ref) => events.stream),
          // See the first case: the Realtime bind gate is not under test here.
          desktopBindReadyOverrideProvider.overrideWithValue(true),
        ],
      );
      final subscription = container.listen(
        threadSessionProvider('thr_1'),
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(() async {
        subscription.close();
        container.dispose();
        await statuses.close();
        await events.close();
      });

      await _waitUntil(
        () =>
            container.read(threadSessionProvider('thr_1')).composerRestore !=
            null,
      );
      final restore = container
          .read(threadSessionProvider('thr_1'))
          .composerRestore!;
      expect(restore.prompt, 'restore me');
      expect(restore.revision, 'revision_1');
      expect(restore.attachments, hasLength(1));

      final deleted = await container
          .read(threadSessionProvider('thr_1').notifier)
          .acknowledgeComposerRestore('revision_1');
      expect(deleted, isTrue);
      expect(rpc.composerDraftDeletes, [
        (contextKey: 'thread:thr_1', revision: 'revision_1'),
      ]);
      expect(
        container.read(threadSessionProvider('thr_1')).composerRestore,
        isNull,
      );

      rpc.composerDraft = const ComposerDraftRecord(
        contextKey: 'thread:thr_1',
        prompt: 'restore after reconnect',
        revision: 'revision_2',
        updatedAt: '2026-08-22T00:00:01.000Z',
        recoveryReason: 'Cursor reconnect failure',
      );
      statuses.add(
        const CenterServerConnectionStatus(
          state: EcoConnectionState.disconnected,
        ),
      );
      statuses.add(
        const CenterServerConnectionStatus(state: EcoConnectionState.connected),
      );
      await _waitUntil(
        () =>
            container
                .read(threadSessionProvider('thr_1'))
                .composerRestore
                ?.revision ==
            'revision_2',
      );
      expect(rpc.composerDraftRequests.length, greaterThanOrEqualTo(2));
    },
  );
}

class _TrackingDesktopRpc extends DesktopRpc {
  _TrackingDesktopRpc({this.failComposerDraft = false})
    : super(EcoCenterClient(store: CredentialStore()), 'desktop_1');

  final bool failComposerDraft;
  var sessionBootstrapRequests = 0;
  var retiredProjectionCalls = 0;
  final composerDraftRequests = <String>[];
  final composerDraftDeletes = <({String contextKey, String revision})>[];
  ComposerDraftRecord? composerDraft;

  @override
  Future<List<ThreadSummary>> listThreads() async => [_thread];

  @override
  Future<ThreadSessionBootstrapResult> sessionBootstrap(String threadId) async {
    sessionBootstrapRequests += 1;
    return const ThreadSessionBootstrapResult(thread: _thread);
  }

  @override
  Future<ComposerDraftRecord?> getComposerDraft(String contextKey) async {
    composerDraftRequests.add(contextKey);
    if (failComposerDraft) {
      throw StateError('composer draft unavailable');
    }
    return composerDraft;
  }

  @override
  Future<bool> deleteComposerDraft({
    required String contextKey,
    required String expectedRevision,
  }) async {
    composerDraftDeletes.add((
      contextKey: contextKey,
      revision: expectedRevision,
    ));
    if (composerDraft?.revision != expectedRevision) return false;
    composerDraft = null;
    return true;
  }

  @override
  Future<List<ThreadPendingFollowUp>> followUpList(String threadId) async => [];

}

const _thread = ThreadSummary(
  id: 'thr_1',
  title: 'Thread',
  prompt: 'Prompt',
  workspacePath: '/tmp/workspace',
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  message: '',
);

Future<void> _waitUntil(bool Function() predicate) async {
  for (var attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('Timed out waiting for asynchronous provider work.');
}
