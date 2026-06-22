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
  return normalizeProjectPath(projectPath) ==
      normalizeProjectPath(homeProjectPath);
}

/// Collect distinct workspace paths: home, current workspace, and thread paths.
List<String> collectProjectPaths({
  required String homeProjectPath,
  WorkspaceInfo? currentWorkspace,
  required List<ThreadSummary> threads,
}) {
  final paths = <String>{homeProjectPath};
  if (currentWorkspace != null && currentWorkspace.path.isNotEmpty) {
    paths.add(currentWorkspace.path);
  }
  for (final thread in threads) {
    if (thread.workspacePath.isNotEmpty) {
      paths.add(thread.workspacePath);
    }
  }
  return paths.toList();
}

EcoProject buildEcoProject({
  required String path,
  required String homeProjectPath,
  WorkspaceInfo? inspected,
  required int threadCount,
}) {
  final isHome = isHomeProjectPath(path, homeProjectPath);
  return EcoProject(
    path: path,
    name: isHome ? homeProjectDisplayName : (inspected?.name ?? _basename(path)),
    branch: inspected?.branch,
    isHome: isHome,
    threadCount: threadCount,
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
