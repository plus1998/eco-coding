import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../threads/thread_providers.dart';

String _selectedProjectKey(String desktopId) =>
    'eco.selected_project.$desktopId';

String _collapsedProjectsKey(String desktopId) =>
    'eco.collapsed_projects.$desktopId';

String _pinnedProjectsKey(String desktopId) =>
    'eco.pinned_projects.$desktopId';

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

final threadsByProjectProvider =
    Provider<Map<String, List<ThreadSummary>>>((ref) {
  final threads = ref.watch(threadListProvider).valueOrNull ?? const [];
  final pinnedThreadIds = ref.watch(pinnedThreadIdsProvider).toSet();
  final grouped = groupThreadsByProject(threads);
  return {
    for (final entry in grouped.entries)
      entry.key: sortThreadsForSidebar(entry.value, pinnedThreadIds),
  };
});

final projectWorkspaceContextProvider =
    FutureProvider<ProjectWorkspaceContext>((ref) async {
  final rpc = ref.watch(desktopRpcProvider);
  if (rpc == null) {
    return const ProjectWorkspaceContext(homeProjectPath: '');
  }

  var homePath = '';
  try {
    homePath = await rpc.getHomeProjectPath();
  } catch (_) {
    // Older Center Server builds may not expose workspace:get-home-path yet.
  }

  WorkspaceInfo? currentWorkspace;
  try {
    currentWorkspace = await rpc.getCurrentWorkspace();
  } catch (_) {
    currentWorkspace = null;
  }

  return ProjectWorkspaceContext(
    homeProjectPath: homePath,
    currentWorkspace: currentWorkspace,
  );
});

/// Projects derived from [threadListProvider] + workspace context.
/// Thread list updates only recompute locally; no per-project inspect RPCs.
final projectListProvider = Provider<AsyncValue<List<EcoProject>>>((ref) {
  final threadsAsync = ref.watch(threadListProvider);
  final contextAsync = ref.watch(projectWorkspaceContextProvider);
  final selectedPath = ref.watch(selectedProjectPathProvider).valueOrNull;

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
  ref.invalidate(threadListProvider);
  ref.invalidate(projectWorkspaceContextProvider);
  await ref.read(threadListProvider.future);
  await ref.read(projectWorkspaceContextProvider.future);
}

Future<WorkspaceInfo> openProjectPath(WidgetRef ref, String path) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) {
    throw StateError('未选择 PC');
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

  @override
  Set<String> build() {
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

  @override
  List<String> build() {
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

  @override
  List<String> build() {
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

  @override
  Set<String> build() {
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
    if (selected != null &&
        normalizeProjectPath(selected) == normalized) {
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
