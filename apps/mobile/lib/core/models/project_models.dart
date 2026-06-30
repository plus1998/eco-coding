import 'thread_models.dart';

const homeProjectDisplayName = 'Home';

class EcoProject {
  const EcoProject({
    required this.path,
    required this.name,
    this.branch,
    this.isHome = false,
    this.threadCount = 0,
  });

  final String path;
  final String name;
  final String? branch;
  final bool isHome;
  final int threadCount;

  EcoProject copyWith({
    String? path,
    String? name,
    String? branch,
    bool? isHome,
    int? threadCount,
  }) {
    return EcoProject(
      path: path ?? this.path,
      name: name ?? this.name,
      branch: branch ?? this.branch,
      isHome: isHome ?? this.isHome,
      threadCount: threadCount ?? this.threadCount,
    );
  }
}

String normalizeProjectPath(String projectPath) {
  final normalized = projectPath.replaceAll('\\', '/').replaceAll(RegExp(r'/+$'), '');
  return normalized.isEmpty ? '/' : normalized;
}

bool isHomeProjectPath(String projectPath, String homeProjectPath) {
  if (homeProjectPath.trim().isEmpty) return false;
  return normalizeProjectPath(projectPath) ==
      normalizeProjectPath(homeProjectPath);
}

bool isHomeProjectName(String name) {
  return name.trim().toLowerCase() == 'home';
}

const ecoHomeProjectSuffix = '/.eco/projects/home';

/// Matches Desktop [buildHomeProjectPath]: `{homedir}/.eco/projects/home`.
bool isEcoHomeProjectPath(String projectPath) {
  return normalizeProjectPath(projectPath).endsWith(ecoHomeProjectSuffix);
}

bool isHomeProject({
  required String path,
  required String homeProjectPath,
  String? projectName,
}) {
  if (isHomeProjectPath(path, homeProjectPath)) return true;
  if (isEcoHomeProjectPath(path)) return true;
  final name = projectName ?? _basename(path);
  return isHomeProjectName(name);
}

bool isCollectableProjectPath(String projectPath) {
  final trimmed = projectPath.trim();
  if (trimmed.isEmpty) return false;
  return normalizeProjectPath(trimmed) != '/';
}

void _addCollectableProjectPath(Set<String> paths, String projectPath) {
  if (!isCollectableProjectPath(projectPath)) return;
  paths.add(normalizeProjectPath(projectPath));
}

/// Collect distinct workspace paths: home, current workspace, and thread paths.
List<String> collectProjectPaths({
  required String homeProjectPath,
  WorkspaceInfo? currentWorkspace,
  required List<ThreadSummary> threads,
}) {
  final paths = <String>{};
  _addCollectableProjectPath(paths, homeProjectPath);
  if (currentWorkspace != null) {
    _addCollectableProjectPath(paths, currentWorkspace.path);
  }
  for (final thread in threads) {
    _addCollectableProjectPath(paths, thread.workspacePath);
  }
  return paths.toList();
}

EcoProject buildEcoProject({
  required String path,
  required String homeProjectPath,
  WorkspaceInfo? inspected,
  required int threadCount,
}) {
  final resolvedName = inspected?.name ?? _basename(path);
  final isHome = isHomeProject(
    path: path,
    homeProjectPath: homeProjectPath,
    projectName: resolvedName,
  );
  return EcoProject(
    path: path,
    name: isHome ? homeProjectDisplayName : resolvedName,
    branch: inspected?.branch,
    isHome: isHome,
    threadCount: threadCount,
  );
}

