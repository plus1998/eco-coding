import 'dart:async';

import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('thread session pulls incremental projection after reconnect', () async {
    final statuses = StreamController<CenterServerConnectionStatus>.broadcast();
    final events = StreamController<EcoEventEnvelope>.broadcast();
    final rpc = _TrackingDesktopRpc();
    final container = ProviderContainer(
      overrides: [
        desktopRpcProvider.overrideWithValue(rpc),
        selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
        connectionStatusProvider.overrideWith((ref) => statuses.stream),
        ecoEventsProvider.overrideWith((ref) => events.stream),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await statuses.close();
      await events.close();
    });
    var subscription = container.listen(
      threadSessionProvider('thr_1'),
      (_, _) {},
      fireImmediately: true,
    );
    addTearDown(subscription.close);

    await _waitUntil(() => rpc.projectionRequests.length == 1);

    events.add(
      const EcoEventEnvelope(
        id: 'lifecycle_1',
        kind: 'thread.stream',
        source: 'desktop_1',
        occurredAt: '2026-01-01T00:00:01.000Z',
        threadId: 'thr_1',
        payload: {
          'threadId': 'thr_1',
          'type': 'tool.started',
          'message': 'working',
        },
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 250));
    expect(rpc.projectionRequests, hasLength(1));

    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.connecting),
    );
    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.connected),
    );
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(rpc.projectionRequests, hasLength(1));

    statuses.add(
      const CenterServerConnectionStatus(
        state: EcoConnectionState.disconnected,
      ),
    );
    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.connecting),
    );
    statuses.add(
      const CenterServerConnectionStatus(state: EcoConnectionState.connected),
    );
    await _waitUntil(() => rpc.projectionRequests.length == 2);

    expect(rpc.projectionRequests[1].afterSequence, 9);
    expect(rpc.projectionRequests[1].historyRevision, 4);

    events.add(
      const EcoEventEnvelope(
        id: 'presence_1',
        kind: presenceDeviceEventKind,
        source: 'center-server',
        occurredAt: '2026-01-01T00:00:02.000Z',
        payload: {
          'onlineDeviceIds': ['desktop_1'],
        },
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(rpc.projectionRequests, hasLength(2));

    events.add(
      const EcoEventEnvelope(
        id: 'presence_2',
        kind: presenceDeviceEventKind,
        source: 'center-server',
        occurredAt: '2026-01-01T00:00:03.000Z',
        payload: {'onlineDeviceIds': <String>[]},
      ),
    );
    events.add(
      const EcoEventEnvelope(
        id: 'presence_3',
        kind: presenceDeviceEventKind,
        source: 'center-server',
        occurredAt: '2026-01-01T00:00:04.000Z',
        payload: {
          'onlineDeviceIds': ['desktop_1'],
        },
      ),
    );
    await _waitUntil(() => rpc.projectionRequests.length == 3);
    expect(rpc.projectionRequests[2].afterSequence, 9);
    expect(rpc.projectionRequests[2].historyRevision, 4);

    subscription.close();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    subscription = container.listen(
      threadSessionProvider('thr_1'),
      (_, _) {},
      fireImmediately: true,
    );
    await _waitUntil(() => rpc.projectionRequests.length == 4);
    expect(rpc.projectionRequests[3].afterSequence, isNull);
    expect(rpc.projectionRequests[3].historyRevision, isNull);
  });

  test(
    'thread session pulls when the first desktop connection follows a failed bootstrap',
    () async {
      final statuses =
          StreamController<CenterServerConnectionStatus>.broadcast();
      final events = StreamController<EcoEventEnvelope>.broadcast();
      final rpc = _TrackingDesktopRpc(failFirstProjection: true);
      final container = ProviderContainer(
        overrides: [
          desktopRpcProvider.overrideWithValue(rpc),
          selectedDesktopIdProvider.overrideWith((ref) => 'desktop_1'),
          connectionStatusProvider.overrideWith((ref) => statuses.stream),
          ecoEventsProvider.overrideWith((ref) => events.stream),
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

      await _waitUntil(() => rpc.projectionRequests.length == 1);
      events.add(
        const EcoEventEnvelope(
          id: 'presence_first_online',
          kind: presenceDeviceEventKind,
          source: 'center-server',
          occurredAt: '2026-01-01T00:00:01.000Z',
          payload: {
            'onlineDeviceIds': ['desktop_1'],
          },
        ),
      );

      await _waitUntil(() => rpc.projectionRequests.length == 2);
      expect(rpc.projectionRequests[1].afterSequence, isNull);
      expect(rpc.projectionRequests[1].historyRevision, isNull);
    },
  );

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

class _ProjectionRequest {
  const _ProjectionRequest({this.afterSequence, this.historyRevision});

  final int? afterSequence;
  final int? historyRevision;
}

class _TrackingDesktopRpc extends DesktopRpc {
  _TrackingDesktopRpc({
    this.failFirstProjection = false,
    this.failComposerDraft = false,
  }) : super(EcoCenterClient(store: CredentialStore()), 'desktop_1');

  final bool failFirstProjection;
  final bool failComposerDraft;
  final projectionRequests = <_ProjectionRequest>[];
  final composerDraftRequests = <String>[];
  final composerDraftDeletes = <({String contextKey, String revision})>[];
  ComposerDraftRecord? composerDraft;

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
    if (failFirstProjection && projectionRequests.length == 1) {
      throw StateError('desktop offline');
    }
    if (projectionRequests.length == 1) {
      return const ThreadRunProjectionSnapshot(
        threadId: 'thr_1',
        status: 'running',
        generatedAt: '2026-01-01T00:00:00.000Z',
        agents: [
          ThreadRunProjectionAgent(
            agentId: 'agent_1',
            role: 'coder',
            kind: 'subagent',
            status: 'active',
            startedAt: '2026-01-01T00:00:00.000Z',
            durationMs: 1,
            timeline: [
              ThreadRunProjectionTimelineItem(
                id: 'agent_message_9',
                sequence: 9,
                eventType: 'message.final',
                scope: 'agent',
                text: 'agent cached',
                at: '2026-01-01T00:00:00.000Z',
              ),
            ],
          ),
        ],
        sourceEventCount: 1,
        historyRevision: 4,
        timeline: [
          ThreadRunProjectionTimelineItem(
            id: 'message_7',
            sequence: 7,
            eventType: 'message.final',
            scope: 'main',
            text: 'cached',
            at: '2026-01-01T00:00:00.000Z',
          ),
        ],
      );
    }
    return const ThreadRunProjectionSnapshot(
      threadId: 'thr_1',
      status: 'running',
      generatedAt: '2026-01-01T00:00:01.000Z',
      agents: [],
      sourceEventCount: 1,
      historyRevision: 4,
    );
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

  @override
  Future<ThreadUsageSnapshotResult> getThreadUsageSnapshot(
    String threadId,
  ) async => const ThreadUsageSnapshotResult();
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
