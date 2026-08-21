import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/acp_models.dart';
import '../../core/models/asr_models.dart';
import '../../core/models/git_models.dart';
import '../../core/models/integration_models.dart';
import '../../core/models/mcp_models.dart';
import '../../core/models/project_orchestration_settings.dart';
import '../../core/models/app_error.dart';
import '../../core/models/skill_models.dart';
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

/// Pre-seed [threadSessionProvider] when handing off from the landing composer
/// so the session page does not flash a full-screen loading spinner.
final threadSessionSeedProvider = StateProvider<ThreadSummary?>((ref) => null);

/// In-memory per-desktop digest of the last successfully synced global settings.
final Map<String, String> globalSettingsDigestByDesktopId = <String, String>{};

@visibleForTesting
void clearGlobalSettingsDigestCacheForTest() {
  globalSettingsDigestByDesktopId.clear();
}

@visibleForTesting
Future<bool> syncGlobalSettingsIfDigestChanged({
  required String desktopId,
  required String? knownDigest,
  required String? cachedDigest,
  required Future<String> Function() fetchDigest,
  required Future<void> Function() reloadAll,
  required void Function(String digest) rememberDigest,
  required void Function() forceReloadWithoutDigest,
}) async {
  if (desktopId.trim().isEmpty) {
    return false;
  }

  var digest = knownDigest?.trim() ?? '';
  if (digest.isEmpty) {
    try {
      digest = (await fetchDigest()).trim();
    } catch (_) {
      forceReloadWithoutDigest();
      return true;
    }
  }
  if (digest.isEmpty) {
    forceReloadWithoutDigest();
    return true;
  }

  if (cachedDigest != null && cachedDigest == digest) {
    return false;
  }

  await reloadAll();
  rememberDigest(digest);
  return true;
}

/// Compare Desktop global-settings digest and full-pull only when it changed.
///
/// Returns `true` when model/workflow providers were invalidated (or forced).
Future<bool> ensureGlobalSettingsSynced(
  Ref ref, {
  String? knownDigest,
}) async {
  final desktopId = ref.read(selectedDesktopIdProvider)?.trim() ?? '';
  final rpc = ref.read(desktopRpcProvider);
  if (desktopId.isEmpty || rpc == null) {
    return false;
  }

  return syncGlobalSettingsIfDigestChanged(
    desktopId: desktopId,
    knownDigest: knownDigest,
    cachedDigest: globalSettingsDigestByDesktopId[desktopId],
    fetchDigest: () async => (await rpc.getSettingsDigest()).digest,
    reloadAll: () async {
      ref.invalidate(modelSettingsProvider);
      ref.invalidate(workflowSettingsProvider);
      await Future.wait([
        ref.read(modelSettingsProvider.future),
        ref.read(workflowSettingsProvider.future),
      ]);
    },
    rememberDigest: (digest) {
      globalSettingsDigestByDesktopId[desktopId] = digest;
    },
    forceReloadWithoutDigest: () {
      ref.invalidate(modelSettingsProvider);
      ref.invalidate(workflowSettingsProvider);
    },
  ).catchError((_) => true);
}

Future<void> warmGlobalSettingsDigestCache(Ref ref) async {
  final desktopId = ref.read(selectedDesktopIdProvider)?.trim() ?? '';
  final rpc = ref.read(desktopRpcProvider);
  if (desktopId.isEmpty || rpc == null) {
    return;
  }
  try {
    final digest = (await rpc.getSettingsDigest()).digest;
    if (digest.isNotEmpty) {
      globalSettingsDigestByDesktopId[desktopId] = digest;
    }
  } catch (_) {
    // Older Desktop or transient RPC failure — ignore.
  }
}

/// Keeps global model/workflow caches aligned via settings.updated + WS reconnect.
final globalSettingsSyncBootstrapProvider = Provider<void>((ref) {
  ref.listen(ecoEventsProvider, (_, next) {
    next.whenData((event) {
      if (event.kind != 'settings.updated') {
        return;
      }
      final payload = event.payload;
      String? knownDigest;
      if (payload is Map<String, dynamic>) {
        knownDigest = ThreadLiveEvent.fromJson(payload).settingsDigest;
      }
      unawaited(ensureGlobalSettingsSynced(ref, knownDigest: knownDigest));
    });
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
      unawaited(ensureGlobalSettingsSynced(ref));
    });
  });
});