/// Build project rows for the list screen without per-project inspect RPCs.
List<EcoProject> assembleProjectsFromThreads({
  required List<ThreadSummary> threads,
  required String homeProjectPath,
  WorkspaceInfo? currentWorkspace,
  String? currentWorkspacePath,
}) {
  final paths = collectProjectPaths(
    homeProjectPath: homeProjectPath,
    currentWorkspace: currentWorkspace,
    threads: threads,
  );
  final grouped = groupThreadsByProject(threads);
  final projects = <EcoProject>[];

  for (final path in paths) {
    final normalizedPath = normalizeProjectPath(path);
    WorkspaceInfo? inspected;
    if (currentWorkspace != null &&
        normalizeProjectPath(currentWorkspace.path) == normalizedPath) {
      inspected = currentWorkspace;
    }
    projects.add(
      buildEcoProject(
        path: normalizedPath,
        homeProjectPath: homeProjectPath,
        inspected: inspected,
        threadCount: grouped[normalizedPath]?.length ?? 0,
      ),
    );
  }

  return sortProjectsByActivity(
    projects,
    grouped: grouped,
    currentWorkspacePath: currentWorkspacePath ?? currentWorkspace?.path,
  );
}

int projectActivityTimeMs(
  EcoProject project, {
  required Map<String, List<ThreadSummary>> grouped,
  String? currentWorkspacePath,
  required int activityReferenceMs,
}) {
  final key = normalizeProjectPath(project.path);
  final threads = grouped[key] ?? const <ThreadSummary>[];
  var maxMs = 0;
  for (final thread in threads) {
    final ms = threadActivityTimeMs(thread);
    if (ms > maxMs) {
      maxMs = ms;
    }
  }
  final isCurrent = currentWorkspacePath != null &&
      normalizeProjectPath(currentWorkspacePath) == key;
  if (isCurrent) {
    return maxMs > activityReferenceMs ? maxMs : activityReferenceMs;
  }
  return maxMs;
}

int compareProjectsByActivity(
  EcoProject a,
  EcoProject b, {
  required Map<String, List<ThreadSummary>> grouped,
  String? currentWorkspacePath,
  required int activityReferenceMs,
}) {
  if (a.isHome != b.isHome) {
    return a.isHome ? -1 : 1;
  }
  final delta = projectActivityTimeMs(
        b,
        grouped: grouped,
        currentWorkspacePath: currentWorkspacePath,
        activityReferenceMs: activityReferenceMs,
      ) -
      projectActivityTimeMs(
        a,
        grouped: grouped,
        currentWorkspacePath: currentWorkspacePath,
        activityReferenceMs: activityReferenceMs,
      );
  if (delta != 0) return delta;
  return a.name.toLowerCase().compareTo(b.name.toLowerCase());
}

List<EcoProject> sortProjectsByActivity(
  List<EcoProject> projects, {
  required Map<String, List<ThreadSummary>> grouped,
  String? currentWorkspacePath,
  int? activityReferenceMs,
}) {
  final referenceMs =
      activityReferenceMs ?? DateTime.now().millisecondsSinceEpoch;
  final sorted = List<EcoProject>.of(projects);
  sorted.sort(
    (a, b) => compareProjectsByActivity(
      a,
      b,
      grouped: grouped,
      currentWorkspacePath: currentWorkspacePath,
      activityReferenceMs: referenceMs,
    ),
  );
  return sorted;
}

List<EcoProject> filterVisibleProjects(
  List<EcoProject> projects,
  Set<String> hiddenPaths,
) {
  return projects
      .where(
        (project) =>
            project.isHome ||
            !hiddenPaths.contains(normalizeProjectPath(project.path)),
      )
      .toList();
}

