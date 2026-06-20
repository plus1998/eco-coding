import 'package:eco_mobile/core/models/project_models.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const homePath = '/Users/test/.eco/projects/home';
  const repoPath = '/Users/test/Workspace/eco-coding';

  group('normalizeProjectPath', () {
    test('trims trailing slashes', () {
      expect(normalizeProjectPath('/foo/bar/'), '/foo/bar');
      expect(normalizeProjectPath('/foo/bar\\'), '/foo/bar');
    });
  });

  group('isHomeProjectPath', () {
    test('matches home path regardless of trailing slash', () {
      expect(isHomeProjectPath(homePath, homePath), isTrue);
      expect(isHomeProjectPath('$homePath/', homePath), isTrue);
      expect(isHomeProjectPath(repoPath, homePath), isFalse);
    });
  });

  group('collectProjectPaths', () {
    test('includes home, current workspace, and thread paths', () {
      final threads = [
        ThreadSummary(
          id: 't1',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          message: '',
        ),
        ThreadSummary(
          id: 't2',
          title: '',
          prompt: '',
          workspacePath: '/Users/test/other',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
          message: '',
        ),
      ];

      final paths = collectProjectPaths(
        homeProjectPath: homePath,
        currentWorkspace: const WorkspaceInfo(
          path: repoPath,
          name: 'eco-coding',
          isGitRepository: true,
          branch: 'main',
        ),
        threads: threads,
      );

      expect(paths, contains(homePath));
      expect(paths, contains(repoPath));
      expect(paths, contains('/Users/test/other'));
      expect(paths.length, 3);
    });
  });

  group('buildEcoProject', () {
    test('names home project Home', () {
      final project = buildEcoProject(
        path: homePath,
        homeProjectPath: homePath,
        inspected: const WorkspaceInfo(
          path: homePath,
          name: 'home',
          isGitRepository: false,
        ),
        threadCount: 2,
      );

      expect(project.name, homeProjectDisplayName);
      expect(project.isHome, isTrue);
      expect(project.threadCount, 2);
    });

    test('uses inspected name for non-home projects', () {
      final project = buildEcoProject(
        path: repoPath,
        homeProjectPath: homePath,
        inspected: const WorkspaceInfo(
          path: repoPath,
          name: 'eco-coding',
          isGitRepository: true,
          branch: 'main',
        ),
        threadCount: 1,
      );

      expect(project.name, 'eco-coding');
      expect(project.branch, 'main');
      expect(project.isHome, isFalse);
    });
  });

  group('sortProjects', () {
    test('puts home first then sorts by name', () {
      final sorted = sortProjects([
        const EcoProject(path: repoPath, name: 'eco-coding'),
        const EcoProject(path: homePath, name: homeProjectDisplayName, isHome: true),
        const EcoProject(path: '/Users/test/alpha', name: 'alpha'),
      ]);

      expect(sorted.first.isHome, isTrue);
      expect(sorted[1].name, 'alpha');
      expect(sorted[2].name, 'eco-coding');
    });
  });

  group('groupThreadsByProject', () {
    test('groups by workspacePath and sorts by updatedAt desc', () {
      final grouped = groupThreadsByProject([
        ThreadSummary(
          id: 'old',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          message: '',
        ),
        ThreadSummary(
          id: 'new',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
          message: '',
        ),
      ]);

      expect(grouped[repoPath]?.length, 2);
      expect(grouped[repoPath]?.first.id, 'new');
    });
  });
}
