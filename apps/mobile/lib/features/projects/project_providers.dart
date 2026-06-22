import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/network/desktop_rpc.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../threads/thread_providers.dart';

String _selectedProjectKey(String desktopId) =>
    'eco.selected_project.$desktopId';

String _collapsedProjectsKey(String desktopId) =>
    'eco.collapsed_projects.$desktopId';

final threadsByProjectProvider =
    Provider<Map<String, List<ThreadSummary>>>((ref) {
  final threads = ref.watch(threadListProvider).valueOrNull ?? const [];
  return groupThreadsByProject(threads);
});

final projectListProvider =
    AsyncNotifierProvider<ProjectListNotifier, List<EcoProject>>(
  ProjectListNotifier.new,
);

class ProjectListNotifier extends AsyncNotifier<List<EcoProject>> {
  @override
  Future<List<EcoProject>> build() async {
    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null) return [];

    ref.listen(threadListProvider, (_, _) {
      ref.invalidateSelf();
    });

    return _loadProjects(rpc);
  }

  Future<List<EcoProject>> _loadProjects(DesktopRpc rpc) async {
    final threads = await rpc.listThreads();
    var homePath = '';
    try {
      homePath = await rpc.getHomeProjectPath();
    } catch (_) {
      // Older Center Server builds may not expose workspace:get-home-path yet.
    }
    final currentWorkspace = await rpc.getCurrentWorkspace();

    final paths = collectProjectPaths(
      homeProjectPath: homePath,
      currentWorkspace: currentWorkspace,
      threads: threads,
    );
    final grouped = groupThreadsByProject(threads);

    final projects = <EcoProject>[];
    for (final path in paths) {
      WorkspaceInfo? inspected;
      try {
        inspected = await rpc.inspectWorkspace(path);
      } catch (_) {
        inspected = currentWorkspace?.path == path ? currentWorkspace : null;
      }
      final normalizedPath = normalizeProjectPath(path);
      projects.add(
        buildEcoProject(
          path: normalizedPath,
          homeProjectPath: homePath,
          inspected: inspected,
          threadCount: grouped[normalizedPath]?.length ?? 0,
        ),
      );
    }

    return sortProjectsByActivity(
      projects,
      grouped: grouped,
      currentWorkspacePath: currentWorkspace?.path,
    );
  }

  Future<void> refresh() async {
    ref.invalidate(threadListProvider);
    ref.invalidateSelf();
  }

  Future<WorkspaceInfo> openProjectPath(String path) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      throw StateError('未选择 PC');
    }
    final workspace = await rpc.openWorkspacePath(path);
    await ref.read(selectedProjectPathProvider.notifier).select(path);
    await ref.read(collapsedProjectPathsProvider.notifier).expand(path);
    state = AsyncData(await _loadProjects(rpc));
    return workspace;
  }
}

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

    final rpc = ref.watch(desktopRpcProvider);
    if (rpc == null) return null;

    try {
      final current = await rpc.getCurrentWorkspace();
      return current?.path;
    } catch (_) {
      return null;
    }
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
    } catch (_) {
      // Desktop sync is best-effort; local selection still applies.
    }
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