List<EcoProject> sortProjectsForDisplay(
  List<EcoProject> projects, {
  required List<String> pinnedPaths,
  required Map<String, List<ThreadSummary>> grouped,
  String? currentWorkspacePath,
  int? activityReferenceMs,
}) {
  final referenceMs =
      activityReferenceMs ?? DateTime.now().millisecondsSinceEpoch;
  final pinnedOrder = pinnedPaths.map(normalizeProjectPath).toList();
  final pinnedSet = pinnedOrder.toSet();

  int pinnedRank(String path) {
    final normalized = normalizeProjectPath(path);
    final index = pinnedOrder.indexOf(normalized);
    return index < 0 ? pinnedOrder.length : index;
  }

  final sorted = List<EcoProject>.of(projects);
  sorted.sort((a, b) {
    if (a.isHome != b.isHome) {
      return a.isHome ? -1 : 1;
    }
    final aPinned = pinnedSet.contains(normalizeProjectPath(a.path));
    final bPinned = pinnedSet.contains(normalizeProjectPath(b.path));
    if (aPinned != bPinned) {
      return aPinned ? -1 : 1;
    }
    if (aPinned && bPinned) {
      return pinnedRank(a.path) - pinnedRank(b.path);
    }
    return compareProjectsByActivity(
      a,
      b,
      grouped: grouped,
      currentWorkspacePath: currentWorkspacePath,
      activityReferenceMs: referenceMs,
    );
  });
  return sorted;
}

Map<String, List<ThreadSummary>> groupThreadsByProject(
  List<ThreadSummary> threads,
) {
  final grouped = <String, List<ThreadSummary>>{};
  for (final thread in threads) {
    if (thread.workspacePath.trim().isEmpty) continue;
    final key = normalizeProjectPath(thread.workspacePath);
    final bucket = grouped.putIfAbsent(key, () => []);
    bucket.add(thread);
  }
  for (final entry in grouped.entries) {
    entry.value.sort(compareThreadsByActivityTime);
  }
  return grouped;
}

const projectVisibleThreadLimit = 5;

int threadActivityTimeMs(ThreadSummary thread) {
  final iso =
      thread.updatedAt.trim().isNotEmpty ? thread.updatedAt : thread.createdAt;
  return DateTime.tryParse(iso)?.millisecondsSinceEpoch ?? 0;
}

int compareThreadsByActivityTime(ThreadSummary a, ThreadSummary b) {
  final delta = threadActivityTimeMs(b) - threadActivityTimeMs(a);
  if (delta != 0) return delta;
  return b.createdAt.compareTo(a.createdAt);
}

List<ThreadSummary> sortThreadsForSidebar(
  List<ThreadSummary> threads,
  Set<String> pinnedThreadIds,
) {
  final sorted = List<ThreadSummary>.of(threads);
  sorted.sort((a, b) {
    final aPinned = pinnedThreadIds.contains(a.id);
    final bPinned = pinnedThreadIds.contains(b.id);
    if (aPinned != bPinned) {
      return aPinned ? -1 : 1;
    }
    return compareThreadsByActivityTime(a, b);
  });
  return sorted;
}

({List<ThreadSummary> visible, bool hasMore}) sliceProjectThreads(
  List<ThreadSummary> threads, {
  required bool expanded,
}) {
  if (expanded || threads.length <= projectVisibleThreadLimit) {
    return (visible: threads, hasMore: false);
  }
  return (
    visible: threads.take(projectVisibleThreadLimit).toList(),
    hasMore: true,
  );
}

String _basename(String path) {
  final normalized = path.replaceAll('\\', '/');
  final segments = normalized.split('/').where((s) => s.isNotEmpty).toList();
  if (segments.isEmpty) return path;
  return segments.last;
}

/// Display name for a workspace path without loading the full project list.
String workspaceDisplayName(String path) => _basename(path);

/// Landing hero copy aligned with [apps/desktop/src/renderer/App.tsx].
String landingHeroText({
  required String? workspacePath,
  bool isHomeProject = false,
  String? projectName,
}) {
  if (workspacePath == null || workspacePath.trim().isEmpty) {
    return '打开一个项目开始编码';
  }
  if (isHomeProject) {
    return '你在忙什么？';
  }
  final name = projectName ?? _basename(workspacePath);
  return '我们应该在 $name 中构建什么？';
}

const composerLandingPlaceholder = '尽管问';

bool shouldShowProjectBranch(String? branch) {
  if (branch == null) return false;
  final normalized = branch.trim().toLowerCase();
  return normalized.isNotEmpty &&
      normalized != 'no branch' &&
      normalized != 'detached';
}
