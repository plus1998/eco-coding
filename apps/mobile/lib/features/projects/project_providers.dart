import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/project_models.dart';
import '../../core/models/app_error.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_session.dart';
import '../../core/providers/desktop_bind_ready.dart';
import '../threads/thread_providers.dart';

String _selectedProjectKey(String desktopId) =>
    'eco.selected_project.$desktopId';

String _collapsedProjectsKey(String desktopId) =>
    'eco.collapsed_projects.$desktopId';

String _pinnedProjectsKey(String desktopId) => 'eco.pinned_projects.$desktopId';

String _pinnedThreadsKey(String desktopId) => 'eco.pinned_threads.$desktopId';

String _hiddenProjectsKey(String desktopId) => 'eco.hidden_projects.$desktopId';

class ProjectWorkspaceContext {
  const ProjectWorkspaceContext({
    required this.homeProjectPath,
    this.currentWorkspace,
  });

  final String homeProjectPath;
  final WorkspaceInfo? currentWorkspace;
}

final threadsByProjectProvider = Provider<Map<String, List<ThreadSummary>>>((
  ref,
) {
  final threads = ref.watch(threadListProvider).valueOrNull ?? const [];
  final pinnedThreadIds = ref.watch(pinnedThreadIdsProvider).toSet();
  final grouped = groupThreadsByProject(threads);
  return {
    for (final entry in grouped.entries)
      entry.key: sortThreadsForSidebar(entry.value, pinnedThreadIds),
  };
});

final projectWorkspaceContextProvider = FutureProvider<ProjectWorkspaceContext>(
  (ref) async {
    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null) {
      return const ProjectWorkspaceContext(homeProjectPath: '');
    }

    final ready = await ensureDesktopBindReady(ref);
    if (!ready) {
      ref.listen(connectionStatusProvider, (previous, next) {
        next.whenData((status) {
          if (status.state != EcoConnectionState.connected) return;
          final wasConnected =
              previous?.valueOrNull?.state == EcoConnectionState.connected;
          if (!wasConnected) {
            ref.invalidateSelf();
          }
        });
      });
      return const ProjectWorkspaceContext(homeProjectPath: '');
    }

    ref.listen(connectionStatusProvider, (previous, next) {
      next.whenData((status) {
        if (status.state != EcoConnectionState.connected) return;
        final wasConnected =
            previous?.valueOrNull?.state == EcoConnectionState.connected;
        if (!wasConnected) {
          ref.invalidateSelf();
        }
      });
    });

    var homePath = '';
    try {
      homePath = await withDesktopRpcRetry(rpc.getHomeProjectPath);
    } catch (_) {
      // Older Center Server builds may not expose workspace:get-home-path yet.
    }

    WorkspaceInfo? currentWorkspace;
    try {
      currentWorkspace = await withDesktopRpcRetry(rpc.getCurrentWorkspace);
    } catch (_) {
      currentWorkspace = null;
    }

    return ProjectWorkspaceContext(
      homeProjectPath: homePath,
      currentWorkspace: currentWorkspace,
    );
  },
);

/// Projects derived from [threadListProvider] + workspace context.
/// Thread list updates only recompute locally; no per-project inspect RPCs.
final projectListProvider = Provider<AsyncValue<List<EcoProject>>>((ref) {
  final threadsAsync = ref.watch(threadListProvider);
  final contextAsync = ref.watch(projectWorkspaceContextProvider);
  final selectedPath = ref.watch(selectedProjectPathProvider).valueOrNull;
  final rpc = ref.watch(desktopRpcProvider);
  final client = ref.watch(ecoCenterClientProvider);
  ref.watch(credentialsProvider);
  final pendingDesktop =
      ref.watch(selectedDesktopIdProvider) ??
      client.credentials.selectedDesktopId;
  final hasPendingDesktop = pendingDesktop != null && pendingDesktop.isNotEmpty;
  final sessionAsync = ref.watch(appSessionProvider);
  // Bootstrapping session or RPC for a saved desktop — keep loading instead of
  // flashing the empty projects state.
  if (hasPendingDesktop && (sessionAsync.isLoading || rpc == null)) {
    return const AsyncValue.loading();
  }

  if (threadsAsync.isLoading || !threadsAsync.hasValue) {
    if (threadsAsync.hasError) {
      return AsyncValue.error(threadsAsync.error!, threadsAsync.stackTrace!);
    }
    return const AsyncValue.loading();
  }
  if (contextAsync.isLoading || !contextAsync.hasValue) {
    if (contextAsync.hasError) {
      return AsyncValue.error(contextAsync.error!, contextAsync.stackTrace!);
    }
    return const AsyncValue.loading();
  }

  final threads = threadsAsync.requireValue;
  final context = contextAsync.requireValue;
  return AsyncValue.data(
    assembleProjectsFromThreads(
      threads: threads,
      homeProjectPath: context.homeProjectPath,
      currentWorkspace: context.currentWorkspace,
      currentWorkspacePath: selectedPath ?? context.currentWorkspace?.path,
    ),
  );
});