final asrStatusProvider = FutureProvider<AsrStatus?>((ref) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  try {
    return await rpc.getAsrStatus();
  } catch (_) {
    return null;
  }
});

final threadListProvider =
    AsyncNotifierProvider<ThreadListNotifier, List<ThreadSummary>>(
      ThreadListNotifier.new,
    );

enum ThreadAttentionKind { plan, bash }

class ThreadAttentionItem {
  const ThreadAttentionItem({
    required this.id,
    required this.threadId,
    required this.title,
    required this.kind,
    required this.updatedAt,
    this.detail,
  });

  final String id;
  final String threadId;
  final String title;
  final ThreadAttentionKind kind;
  final String updatedAt;
  final String? detail;
}

final threadAttentionProvider = FutureProvider<List<ThreadAttentionItem>>((
  ref,
) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return const [];
  final threads = await ref.watch(threadListProvider.future);
  final items = <ThreadAttentionItem>[
    for (final thread in threads)
      if (thread.status == 'awaiting_plan')
        ThreadAttentionItem(
          id: 'plan:${thread.id}',
          threadId: thread.id,
          title: _threadAttentionTitle(thread),
          kind: ThreadAttentionKind.plan,
          updatedAt: thread.updatedAt,
        ),
  ];

  final bashItems = await Future.wait(
    threads.where((thread) => thread.status == 'running').map((thread) async {
      final approval = await rpc.getPendingBashApproval(thread.id);
      if (approval == null) return null;
      return ThreadAttentionItem(
        id: 'bash:${thread.id}:${approval.toolUseId}',
        threadId: thread.id,
        title: _threadAttentionTitle(thread),
        kind: ThreadAttentionKind.bash,
        updatedAt: thread.updatedAt,
        detail: _bashAttentionDetail(approval),
      );
    }),
  );
  items.addAll(bashItems.whereType<ThreadAttentionItem>());
  items.sort((left, right) {
    final kindOrder = left.kind.index.compareTo(right.kind.index);
    return kindOrder != 0
        ? kindOrder
        : right.updatedAt.compareTo(left.updatedAt);
  });
  return items;
});

String _threadAttentionTitle(ThreadSummary thread) {
  final title = thread.title.trim();
  if (title.isNotEmpty) return title;
  final prompt = thread.prompt.trim();
  if (prompt.isNotEmpty) return prompt;
  return thread.id;
}

String? _bashAttentionDetail(BashApprovalRequest approval) {
  final filesystemTool = approval.filesystemTool?.trim();
  final filesystemPath = approval.filesystemPath?.trim();
  if (filesystemTool?.isNotEmpty == true &&
      filesystemPath?.isNotEmpty == true) {
    return '$filesystemTool $filesystemPath';
  }
  return approval.command.trim().isNotEmpty
      ? approval.command.trim()
      : approval.description?.trim().isNotEmpty == true
      ? approval.description!.trim()
      : approval.reason.trim().isNotEmpty
      ? approval.reason.trim()
      : null;
}

class ThreadListNotifier extends AsyncNotifier<List<ThreadSummary>> {
  @override
  Future<List<ThreadSummary>> build() async {
    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null) return [];

    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData((event) {
        final payload = event.payload;
        if (payload is! Map<String, dynamic>) return;
        final live = ThreadLiveEvent.fromJson(payload);
        if (_shouldRefreshThreadListFromLiveEvent(live)) {
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
  final settings = await rpc.getModelSettings();
  unawaited(warmGlobalSettingsDigestCache(ref));
  return settings;
});

final candidateModelsProvider =
    FutureProvider.family<List<CandidateModelView>, String>((
      ref,
      providerId,
    ) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null || providerId.trim().isEmpty) return const [];
      return rpc.listCandidateModels(providerId);
    });

final cursorModelsProvider = FutureProvider<List<CursorModelOption>>((
  ref,
) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return const [];
  return rpc.listCursorModels();
});

final auxiliaryModelOptionsProvider =
    FutureProvider.family<List<CommitModelOptionView>, String>((
      ref,
      mainAgentConfigId,
    ) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null) return const [];
      final result = await rpc.listCommitModelOptions(
        mainAgentConfigId: mainAgentConfigId,
      );
      return result.options;
    });

