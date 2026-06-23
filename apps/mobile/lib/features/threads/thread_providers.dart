import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/git_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/models/thread_run_projection.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/providers/app_providers.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import '../../core/utils/thread_status.dart';

final desktopRpcProvider = Provider<DesktopRpc?>((ref) {
  final client = ref.watch(ecoCenterClientProvider);
  final desktopId = ref.watch(selectedDesktopIdProvider);
  if (desktopId == null || desktopId.isEmpty) return null;
  return DesktopRpc(client, desktopId);
});

final threadListProvider =
    AsyncNotifierProvider<ThreadListNotifier, List<ThreadSummary>>(
      ThreadListNotifier.new,
    );

class ThreadListNotifier extends AsyncNotifier<List<ThreadSummary>> {
  @override
  Future<List<ThreadSummary>> build() async {
    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null) return [];

    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData((event) {
        if (event.kind.startsWith('thread.')) {
          ref.invalidateSelf();
        }
      });
    });

    return rpc.listThreads();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final rpc = ref.read(desktopRpcProvider);
      if (rpc == null) return [];
      return rpc.listThreads();
    });
  }
}

final runtimeConfigProvider = StateProvider<ThreadRuntimeConfigInput?>(
  (ref) => null,
);

final modelSettingsProvider = FutureProvider<ModelSettingsSnapshot?>((
  ref,
) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  return rpc.getModelSettings();
});

final workflowSettingsProvider = FutureProvider<WorkflowSettingsSnapshot?>((
  ref,
) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  return rpc.getWorkflowSettings();
});

ThreadRuntimeConfig defaultRuntimeConfig({
  ModelSettingsSnapshot? modelSettings,
  WorkflowSettingsSnapshot? workflow,
}) {
  return buildDefaultRuntimeConfig(
    modelSettings: modelSettings,
    workflow: workflow,
  );
}

final workspaceDiffProvider =
    FutureProvider.family<WorkspaceDiffResult?, String>((
      ref,
      workspacePath,
    ) async {
      if (workspacePath.isEmpty) return null;
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null) return null;

      ref.listen(ecoEventsProvider, (previous, next) {
        next.whenData((event) {
          if (event.kind.startsWith('thread.') ||
              event.kind.startsWith('agent.')) {
            ref.invalidateSelf();
          }
        });
      });

      try {
        final diff = await rpc.getWorkspaceDiff(workspacePath);
        return diff.hasChanges ? diff : null;
      } catch (_) {
        return null;
      }
    });

final gitStatusProvider = FutureProvider.family<GitWorkingTreeStatus?, String>((
  ref,
  workspacePath,
) async {
  if (workspacePath.isEmpty) return null;
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  try {
    return await rpc.getGitStatus(workspacePath);
  } catch (_) {
    return null;
  }
});

class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.role,
    required this.message,
    this.stream = false,
    this.agentId,
    this.apiError,
    this.tool,
  });

  final String id;
  final String role;
  final String message;
  final bool stream;
  final String? agentId;
  final ThreadApiErrorInfo? apiError;
  final ThreadRunToolMetadata? tool;
}

class ThreadSessionState {
  const ThreadSessionState({
    this.pendingPlan,
    this.pendingBash,
    this.pendingClarification,
    this.followUps = const [],
    this.loading = true,
    this.error,
    this.thread,
    this.runProjection,
    this.subagentSessions = const [],
    this.billing,
    this.contextSnapshot,
  });

  final ThreadPendingPlan? pendingPlan;
  final BashApprovalRequest? pendingBash;
  final ClarificationRequest? pendingClarification;
  final List<ThreadPendingFollowUp> followUps;
  final bool loading;
  final String? error;
  final ThreadSummary? thread;
  final ThreadRunProjectionSnapshot? runProjection;
  final List<ThreadSubagentSessionTiming> subagentSessions;
  final ThreadBillingSnapshot? billing;
  final ThreadContextSnapshot? contextSnapshot;

  ThreadSessionState copyWith({
    ThreadPendingPlan? pendingPlan,
    bool clearPlan = false,
    BashApprovalRequest? pendingBash,
    bool clearBash = false,
    ClarificationRequest? pendingClarification,
    bool clearClarification = false,
    List<ThreadPendingFollowUp>? followUps,
    bool? loading,
    String? error,
    ThreadSummary? thread,
    ThreadRunProjectionSnapshot? runProjection,
    bool clearProjection = false,
    List<ThreadSubagentSessionTiming>? subagentSessions,
    ThreadBillingSnapshot? billing,
    bool clearBilling = false,
    ThreadContextSnapshot? contextSnapshot,
    bool clearContext = false,
  }) {
    return ThreadSessionState(
      pendingPlan: clearPlan ? null : (pendingPlan ?? this.pendingPlan),
      pendingBash: clearBash ? null : (pendingBash ?? this.pendingBash),
      pendingClarification: clearClarification
          ? null
          : (pendingClarification ?? this.pendingClarification),
      followUps: followUps ?? this.followUps,
      loading: loading ?? this.loading,
      error: error,
      thread: thread ?? this.thread,
      runProjection: clearProjection
          ? null
          : (runProjection ?? this.runProjection),
      subagentSessions: subagentSessions ?? this.subagentSessions,
      billing: clearBilling ? null : (billing ?? this.billing),
      contextSnapshot: clearContext
          ? null
          : (contextSnapshot ?? this.contextSnapshot),
    );
  }
}