Future<void> refreshProjectsAndThreads(WidgetRef ref) async {
  final client = ref.read(ecoCenterClientProvider);
  if (!client.hasActiveBindingChannel) {
    try {
      await client.connect();
    } catch (_) {
      // Still refresh so the list UI can surface the error.
    }
  }
  ref.invalidate(projectWorkspaceContextProvider);
  ref.invalidate(threadAttentionProvider);
  ref.invalidate(modelSettingsProvider);
  ref.invalidate(workflowSettingsProvider);
  ref.invalidate(integrationAvailabilityProvider);
  await Future.wait([
    ref.read(threadListProvider.notifier).refresh(),
    ref.read(projectWorkspaceContextProvider.future),
  ]);
}

typedef ProviderInvalidator = void Function(ProviderOrFamily provider);

/// Clears desktop-scoped caches when the controlled PC changes.
void resetDesktopScopedProviders(ProviderInvalidator invalidate) {
  invalidate(threadListProvider);
  invalidate(threadListPageMetadataProvider);
  invalidate(projectWorkspaceContextProvider);
  invalidate(threadAttentionProvider);
  invalidate(modelSettingsProvider);
  invalidate(workflowSettingsProvider);
  invalidate(integrationAvailabilityProvider);
}

/// Refreshes thread/project caches when the controlled desktop changes.
final desktopSwitchBootstrapProvider = Provider<void>((ref) {
  ref.listen<String?>(selectedDesktopIdProvider, (previous, next) {
    if (previous == null || previous == next) return;
    resetDesktopScopedProviders(ref.invalidate);
  });
});

Future<WorkspaceInfo> openProjectPath(WidgetRef ref, String path) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) {
    throw const AppErrorCodeException(AppErrorCode.threadNoPcSelected);
  }
  refreshWorkspaceChanges(ref, path);
  final workspace = await rpc.openWorkspacePath(path);
  await ref.read(hiddenProjectPathsProvider.notifier).unhide(path);
  await ref.read(selectedProjectPathProvider.notifier).select(path);
  await ref.read(collapsedProjectPathsProvider.notifier).expand(path);
  ref.invalidate(projectWorkspaceContextProvider);
  await ref.read(projectWorkspaceContextProvider.future);
  return workspace;
}

final displayProjectsProvider = Provider<AsyncValue<List<EcoProject>>>((ref) {
  final projectsAsync = ref.watch(projectListProvider);
  final pinnedPaths = ref.watch(pinnedProjectPathsProvider);
  final hiddenPaths = ref.watch(hiddenProjectPathsProvider);
  final threadsByProject = ref.watch(threadsByProjectProvider);
  final selectedPath = ref.watch(selectedProjectPathProvider).valueOrNull;

  return projectsAsync.whenData((projects) {
    final visible = filterVisibleProjects(projects, hiddenPaths);
    return sortProjectsForDisplay(
      visible,
      pinnedPaths: pinnedPaths,
      grouped: threadsByProject,
      currentWorkspacePath: selectedPath,
    );
  });
});

final selectedProjectPathProvider =
    AsyncNotifierProvider<SelectedProjectPathNotifier, String?>(
      SelectedProjectPathNotifier.new,
    );

