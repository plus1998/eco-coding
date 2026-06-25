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

    test('returns false when home path is empty', () {
      expect(isHomeProjectPath('/', ''), isFalse);
      expect(isHomeProjectPath(homePath, ''), isFalse);
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

    test('skips empty home path and root placeholder paths', () {
      final paths = collectProjectPaths(
        homeProjectPath: '',
        currentWorkspace: null,
        threads: [
          ThreadSummary(
            id: 't-root',
            title: '',
            prompt: '',
            workspacePath: '/',
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            message: '',
          ),
          ThreadSummary(
            id: 't-repo',
            title: '',
            prompt: '',
            workspacePath: repoPath,
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            message: '',
          ),
        ],
      );

      expect(paths, [repoPath]);
    });

    test('deduplicates paths that normalize to the same value', () {
      final paths = collectProjectPaths(
        homeProjectPath: homePath,
        currentWorkspace: null,
        threads: [
          ThreadSummary(
            id: 't-home',
            title: '',
            prompt: '',
            workspacePath: '$homePath/',
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            message: '',
          ),
        ],
      );

      expect(paths, [homePath]);
    });
  });

  group('isHomeProjectName', () {
    test('matches home case-insensitively', () {
      expect(isHomeProjectName('home'), isTrue);
      expect(isHomeProjectName('Home'), isTrue);
      expect(isHomeProjectName('HOME'), isTrue);
      expect(isHomeProjectName('eco-coding'), isFalse);
    });
  });

  group('isHomeProject', () {
    test('matches by path when home path is known', () {
      expect(
        isHomeProject(
          path: homePath,
          homeProjectPath: homePath,
          projectName: 'anything',
        ),
        isTrue,
      );
    });

    test('matches by name when home path is unavailable', () {
      expect(
        isHomeProject(
          path: homePath,
          homeProjectPath: '',
          projectName: 'home',
        ),
        isTrue,
      );
    });

    test('matches basename home when name is unavailable', () {
      expect(
        isHomeProject(
          path: homePath,
          homeProjectPath: '',
        ),
        isTrue,
      );
    });

    test('matches canonical .eco/projects/home path regardless of name', () {
      const canonicalHome = '/Users/plus/.eco/projects/home';
      expect(isEcoHomeProjectPath(canonicalHome), isTrue);
      expect(isEcoHomeProjectPath('$canonicalHome/'), isTrue);
      expect(
        isHomeProject(
          path: canonicalHome,
          homeProjectPath: '',
          projectName: 'misc',
        ),
        isTrue,
      );
      expect(isEcoHomeProjectPath(repoPath), isFalse);
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

    test('treats lowercase home name as Home when path is unknown', () {
      final project = buildEcoProject(
        path: homePath,
        homeProjectPath: '',
        inspected: const WorkspaceInfo(
          path: homePath,
          name: 'home',
          isGitRepository: false,
        ),
        threadCount: 0,
      );

      expect(project.name, homeProjectDisplayName);
      expect(project.isHome, isTrue);
    });

    test('treats canonical eco home path as Home when RPC path is missing', () {
      const canonicalHome = '/Users/plus/.eco/projects/home';
      final project = buildEcoProject(
        path: canonicalHome,
        homeProjectPath: '',
        inspected: const WorkspaceInfo(
          path: canonicalHome,
          name: 'misc',
          isGitRepository: false,
        ),
        threadCount: 1,
      );

      expect(project.name, homeProjectDisplayName);
      expect(project.isHome, isTrue);
    });
  });

  group('assembleProjectsFromThreads', () {
    test('builds projects from threads without inspectWorkspace', () {
      final projects = assembleProjectsFromThreads(
        threads: [
          ThreadSummary(
            id: 't1',
            title: 'One',
            prompt: '',
            workspacePath: repoPath,
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            message: '',
          ),
        ],
        homeProjectPath: homePath,
        currentWorkspace: const WorkspaceInfo(
          path: repoPath,
          name: 'eco-coding',
          isGitRepository: true,
          branch: 'main',
        ),
      );

      expect(projects.map((project) => project.path), contains(repoPath));
      final repo = projects.firstWhere((project) => project.path == repoPath);
      expect(repo.name, 'eco-coding');
      expect(repo.branch, 'main');
      expect(repo.threadCount, 1);
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
