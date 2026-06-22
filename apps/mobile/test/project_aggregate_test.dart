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

  group('sortProjectsByActivity', () {
    test('keeps home first while sorting other projects by activity', () {
      final grouped = groupThreadsByProject([
        ThreadSummary(
          id: 't1',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
          message: '',
        ),
        ThreadSummary(
          id: 't2',
          title: '',
          prompt: '',
          workspacePath: '/Users/test/other',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          message: '',
        ),
      ]);

      final sorted = sortProjectsByActivity(
        [
          const EcoProject(path: '/Users/test/other', name: 'other'),
          const EcoProject(path: repoPath, name: 'eco-coding'),
          const EcoProject(
            path: homePath,
            name: homeProjectDisplayName,
            isHome: true,
          ),
        ],
        grouped: grouped,
        activityReferenceMs: DateTime.parse('2026-01-01T00:00:00.000Z')
            .millisecondsSinceEpoch,
      );

      expect(sorted.map((project) => project.path).toList(), [
        homePath,
        repoPath,
        '/Users/test/other',
      ]);
    });

    test('prioritizes current PC workspace when it has no threads', () {
      final sorted = sortProjectsByActivity(
        [
          const EcoProject(path: repoPath, name: 'eco-coding'),
          const EcoProject(path: '/Users/test/stale', name: 'stale'),
        ],
        grouped: groupThreadsByProject([
          ThreadSummary(
            id: 'old',
            title: '',
            prompt: '',
            workspacePath: '/Users/test/stale',
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            message: '',
          ),
        ]),
        currentWorkspacePath: repoPath,
        activityReferenceMs: DateTime.parse('2026-01-10T00:00:00.000Z')
            .millisecondsSinceEpoch,
      );

      expect(sorted.first.path, repoPath);
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

    test('normalizes trailing slashes when grouping', () {
      final grouped = groupThreadsByProject([
        ThreadSummary(
          id: 't1',
          title: '',
          prompt: '',
          workspacePath: '$repoPath/',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          message: '',
        ),
      ]);

      expect(grouped[repoPath]?.single.id, 't1');
    });

    test('falls back to createdAt when updatedAt is empty', () {
      final grouped = groupThreadsByProject([
        ThreadSummary(
          id: 'older',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '',
          message: '',
        ),
        ThreadSummary(
          id: 'newer',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-05T00:00:00.000Z',
          updatedAt: '',
          message: '',
        ),
      ]);

      expect(grouped[repoPath]?.first.id, 'newer');
    });
  });

  group('sortProjectsForDisplay', () {
    test('places pinned projects after home and before others', () {
      final grouped = groupThreadsByProject([
        ThreadSummary(
          id: 't1',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
          message: '',
        ),
        ThreadSummary(
          id: 't2',
          title: '',
          prompt: '',
          workspacePath: '/Users/test/other',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          message: '',
        ),
      ]);

      final sorted = sortProjectsForDisplay(
        [
          const EcoProject(path: '/Users/test/other', name: 'other'),
          const EcoProject(path: repoPath, name: 'eco-coding'),
          const EcoProject(
            path: homePath,
            name: homeProjectDisplayName,
            isHome: true,
          ),
        ],
        pinnedPaths: ['/Users/test/other'],
        grouped: grouped,
        activityReferenceMs: DateTime.parse('2026-01-01T00:00:00.000Z')
            .millisecondsSinceEpoch,
      );

      expect(sorted.map((project) => project.path).toList(), [
        homePath,
        '/Users/test/other',
        repoPath,
      ]);
    });
  });

  group('filterVisibleProjects', () {
    test('keeps home while hiding other projects', () {
      final visible = filterVisibleProjects(
        [
          const EcoProject(
            path: homePath,
            name: homeProjectDisplayName,
            isHome: true,
          ),
          const EcoProject(path: repoPath, name: 'eco-coding'),
        ],
        {repoPath},
      );

      expect(visible.map((project) => project.path).toList(), [homePath]);
    });
  });

  group('sliceProjectThreads', () {
    test('shows at most five threads until expanded', () {
      final threads = List.generate(
        7,
        (index) => ThreadSummary(
          id: 't$index',
          title: '',
          prompt: '',
          workspacePath: repoPath,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-0${index + 1}T00:00:00.000Z',
          message: '',
        ),
      );

      final collapsed = sliceProjectThreads(threads, expanded: false);
      expect(collapsed.visible.length, projectVisibleThreadLimit);
      expect(collapsed.hasMore, isTrue);

      final expanded = sliceProjectThreads(threads, expanded: true);
      expect(expanded.visible.length, 7);
      expect(expanded.hasMore, isFalse);
    });
  });
}