final threadSessionProvider =
    StateNotifierProvider.family<
      ThreadSessionNotifier,
      ThreadSessionState,
      String
    >((ref, threadId) => ThreadSessionNotifier(threadId, ref));

class ThreadSessionNotifier extends StateNotifier<ThreadSessionState> {
  ThreadSessionNotifier(this.threadId, this.ref)
    : super(const ThreadSessionState()) {
    _init();
  }

  final String threadId;
  final Ref ref;
  Timer? _projectionRefreshTimer;

  void _scheduleProjectionRefresh() {
    _projectionRefreshTimer?.cancel();
    _projectionRefreshTimer = Timer(const Duration(milliseconds: 150), () {
      unawaited(_refreshProjectionFromRpc());
    });
  }

  Future<void> _refreshProjectionFromRpc() async {
    if (!mounted) {
      return;
    }
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      return;
    }
    try {
      final projection = await rpc.getRunProjection(threadId, mode: 'feed');
      if (!mounted || projection == null) {
        return;
      }
      state = state.copyWith(
        runProjection: _pickNewerProjection(state.runProjection, projection),
      );
    } catch (_) {}
  }

  @override
  void dispose() {
    _projectionRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _init() async {
    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData(_handleEvent);
    });

    ref.listen(connectionStatusProvider, (previous, next) {
      next.whenData((status) {
        if (status.state != EcoConnectionState.connected) {
          return;
        }
        final wasConnected =
            previous?.valueOrNull?.state == EcoConnectionState.connected;
        if (wasConnected) {
          return;
        }
        unawaited(_refreshFollowUpsFromRpc());
      });
    });

    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      state = state.copyWith(loading: false, error: '未选择 PC');
      return;
    }

    final cachedThread = _threadFromCacheSync();
    if (cachedThread != null) {
      state = state.copyWith(thread: cachedThread);
    }

    try {
      final results = await Future.wait([
        rpc.sessionBootstrap(threadId),
        rpc.getRunProjection(threadId, mode: 'feed'),
      ]);
      final bootstrap = results[0] as ThreadSessionBootstrapResult;
      final projection = results[1] as ThreadRunProjectionSnapshot?;
      final thread =
          bootstrap.thread ?? cachedThread ?? await rpc.getThread(threadId);
      final loadedFollowUps = _mergeThreadFollowUps(
        bootstrap.followUps,
        state.followUps,
      );

      state = ThreadSessionState(
        pendingPlan: bootstrap.pendingPlan,
        pendingBash: bootstrap.pendingBash,
        pendingClarification: bootstrap.pendingClarification,
        followUps: loadedFollowUps,
        thread: thread ?? state.thread,
        runProjection: _pickNewerProjection(state.runProjection, projection),
        subagentSessions: state.subagentSessions.isNotEmpty
            ? state.subagentSessions
            : bootstrap.subagentSessions,
        billing: state.billing ?? bootstrap.usage.billing,
        contextSnapshot: state.contextSnapshot ?? bootstrap.usage.context,
        loading: false,
      );
      if (thread?.status == 'awaiting_plan' && bootstrap.pendingPlan == null) {
        _loadPendingPlanFromRpc();
      }
      _loadUsageDeferred();
    } catch (error) {
      state = state.copyWith(loading: false, error: error.toString());
    }
  }

  void _handleEvent(EcoEventEnvelope event) {
    final payload = event.payload;
    if (payload is! Map<String, dynamic>) return;
    final live = ThreadLiveEvent.fromJson(payload);
    final eventThreadId = resolveThreadEventThreadId(
      envelopeThreadId: event.threadId,
      payloadThreadId: live.threadId,
    );
    if (eventThreadId != threadId) return;

    final isMetricsOnlyEvent = _isMetricsOnlyThreadLiveEvent(live.type);
    final isActiveThread = _isActiveThreadStatus(state.thread?.status);

    if (isActiveThread && !isMetricsOnlyEvent) {
      _scheduleProjectionRefresh();
    }

    if (isFollowUpThreadLiveEvent(
      kind: event.kind,
      liveType: live.type,
      hasFollowUp: live.followUp != null,
    )) {
      if (live.followUp != null) {
        state = state.copyWith(
          followUps: mergeThreadFollowUp(state.followUps, live.followUp!),
        );
      }
      unawaited(_refreshFollowUpsFromRpc());
    }

    if (live.billing != null) {
      state = state.copyWith(billing: live.billing);
    } else if (live.type == 'thread.usage_updated') {
      ref.read(desktopRpcProvider)?.getThreadUsageSnapshot(threadId).then((
        usage,
      ) {
        if (!mounted) return;
        state = state.copyWith(
          billing: usage.billing ?? state.billing,
          contextSnapshot: usage.context ?? state.contextSnapshot,
        );
      });
    }

    if (live.contextSnapshot != null) {
      state = state.copyWith(contextSnapshot: live.contextSnapshot);
    } else if (event.kind == 'thread.context' ||
        live.type == 'thread.context_updated') {
      ref.read(desktopRpcProvider)?.getThreadUsageSnapshot(threadId).then((
        usage,
      ) {
        if (!mounted) return;
        if (usage.context != null) {
          state = state.copyWith(contextSnapshot: usage.context);
        }
      });
    }

    if (live.type == 'thread.run_projection_updated') {
      if (live.projection != null) {
        state = state.copyWith(
          runProjection: _pickNewerProjection(state.runProjection, live.projection),
        );
      } else {
        _scheduleProjectionRefresh();
      }
    }
    if (live.type == 'thread.subagent_timing_updated') {
      if (live.subagentSessions != null) {
        state = state.copyWith(subagentSessions: live.subagentSessions);
      } else {
        ref.read(desktopRpcProvider)?.listSubagentSessions(threadId).then((
          sessions,
        ) {
          if (!mounted) return;
          state = state.copyWith(subagentSessions: sessions);
        });
      }
      if (_isActiveThreadStatus(state.thread?.status)) {
        _scheduleProjectionRefresh();
      }
    }

    final updatedTitle = live.title?.trim();
    if (updatedTitle != null &&
        updatedTitle.isNotEmpty &&
        state.thread != null &&
        state.thread!.title != updatedTitle) {
      state = state.copyWith(
        thread: state.thread!.copyWith(title: updatedTitle),
      );
    }

    if (live.runtimeConfig != null) {
      final config = live.runtimeConfig!;
      if (state.thread != null) {
        state = state.copyWith(
          thread: state.thread!.copyWith(runtimeConfig: config),
        );
      }
      ref.read(runtimeConfigProvider.notifier).state = config;
    }

    if (shouldUpdateThreadSummaryFromLiveEvent(live.type) &&
        state.thread != null) {
      final thread = state.thread!;
      state = state.copyWith(
        thread: thread.copyWith(
          status: threadStatusFromLiveEvent(live.type, thread.status),
          message: resolveThreadMessageFromLiveEvent(live.type, live.message),
          updatedAt: DateTime.now().toUtc().toIso8601String(),
          runtimeConfig: live.runtimeConfig ?? thread.runtimeConfig,
        ),
      );
    }

    if (event.kind == 'thread.plan') {
      if (live.type == 'thread.plan_cleared' ||
          live.type == 'thread.completed' ||
          live.type == 'plan_approval.denied') {
        state = state.copyWith(clearPlan: true);
      } else if (live.type == 'thread.awaiting_plan' ||
          live.type == 'thread.execution_failed' ||
          live.type == 'plan_approval.requested') {
        if (live.plan != null) {
          state = state.copyWith(pendingPlan: live.plan);
        }
        _loadPendingPlanFromRpc();
      }
    }
    if (event.kind == 'thread.bash_approval') {
      ref.read(desktopRpcProvider)?.getPendingBashApproval(threadId).then((
        bash,
      ) {
        if (!mounted) return;
        state = state.copyWith(
          pendingBash: bash,
          clearBash: bash == null,
        );
      });
    }
    if (event.kind == 'thread.clarification') {
      ref.read(desktopRpcProvider)?.getPendingClarification(threadId).then((
        clarification,
      ) {
        if (!mounted) return;
        state = state.copyWith(
          pendingClarification: clarification,
          clearClarification: clarification == null,
        );
      });
    }
    if (event.kind.startsWith('thread.')) {
      ref.invalidate(threadListProvider);
      ref.read(threadListProvider.future).then((threads) {
        if (!mounted) return;
        ThreadSummary? thread;
        for (final candidate in threads) {
          if (candidate.id == threadId) {
            thread = candidate;
            break;
          }
        }
        if (thread == null) return;
        final pendingPlanActive = state.pendingPlan != null;
        if (pendingPlanActive &&
            thread.status != 'awaiting_plan' &&
            thread.status != 'running') {
          ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
            if (!mounted) return;
            state = state.copyWith(
              pendingPlan: plan,
              clearPlan: plan == null,
              thread: thread,
            );
          });
          return;
        }
        if ((thread.status == 'awaiting_plan' || thread.status == 'running') &&
            state.pendingPlan == null) {
          ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
            if (!mounted) return;
            state = state.copyWith(
              pendingPlan: plan,
              thread: thread,
            );
          });
          return;
        }
        state = state.copyWith(thread: thread);
      });
    }
  }

  Future<void> _refreshFollowUpsFromRpc() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    try {
      final followUps = await rpc.followUpList(threadId);
      if (!mounted) return;
      state = state.copyWith(followUps: followUps);
    } catch (_) {}
  }

  ThreadSummary? _threadFromCacheSync() {
    final cached = ref.read(threadListProvider).valueOrNull;
    if (cached == null) return null;
    for (final candidate in cached) {
      if (candidate.id == threadId) {
        return candidate;
      }
    }
    return null;
  }

  Future<ThreadSummary?> _resolveThreadSummary(DesktopRpc rpc) async {
    return _threadFromCacheSync() ?? rpc.getThread(threadId);
  }

  void _loadUsageDeferred() {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    unawaited(
      rpc.getThreadUsageSnapshot(threadId).then((usage) {
        if (!mounted) return;
        state = state.copyWith(
          billing: usage.billing ?? state.billing,
          contextSnapshot: usage.context ?? state.contextSnapshot,
        );
      }),
    );
  }

  Future<void> refreshPending() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    final bootstrap = await rpc.sessionBootstrap(threadId);
    final thread = bootstrap.thread ?? await _resolveThreadSummary(rpc);
    final pendingPlan =
        bootstrap.pendingPlan ?? await rpc.getPendingPlan(threadId);
    if (!mounted) return;
    state = state.copyWith(
      pendingPlan: pendingPlan,
      clearPlan: pendingPlan == null,
      pendingBash: bootstrap.pendingBash,
      clearBash: bootstrap.pendingBash == null,
      pendingClarification: bootstrap.pendingClarification,
      clearClarification: bootstrap.pendingClarification == null,
      followUps: bootstrap.followUps,
      thread: thread ?? state.thread,
      billing: bootstrap.usage.billing ?? state.billing,
      contextSnapshot: bootstrap.usage.context ?? state.contextSnapshot,
    );
  }

  Future<void> approvePlan() async {
    await ref.read(desktopRpcProvider)?.approvePlan(threadId);
    state = state.copyWith(clearPlan: true);
  }

  Future<void> dismissPlan() async {
    await ref.read(desktopRpcProvider)?.dismissPlan(threadId);
    state = state.copyWith(clearPlan: true);
  }

  void _loadPendingPlanFromRpc() {
    ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
      if (!mounted) return;
      if (plan != null) {
        state = state.copyWith(pendingPlan: plan);
      }
    });
  }

  Future<void> resolveBash(String toolUseId, String decision) async {
    await ref
        .read(desktopRpcProvider)
        ?.resolveBashApproval(toolUseId: toolUseId, decision: decision);
    state = state.copyWith(clearBash: true);
  }

  Future<void> submitClarification(
    String toolUseId,
    List<List<String>> selections,
  ) async {
    await ref
        .read(desktopRpcProvider)
        ?.submitClarification(toolUseId: toolUseId, selections: selections);
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      state = state.copyWith(clearClarification: true);
      return;
    }
    final clarification = await rpc.getPendingClarification(threadId);
    if (!mounted) return;
    state = state.copyWith(
      pendingClarification: clarification,
      clearClarification: clarification == null,
    );
  }
}

ThreadRunProjectionSnapshot? _pickNewerProjection(
  ThreadRunProjectionSnapshot? current,
  ThreadRunProjectionSnapshot? incoming,
) {
  if (current == null) return incoming;
  if (incoming == null) return current;
  if (incoming.generatedAt.compareTo(current.generatedAt) >= 0) {
    return incoming;
  }
  return current;
}

List<ThreadPendingFollowUp> _mergeThreadFollowUps(
  List<ThreadPendingFollowUp> base,
  List<ThreadPendingFollowUp> overlay,
) {
  var merged = sortThreadFollowUps(base);
  for (final followUp in overlay) {
    merged = mergeThreadFollowUp(merged, followUp);
  }
  return merged;
}

bool _isMetricsOnlyThreadLiveEvent(String liveType) {
  return liveType == 'thread.usage_updated' ||
      liveType == 'thread.context_updated' ||
      liveType == 'thread.subagent_timing_updated' ||
      liveType == 'thread.todos_updated' ||
      liveType == 'thread.title_updated' ||
      liveType == 'thread.run_projection_updated';
}

bool _isActiveThreadStatus(String? status) {
  return status == 'running' || status == 'awaiting_plan';
}