class SelectedProjectPathNotifier extends AsyncNotifier<String?> {
  @override
  Future<String?> build() async {
    final desktopId = ref.watch(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return null;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_selectedProjectKey(desktopId));
    if (saved != null && saved.isNotEmpty) {
      return saved;
    }

    final context = await ref.watch(projectWorkspaceContextProvider.future);
    return context.currentWorkspace?.path;
  }

  Future<void> select(String path) async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    state = AsyncData(path);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedProjectKey(desktopId), path);

    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    try {
      await rpc.openWorkspacePath(path);
      ref.read(workspaceGitStatusPushProvider.notifier).clearForWorkspace(path);
      ref.invalidate(gitStatusProvider(path));
    } catch (_) {
      // Desktop sync is best-effort; local selection still applies.
    }
  }

  Future<void> clear() async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    state = const AsyncData(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_selectedProjectKey(desktopId));
  }
}

final collapsedProjectPathsProvider =
    NotifierProvider<CollapsedProjectPathsNotifier, Set<String>>(
      CollapsedProjectPathsNotifier.new,
    );

class CollapsedProjectPathsNotifier extends Notifier<Set<String>> {
  bool _loaded = false;
  bool _defaultsApplied = false;
  bool? _hasPersistedState;
  String? _activeDesktopId;

  @override
  Set<String> build() {
    final desktopId = ref.watch(selectedDesktopIdProvider);
    if (desktopId != _activeDesktopId) {
      _activeDesktopId = desktopId;
      _loaded = false;
      _defaultsApplied = false;
      _hasPersistedState = null;
    }
    _load();
    return {};
  }

  bool isProjectCollapsed(EcoProject project) {
    if (project.isHome && !_defaultsApplied) {
      return true;
    }
    return state.contains(project.path);
  }

  Future<void> applyProjectDefaults(List<EcoProject> projects) async {
    if (_defaultsApplied) return;
    await _load();
    if (_defaultsApplied) return;

    if (_hasPersistedState == true) {
      _defaultsApplied = true;
      return;
    }

    EcoProject? homeProject;
    for (final project in projects) {
      if (project.isHome) {
        homeProject = project;
        break;
      }
    }
    if (homeProject != null && !state.contains(homeProject.path)) {
      state = {...state, homeProject.path};
      await _persist(state);
    }
    _defaultsApplied = true;
  }

  Future<void> _load() async {
    if (_loaded) return;
    _loaded = true;
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_collapsedProjectsKey(desktopId));
    _hasPersistedState = saved != null;
    if (saved != null) {
      state = saved.toSet();
      _defaultsApplied = true;
    }
  }

  Future<void> toggle(String path) async {
    final next = Set<String>.of(state);
    if (next.contains(path)) {
      next.remove(path);
    } else {
      next.add(path);
    }
    state = next;
    await _persist(next);
  }

  Future<void> expand(String path) async {
    if (!state.contains(path)) return;
    final next = Set<String>.of(state)..remove(path);
    state = next;
    await _persist(next);
  }

  Future<void> remove(String path) async {
    if (!state.contains(path)) return;
    final next = Set<String>.of(state)..remove(path);
    state = next;
    await _persist(next);
  }

  Future<void> _persist(Set<String> collapsed) async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _collapsedProjectsKey(desktopId),
      collapsed.toList(),
    );
  }
}

final pinnedProjectPathsProvider =
    NotifierProvider<PinnedProjectPathsNotifier, List<String>>(
      PinnedProjectPathsNotifier.new,
    );

class PinnedProjectPathsNotifier extends Notifier<List<String>> {
  bool _loaded = false;
  String? _activeDesktopId;

  @override
  List<String> build() {
    final desktopId = ref.watch(selectedDesktopIdProvider);
    if (desktopId != _activeDesktopId) {
      _activeDesktopId = desktopId;
      _loaded = false;
    }
    _load();
    return const [];
  }

  bool isPinned(String path) {
    final normalized = normalizeProjectPath(path);
    return state.any((item) => normalizeProjectPath(item) == normalized);
  }