final workflowSettingsProvider = FutureProvider<WorkflowSettingsSnapshot?>((
  ref,
) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  final settings = await rpc.getWorkflowSettings();
  unawaited(warmGlobalSettingsDigestCache(ref));
  return settings;
});

final integrationAvailabilityProvider =
    FutureProvider<IntegrationAvailabilitySnapshot?>((ref) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null) return null;
      return rpc.getIntegrationAvailability();
    });

final projectIntegrationsSettingsProvider =
    FutureProvider.family<ProjectIntegrationsSettingsSnapshot?, String>((
      ref,
      workspacePath,
    ) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null || workspacePath.trim().isEmpty) return null;
      return rpc.getProjectIntegrationsSettings(workspacePath);
    });

final mcpSettingsProvider = FutureProvider<McpSettingsSnapshot?>((ref) async {
  final modelSettings = await ref.watch(modelSettingsProvider.future);
  final embedded = modelSettings?.mcpSettings;
  if (embedded != null) {
    return embedded;
  }

  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) return null;
  try {
    return await rpc.getMcpSettings();
  } catch (_) {
    return null;
  }
});

final composerSkillsProvider = FutureProvider.family<SkillsListResult?, String>(
  (ref, workspacePath) async {
    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null || workspacePath.trim().isEmpty) return null;
    try {
      return await rpc.listSkills(workspacePath);
    } catch (_) {
      return null;
    }
  },
);

final projectSkillsSettingsProvider =
    FutureProvider.family<ProjectSkillsSettingsSnapshot?, String>((
      ref,
      workspacePath,
    ) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null || workspacePath.trim().isEmpty) return null;
      try {
        return await rpc.getProjectSkillsSettings(workspacePath);
      } catch (_) {
        return null;
      }
    });

final projectOrchestrationSettingsProvider =
    FutureProvider.family<ProjectOrchestrationSettingsSnapshot?, String>((
      ref,
      workspacePath,
    ) async {
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null || workspacePath.trim().isEmpty) return null;
      return rpc.getProjectOrchestrationSettings(workspacePath);
    });

ThreadRuntimeConfig defaultRuntimeConfig({
  ModelSettingsSnapshot? modelSettings,
  WorkflowSettingsSnapshot? workflow,
  List<McpServerConfigView>? mcpServers,
}) {
  return buildDefaultRuntimeConfig(
    modelSettings: modelSettings,
    workflow: workflow,
    mcpServers: mcpServers,
  );
}

String normalizeWorkspacePathKey(String workspacePath) {
  var normalized = workspacePath.trim();
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.substring(0, normalized.length - 1);
  }
  return normalized;
}

void refreshWorkspaceChanges(WidgetRef ref, String workspacePath) {
  if (workspacePath.isEmpty) return;
  ref
      .read(workspaceGitStatusPushProvider.notifier)
      .clearForWorkspace(workspacePath);
  ref.invalidate(gitStatusProvider(workspacePath));
  ref.invalidate(workspaceDiffProvider(workspacePath));
}

final workspaceGitStatusPushProvider =
    NotifierProvider<
      WorkspaceGitStatusPushNotifier,
      Map<String, WorkspaceChangesSummary>
    >(WorkspaceGitStatusPushNotifier.new);

class WorkspaceGitStatusPushNotifier
    extends Notifier<Map<String, WorkspaceChangesSummary>> {
  @override
  Map<String, WorkspaceChangesSummary> build() {
    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData(_handleEvent);
    });
    return const {};
  }

  void _handleEvent(EcoEventEnvelope event) {
    if (event.kind != 'workspace.git_status_changed') {
      return;
    }
    final payload = event.payload;
    if (payload is! Map<String, dynamic>) {
      return;
    }

    final workspacePath = payload['workspacePath'] as String?;
    if (workspacePath == null || workspacePath.trim().isEmpty) {
      return;
    }

    final summary = WorkspaceChangesSummary(
      fileCount: (payload['dirtyFileCount'] as num?)?.toInt() ?? 0,
      totalAdditions: (payload['insertions'] as num?)?.toInt() ?? 0,
      totalDeletions: (payload['deletions'] as num?)?.toInt() ?? 0,
    );
    final key = normalizeWorkspacePathKey(workspacePath);
    final current = state[key];
    if (current != null &&
        current.fileCount == summary.fileCount &&
        current.totalAdditions == summary.totalAdditions &&
        current.totalDeletions == summary.totalDeletions) {
      return;
    }
    state = {...state, key: summary};
  }

  void clearForWorkspace(String workspacePath) {
    final key = normalizeWorkspacePathKey(workspacePath);
    if (!state.containsKey(key)) {
      return;
    }
    final next = Map<String, WorkspaceChangesSummary>.from(state);
    next.remove(key);
    state = next;
  }
}

