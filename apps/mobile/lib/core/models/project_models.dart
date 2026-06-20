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

List<EcoProject> sortProjects(List<EcoProject> projects) {
  final sorted = List<EcoProject>.of(projects);
  sorted.sort((a, b) {
    if (a.isHome != b.isHome) {
      return a.isHome ? -1 : 1;
    }
    return a.name.toLowerCase().compareTo(b.name.toLowerCase());
  });
  return sorted;
}

Map<String, List<ThreadSummary>> groupThreadsByProject(
  List<ThreadSummary> threads,
) {
  final grouped = <String, List<ThreadSummary>>{};
  for (final thread in threads) {
    final bucket = grouped.putIfAbsent(thread.workspacePath, () => []);
    bucket.add(thread);
  }
  for (final entry in grouped.entries) {
    entry.value.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }
  return grouped;
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