  Future<void> pin(String path) async {
    await _load();
    final normalized = normalizeProjectPath(path);
    final next = [
      normalized,
      ...state.where((item) => normalizeProjectPath(item) != normalized),
    ];
    state = next;
    await _persist(next);
  }

  Future<void> unpin(String path) async {
    await _load();
    final normalized = normalizeProjectPath(path);
    final next = state
        .where((item) => normalizeProjectPath(item) != normalized)
        .toList();
    if (next.length == state.length) return;
    state = next;
    await _persist(next);
  }

  Future<void> _load() async {
    if (_loaded) return;
    _loaded = true;
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_pinnedProjectsKey(desktopId));
    if (saved != null) {
      state = saved;
    }
  }

  Future<void> _persist(List<String> pinned) async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_pinnedProjectsKey(desktopId), pinned);
  }
}

final pinnedThreadIdsProvider =
    NotifierProvider<PinnedThreadIdsNotifier, List<String>>(
      PinnedThreadIdsNotifier.new,
    );

class PinnedThreadIdsNotifier extends Notifier<List<String>> {
  bool _loaded = false;
  String? _activeDesktopId;

  @override
  List<String> build() {
    final desktopId = ref.watch(selectedDesktopIdProvider);
    if (desktopId != _activeDesktopId) {
      _activeDesktopId = desktopId;
      _loaded = false;
    }
    _load();
    return const [];
  }

  bool isPinned(String threadId) => state.contains(threadId);

  Future<void> pin(String threadId) async {
    await _load();
    if (state.contains(threadId)) return;
    state = [threadId, ...state];
    await _persist(state);
  }

  Future<void> unpin(String threadId) async {
    await _load();
    final next = state.where((id) => id != threadId).toList();
    if (next.length == state.length) return;
    state = next;
    await _persist(next);
  }

  Future<void> remove(String threadId) async {
    await unpin(threadId);
  }

  Future<void> _load() async {
    if (_loaded) return;
    _loaded = true;
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_pinnedThreadsKey(desktopId));
    if (saved != null) {
      state = saved;
    }
  }

  Future<void> _persist(List<String> pinned) async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_pinnedThreadsKey(desktopId), pinned);
  }
}

final hiddenProjectPathsProvider =
    NotifierProvider<HiddenProjectPathsNotifier, Set<String>>(
      HiddenProjectPathsNotifier.new,
    );

class HiddenProjectPathsNotifier extends Notifier<Set<String>> {
  bool _loaded = false;
  String? _activeDesktopId;

  @override
  Set<String> build() {
    final desktopId = ref.watch(selectedDesktopIdProvider);
    if (desktopId != _activeDesktopId) {
      _activeDesktopId = desktopId;
      _loaded = false;
    }
    _load();
    return {};
  }

  Future<void> removeProject(EcoProject project) async {
    if (project.isHome) return;
    await _load();
    final normalized = normalizeProjectPath(project.path);
    final next = {...state, normalized};
    state = next;
    await _persist(next);

    await ref.read(pinnedProjectPathsProvider.notifier).unpin(project.path);
    await ref.read(collapsedProjectPathsProvider.notifier).remove(project.path);

    final selected = ref.read(selectedProjectPathProvider).valueOrNull;
    if (selected != null && normalizeProjectPath(selected) == normalized) {
      await ref.read(selectedProjectPathProvider.notifier).clear();
    }
  }

  Future<void> unhide(String path) async {
    await _load();
    final normalized = normalizeProjectPath(path);
    if (!state.contains(normalized)) return;
    final next = Set<String>.of(state)..remove(normalized);
    state = next;
    await _persist(next);
  }

  Future<void> _load() async {
    if (_loaded) return;
    _loaded = true;
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getStringList(_hiddenProjectsKey(desktopId));
    if (saved != null) {
      state = saved.map(normalizeProjectPath).toSet();
    }
  }

  Future<void> _persist(Set<String> hidden) async {
    final desktopId = ref.read(selectedDesktopIdProvider);
    if (desktopId == null || desktopId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_hiddenProjectsKey(desktopId), hidden.toList());
  }
}