final workspacePillSummaryProvider =
    Provider.family<WorkspaceChangesSummary?, String>((ref, workspacePath) {
      if (workspacePath.isEmpty) {
        return null;
      }
      final key = normalizeWorkspacePathKey(workspacePath);
      final pushed = ref.watch(workspaceGitStatusPushProvider)[key];
      if (pushed != null) {
        return pushed;
      }
      return ref
          .watch(gitStatusProvider(workspacePath))
          .valueOrNull
          ?.toChangesSummary();
    });

final workspacePillLoadingProvider = Provider.family<bool, String>((
  ref,
  workspacePath,
) {
  if (workspacePath.isEmpty) {
    return false;
  }
  final key = normalizeWorkspacePathKey(workspacePath);
  if (ref.watch(workspaceGitStatusPushProvider).containsKey(key)) {
    return false;
  }
  final gitAsync = ref.watch(gitStatusProvider(workspacePath));
  return gitAsync.isLoading || gitAsync.isReloading;
});

final workspaceDiffProvider =
    FutureProvider.family<WorkspaceDiffResult?, String>((
      ref,
      workspacePath,
    ) async {
      if (workspacePath.isEmpty) return null;
      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null) return null;

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
    this.titleGenerating = false,
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
  final bool titleGenerating;

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
    bool? titleGenerating,
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
      titleGenerating: titleGenerating ?? this.titleGenerating,
    );
  }
}

final threadSessionProvider = StateNotifierProvider.autoDispose
    .family<ThreadSessionNotifier, ThreadSessionState, String>(
      (ref, threadId) => ThreadSessionNotifier(threadId, ref),
    );

class ThreadSessionNotifier extends StateNotifier<ThreadSessionState> {
  ThreadSessionNotifier(this.threadId, this.ref)
    : super(const ThreadSessionState()) {
    _init();
  }

  final String threadId;
  final Ref ref;
  bool _centerConnectionWasInterrupted = false;
  bool _selectedDesktopWasOffline = false;
  bool _projectionSynchronized = false;
  Future<ThreadRunProjectionSnapshot?>? _projectionRequestInFlight;
  Future<void>? _earlierProjectionRequestInFlight;
  final _loadedProjectionDetailKeys = <String>{};

  Future<void> loadEarlierProjection() {
    final pending = _earlierProjectionRequestInFlight;
    if (pending != null) {
      return pending;
    }
    final request = _loadEarlierProjectionPage();
    _earlierProjectionRequestInFlight = request;
    return request.whenComplete(() {
      if (identical(_earlierProjectionRequestInFlight, request)) {
        _earlierProjectionRequestInFlight = null;
      }
    });
  }

