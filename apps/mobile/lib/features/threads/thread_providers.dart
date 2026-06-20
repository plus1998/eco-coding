import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart' show EcoEventEnvelope;
import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/providers/app_providers.dart';

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

final runtimeConfigProvider =
    StateProvider<ThreadRuntimeConfigInput?>((ref) => null);

final modelSettingsProvider = FutureProvider<ModelSettingsSnapshot?>((ref) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  return rpc.getModelSettings();
});

final workflowSettingsProvider =
    FutureProvider<WorkflowSettingsSnapshot?>((ref) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  return rpc.getWorkflowSettings();
});

ThreadRuntimeConfig defaultRuntimeConfig({
  ModelSettingsSnapshot? modelSettings,
  WorkflowSettingsSnapshot? workflow,
}) {
  final profileId = modelSettings?.orchestrationProfiles.firstOrNull?.id ?? '';
  final subagents = {
    for (final role in subagentRoles) role: role == 'explore',
  };
  return ThreadRuntimeConfig(
    routeProfileId: profileId,
    agentProfileId: profileId.isEmpty ? null : profileId,
    subagentEnabled: subagents,
    planModeEnabled: workflow?.planModeEnabled ?? false,
    bashReviewMode: 'always',
  );
}

final workspaceDiffProvider =
    FutureProvider.family<WorkspaceDiffResult?, String>((ref, workspacePath) async {
  if (workspacePath.isEmpty) return null;
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;

  ref.listen(ecoEventsProvider, (previous, next) {
    next.whenData((event) {
      if (event.kind.startsWith('thread.') || event.kind.startsWith('agent.')) {
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

class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.role,
    required this.message,
    this.stream = false,
  });

  final String id;
  final String role;
  final String message;
  final bool stream;
}

class ThreadSessionState {
  const ThreadSessionState({
    this.activities = const [],
    this.pendingPlan,
    this.pendingBash,
    this.pendingClarification,
    this.followUps = const [],
    this.loading = true,
    this.error,
    this.thread,
  });

  final List<ActivityItem> activities;
  final ThreadPendingPlan? pendingPlan;
  final BashApprovalRequest? pendingBash;
  final ClarificationRequest? pendingClarification;
  final List<ThreadPendingFollowUp> followUps;
  final bool loading;
  final String? error;
  final ThreadSummary? thread;

  ThreadSessionState copyWith({
    List<ActivityItem>? activities,
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
  }) {
    return ThreadSessionState(
      activities: activities ?? this.activities,
      pendingPlan: clearPlan ? null : (pendingPlan ?? this.pendingPlan),
      pendingBash: clearBash ? null : (pendingBash ?? this.pendingBash),
      pendingClarification: clearClarification
          ? null
          : (pendingClarification ?? this.pendingClarification),
      followUps: followUps ?? this.followUps,
      loading: loading ?? this.loading,
      error: error,
      thread: thread ?? this.thread,
    );
  }
}

final threadSessionProvider = StateNotifierProvider.family<
    ThreadSessionNotifier, ThreadSessionState, String>(
  (ref, threadId) => ThreadSessionNotifier(threadId, ref),
);

class ThreadSessionNotifier extends StateNotifier<ThreadSessionState> {
  ThreadSessionNotifier(this.threadId, this.ref)
      : super(const ThreadSessionState()) {
    _init();
  }

  final String threadId;
  final Ref ref;

  Future<void> _init() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      state = state.copyWith(loading: false, error: '未选择 PC');
      return;
    }

    try {
      final lines = await rpc.activityList(threadId);
      final plan = await rpc.getPendingPlan(threadId);
      final bash = await rpc.getPendingBashApproval(threadId);
      final clarification = await rpc.getPendingClarification(threadId);
      final followUps = await rpc.followUpList(threadId);
      final threads = await rpc.listThreads();
      ThreadSummary? thread;
      for (final candidate in threads) {
        if (candidate.id == threadId) {
          thread = candidate;
          break;
        }
      }

      state = ThreadSessionState(
        activities: lines
            .map(
              (line) => ActivityItem(
                id: line.id,
                role: line.role,
                message: line.message,
                stream: line.stream ?? false,
              ),
            )
            .toList(),
        pendingPlan: plan,
        pendingBash: bash,
        pendingClarification: clarification,
        followUps: followUps,
        thread: thread,
        loading: false,
      );
    } catch (error) {
      state = state.copyWith(
        loading: false,
        error: error.toString(),
      );
    }

    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData(_handleEvent);
    });
  }

  void _handleEvent(EcoEventEnvelope event) {
    if (event.threadId != threadId) return;
    final payload = event.payload;
    if (payload is! Map<String, dynamic>) return;
    final live = ThreadLiveEvent.fromJson(payload);

    var activities = [...state.activities];

    if (live.activityLine != null) {
      final line = live.activityLine!;
      final index = activities.indexWhere((a) => a.id == line.id);
      final item = ActivityItem(
        id: line.id,
        role: line.role,
        message: line.message,
        stream: line.stream ?? false,
      );
      if (index >= 0) {
        activities[index] = item;
      } else {
        activities.add(item);
      }
    } else if (live.message.isNotEmpty) {
      if (live.stream == true && activities.isNotEmpty) {
        final last = activities.last;
        if (last.stream && last.role == (live.role ?? last.role)) {
          activities[activities.length - 1] = ActivityItem(
            id: last.id,
            role: last.role,
            message: last.message + live.message,
            stream: true,
          );
        } else {
          activities.add(
            ActivityItem(
              id: 'stream_${activities.length}',
              role: live.role ?? 'assistant',
              message: live.message,
              stream: true,
            ),
          );
        }
      } else {
        activities.add(
          ActivityItem(
            id: 'evt_${activities.length}',
            role: live.role ?? 'assistant',
            message: live.message,
            stream: live.stream ?? false,
          ),
        );
      }
    }

    state = state.copyWith(
      activities: activities,
      pendingPlan: live.plan,
      pendingBash: live.bashApproval,
      pendingClarification: live.clarification,
    );

    if (event.kind == 'thread.plan' && live.type == 'thread.awaiting_plan') {
      ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
        if (plan != null) state = state.copyWith(pendingPlan: plan);
      });
    }
    if (event.kind == 'thread.bash_approval') {
      ref.read(desktopRpcProvider)?.getPendingBashApproval(threadId).then((bash) {
        if (bash != null) state = state.copyWith(pendingBash: bash);
      });
    }
    if (event.kind == 'thread.clarification') {
      ref
          .read(desktopRpcProvider)
          ?.getPendingClarification(threadId)
          .then((clarification) {
        if (clarification != null) {
          state = state.copyWith(pendingClarification: clarification);
        }
      });
    }
    if (event.kind.startsWith('thread.')) {
      ref.invalidate(threadListProvider);
    }
  }

  Future<void> refreshPending() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    final plan = await rpc.getPendingPlan(threadId);
    final bash = await rpc.getPendingBashApproval(threadId);
    final clarification = await rpc.getPendingClarification(threadId);
    final followUps = await rpc.followUpList(threadId);
    state = state.copyWith(
      pendingPlan: plan,
      clearPlan: plan == null,
      pendingBash: bash,
      clearBash: bash == null,
      pendingClarification: clarification,
      clearClarification: clarification == null,
      followUps: followUps,
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
    await ref.read(desktopRpcProvider)?.submitClarification(
          toolUseId: toolUseId,
          selections: selections,
        );
    state = state.copyWith(clearClarification: true);
  }
}