  Future<void> _loadEarlierProjectionPage() async {
    final projection = state.runProjection;
    if (projection == null || !projection.hasEarlier) {
      return;
    }
    if (projection.timeline.isEmpty) {
      throw StateError(
        'Feed projection reports earlier history without a timeline cursor.',
      );
    }
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      throw const AppErrorCodeException(
        AppErrorCode.threadProjectionNoPcSelected,
      );
    }
    final historyRevision = projection.historyRevision;
    final beforeSequence = projection.timeline.first.sequence;
    final detail = await rpc.getRunProjectionDetail(
      threadId: threadId,
      kind: 'main',
      key: threadId,
      beforeSequence: beforeSequence,
      tail: true,
      limit: 100,
      includeToolOutputPreview: false,
    );
    if (!mounted) return;
    if (detail == null) {
      throw StateError('Desktop returned no earlier Feed history page.');
    }
    if (state.runProjection?.historyRevision != historyRevision) {
      return;
    }
    if (detail.timeline.isEmpty && detail.hasEarlier) {
      throw StateError(
        'Desktop returned an empty Feed history page with hasEarlier=true.',
      );
    }
    state = state.copyWith(
      runProjection: mergeThreadRunProjectionDetailResult(
        state.runProjection,
        detail,
      ),
    );
  }

  Future<void> recoverProjection({bool rethrowOnError = false}) async {
    if (!mounted) {
      return;
    }
    try {
      final projection = await _requestProjection();
      _projectionSynchronized = true;
      if (projection == null) {
        if (rethrowOnError) {
          throw StateError(
            'Desktop returned no Feed projection after rewrite.',
          );
        }
        return;
      }
      if (!mounted) {
        return;
      }
      state = state.copyWith(
        runProjection: _pickNewerProjection(state.runProjection, projection),
      );
    } catch (error) {
      if (rethrowOnError) rethrow;
    }
  }

  Future<void> acceptRewrittenThread(ThreadSummary thread) async {
    if (!mounted) return;
    state = state.copyWith(
      thread: thread,
      clearPlan: true,
      clearBash: true,
      clearClarification: true,
      clearProjection: true,
    );
    ref.invalidate(threadListProvider);
    await recoverProjection(rethrowOnError: true);
  }

  Future<ThreadRunProjectionSnapshot?> _requestProjection({
    bool initial = false,
  }) async {
    final pending = _projectionRequestInFlight;
    if (pending != null) {
      return pending;
    }
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      return null;
    }
    final request = rpc.getRunProjection(
      threadId,
      mode: 'feed',
      afterSequence: initial
          ? null
          : _projectionCachedAfterSequence(state.runProjection),
      historyRevision: initial ? null : state.runProjection?.historyRevision,
    );
    _projectionRequestInFlight = request;
    try {
      return await request;
    } finally {
      if (identical(_projectionRequestInFlight, request)) {
        _projectionRequestInFlight = null;
      }
    }
  }

  Future<ThreadRunProjectionDetailResult?> loadProjectionDetail({
    required String kind,
    required String key,
  }) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      throw const AppErrorCodeException(
        AppErrorCode.threadProjectionNoPcSelected,
      );
    }
    final detailKey = '$kind:$key';
    var afterSequence = _loadedProjectionDetailKeys.contains(detailKey)
        ? _projectionDetailCachedAfterSequence(state.runProjection, kind, key)
        : null;
    ThreadRunProjectionDetailResult? latest;
    try {
      while (true) {
        final detail = await rpc.getRunProjectionDetail(
          threadId: threadId,
          kind: kind,
          key: key,
          afterSequence: afterSequence,
          limit: 500,
        );
        if (!mounted || detail == null) {
          return latest;
        }
        latest = _appendProjectionDetailPage(latest, detail);
        state = state.copyWith(
          runProjection: mergeThreadRunProjectionDetailResult(
            state.runProjection,
            detail,
          ),
        );
        final nextAfterSequence = detail.nextAfterSequence;
        if (!detail.hasMore) {
          _loadedProjectionDetailKeys.add(detailKey);
          return latest;
        }
        if (nextAfterSequence == null || nextAfterSequence == afterSequence) {
          throw StateError('Projection detail pagination did not advance');
        }
        afterSequence = nextAfterSequence;
      }
    } catch (error, stackTrace) {
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> _init() async {
    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData(_handleEvent);
    });

    ref.listen(connectionStatusProvider, (_, next) {
      next.whenData((status) {
        if (status.state == EcoConnectionState.disconnected ||
            status.state == EcoConnectionState.error) {
          _centerConnectionWasInterrupted = true;
          _projectionSynchronized = false;
          return;
        }
        if (status.state != EcoConnectionState.connected) {
          return;
        }
        if (!_centerConnectionWasInterrupted && _projectionSynchronized) {
          return;
        }
        _centerConnectionWasInterrupted = false;
        unawaited(_refreshFollowUpsFromRpc());
        unawaited(recoverProjection());
      });
    });

    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      state = state.copyWith(
        loading: false,
        error: threadNoPcSelectedErrorCode,
      );
      return;
    }

    final seed = ref.read(threadSessionSeedProvider);
    ThreadSummary? seededThread;
    if (seed != null && seed.id == threadId) {
      seededThread = seed;
      ref.read(threadSessionSeedProvider.notifier).state = null;
    }
    final cachedThread = seededThread ?? _threadFromCacheSync();
    if (cachedThread != null) {
      // Show session chrome immediately; bootstrap continues below.
      state = state.copyWith(thread: cachedThread, loading: false);
    }

    try {
      final results = await Future.wait([
        rpc.sessionBootstrap(threadId),
        _requestProjection(initial: true),
      ]);
      final bootstrap = results[0] as ThreadSessionBootstrapResult;
      final projection = results[1] as ThreadRunProjectionSnapshot?;
      _projectionSynchronized = true;
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
      final bootstrappedRuntimeConfig = thread?.runtimeConfig;
      if (bootstrappedRuntimeConfig != null &&
          ref.read(runtimeConfigProvider) == null) {
        ref.read(runtimeConfigProvider.notifier).state =
            bootstrappedRuntimeConfig;
      }
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
    if (_handleSelectedDesktopPresenceEvent(event, payload)) {
      return;
    }
    final live = ThreadLiveEvent.fromJson(payload);
    final eventThreadId = resolveThreadEventThreadId(
      envelopeThreadId: event.threadId,
      payloadThreadId: live.threadId,
    );
    if (eventThreadId != threadId) return;

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
          runProjection: _pickNewerProjection(
            state.runProjection,
            live.projection,
          ),
        );
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

    if (live.titleGenerating != null) {
      state = state.copyWith(titleGenerating: live.titleGenerating);
    }

    if (live.runtimeConfig != null) {
      final config = live.runtimeConfig!;
      if (state.thread != null) {
        state = state.copyWith(
          thread: state.thread!.copyWith(runtimeConfig: config),
        );
      }
      ref.read(runtimeConfigProvider.notifier).state = config;
      if (config.mcpServersEnabled != null) {
        ref.invalidate(workflowSettingsProvider);
      }
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
          cancelling: resolveThreadCancellingFromLiveEvent(
            nextStatus: threadStatusFromLiveEvent(live.type, thread.status),
            currentCancelling: thread.cancelling,
            eventCancelling: live.cancelling,
          ),
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
        state = state.copyWith(pendingBash: bash, clearBash: bash == null);
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
    if (_shouldRefreshThreadListFromLiveEvent(live)) {
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
        final mergedThread = state.thread == null
            ? thread
            : mergeThreadSummaryFromRemoteList(
                current: state.thread!,
                listed: thread,
              );
        if (pendingPlanActive &&
            mergedThread.status != 'awaiting_plan' &&
            mergedThread.status != 'running') {
          ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
            if (!mounted) return;
            state = state.copyWith(
              pendingPlan: plan,
              clearPlan: plan == null,
              thread: mergedThread,
            );
          });
          return;
        }
        if ((mergedThread.status == 'awaiting_plan' ||
                mergedThread.status == 'running') &&
            state.pendingPlan == null) {
          ref.read(desktopRpcProvider)?.getPendingPlan(threadId).then((plan) {
            if (!mounted) return;
            state = state.copyWith(pendingPlan: plan, thread: mergedThread);
          });
          return;
        }
        state = state.copyWith(thread: mergedThread);
      });
    }
  }

  bool _handleSelectedDesktopPresenceEvent(
    EcoEventEnvelope event,
    Map<String, dynamic> payload,
  ) {
    if (event.kind != presenceDeviceEventKind) {
      return false;
    }
    final selectedDesktopId = ref.read(selectedDesktopIdProvider);
    if (selectedDesktopId == null || payload['deviceId'] != selectedDesktopId) {
      return false;
    }
    if (payload['online'] != true) {
      _selectedDesktopWasOffline = true;
      _projectionSynchronized = false;
      return true;
    }
    if (_selectedDesktopWasOffline || !_projectionSynchronized) {
      _selectedDesktopWasOffline = false;
      unawaited(_refreshFollowUpsFromRpc());
      unawaited(recoverProjection());
    }
    return true;
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
    final cached = _threadFromCacheSync();
    if (cached?.runtimeConfig != null) return cached;
    return rpc.getThread(threadId);
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

  Future<void> resolveBash(
    String toolUseId,
    String decision, {
    String? feedback,
  }) async {
    await ref
        .read(desktopRpcProvider)
        ?.resolveBashApproval(
          toolUseId: toolUseId,
          decision: decision,
          feedback: feedback,
        );
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

  Future<void> dismissClarification(String toolUseId) async {
    final rpc = ref.read(desktopRpcProvider);
    await rpc?.dismissClarification(toolUseId);
    if (!mounted) return;
    state = state.copyWith(clearClarification: true);
  }
}

ThreadRunProjectionSnapshot? _pickNewerProjection(
  ThreadRunProjectionSnapshot? current,
  ThreadRunProjectionSnapshot? incoming,
) {
  if (current == null) return incoming;
  if (incoming == null) return current;
  if (current.historyRevision != incoming.historyRevision) {
    return mergeThreadRunProjectionSnapshots(current, incoming);
  }
  final incomingIsNewer =
      incoming.generatedAt.compareTo(current.generatedAt) >= 0 ||
      incoming.sourceEventCount >= current.sourceEventCount;
  if (incomingIsNewer) {
    return mergeThreadRunProjectionSnapshots(current, incoming);
  }
  return current;
}

int? _projectionDetailCachedAfterSequence(
  ThreadRunProjectionSnapshot? projection,
  String kind,
  String key,
) {
  if (projection == null) return null;
  Iterable<ThreadRunProjectionTimelineItem> timeline;
  if (kind == 'agent') {
    final agent = projection.agents
        .where((candidate) => candidate.agentId == key)
        .firstOrNull;
    timeline = agent?.timeline ?? const [];
  } else if (kind == 'tool') {
    timeline = [
      ...projection.timeline,
      for (final agent in projection.agents) ...agent.timeline,
    ].where((item) => _projectionTimelineToolUseId(item) == key);
  } else {
    return null;
  }
  int? maxSequence;
  for (final item in timeline) {
    if (maxSequence == null || item.sequence > maxSequence) {
      maxSequence = item.sequence;
    }
  }
  return maxSequence;
}

String? _projectionTimelineToolUseId(ThreadRunProjectionTimelineItem item) {
  final tool = item.metadata?['tool'];
  if (tool is Map<String, dynamic>) {
    final toolUseId = (tool['toolUseId'] as String?)?.trim();
    if (toolUseId != null && toolUseId.isNotEmpty) {
      return toolUseId;
    }
  }
  final bashApproval = item.metadata?['bashApproval'];
  if (bashApproval is Map<String, dynamic>) {
    final toolUseId = (bashApproval['toolUseId'] as String?)?.trim();
    if (toolUseId != null && toolUseId.isNotEmpty) {
      return toolUseId;
    }
  }
  return null;
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

ThreadRunProjectionDetailResult _appendProjectionDetailPage(
  ThreadRunProjectionDetailResult? current,
  ThreadRunProjectionDetailResult page,
) {
  if (current == null) {
    return page;
  }
  return ThreadRunProjectionDetailResult(
    threadId: page.threadId,
    kind: page.kind,
    key: page.key,
    generatedAt: page.generatedAt,
    sourceEventCount: page.sourceEventCount,
    hasMore: page.hasMore,
    hasEarlier: page.hasEarlier,
    nextAfterSequence: page.nextAfterSequence,
    previousBeforeSequence: page.previousBeforeSequence,
    agent: page.agent ?? current.agent,
    timeline: [...current.timeline, ...page.timeline],
  );
}

int? _projectionCachedAfterSequence(ThreadRunProjectionSnapshot? projection) {
  if (projection == null) return null;
  int? maxSequence;
  final timeline = [
    ...projection.timeline,
    for (final agent in projection.agents) ...agent.timeline,
  ];
  for (final item in timeline) {
    if (maxSequence == null || item.sequence > maxSequence) {
      maxSequence = item.sequence;
    }
  }
  return maxSequence;
}

bool _shouldRefreshThreadListFromLiveEvent(ThreadLiveEvent live) {
  if (live.title?.trim().isNotEmpty == true) return true;
  if (live.runtimeConfig != null) return true;
  return shouldUpdateThreadSummaryFromLiveEvent(live.type);
}
