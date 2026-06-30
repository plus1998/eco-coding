import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/project_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../projects/project_list_widgets.dart';
import '../projects/project_menu_sheets.dart';
import '../projects/project_providers.dart';

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(displayProjectsProvider);
    final pinnedPaths = ref.watch(pinnedProjectPathsProvider);
    final threadsByProject = ref.watch(threadsByProjectProvider);
    ref.watch(collapsedProjectPathsProvider);
    final collapsedNotifier = ref.read(collapsedProjectPathsProvider.notifier);

    ref.listen(displayProjectsProvider, (previous, next) {
      next.whenData(collapsedNotifier.applyProjectDefaults);
    });
    projectsAsync.whenData(collapsedNotifier.applyProjectDefaults);

    return Scaffold(
      appBar: AppBar(
        title: const Text('会话'),
        actions: [
          IconButton(
            tooltip: '切换 PC',
            onPressed: () => context.push('/connect'),
            icon: const Icon(EcoIcons.desktop),
          ),
          IconButton(
            tooltip: '打开项目',
            onPressed: () => _showOpenProjectSheet(context, ref),
            icon: const Icon(EcoIcons.folderOpen),
          ),
          IconButton(
            onPressed: () async {
              await refreshProjectsAndThreads(ref);
            },
            icon: const Icon(EcoIcons.refresh),
          ),
        ],
      ),
      body: projectsAsync.when(
        data: (projects) {
          if (projects.isEmpty) {
            return const ProjectListEmptyState();
          }
          return RefreshIndicator(
            onRefresh: () => refreshProjectsAndThreads(ref),
            child: ListView.builder(
              padding: const EdgeInsets.only(top: 8, bottom: 32),
              itemCount: projects.length,
              itemBuilder: (context, index) {
                final project = projects[index];
                final threads = threadsByProject[
                        normalizeProjectPath(project.path)] ??
                    const [];
                final isCollapsed =
                    collapsedNotifier.isProjectCollapsed(project);

                final isPinned = !project.isHome &&
                    pinnedPaths.any(
                      (path) =>
                          normalizeProjectPath(path) ==
                          normalizeProjectPath(project.path),
                    );

                return ProjectSectionCard(
                  project: project,
                  threads: threads,
                  isCollapsed: isCollapsed,
                  isPinned: isPinned,
                  onHeaderTap: () =>
                      _onProjectHeaderTap(ref, project: project),
                  onHeaderLongPress: project.isHome
                      ? null
                      : () => showProjectActionSheet(
                            context: context,
                            ref: ref,
                            project: project,
                          ),
                  onNewThread: () =>
                      _openNewThread(context, ref, project.path),
                  onThreadTap: (thread) =>
                      context.push('/threads/${thread.id}'),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text(error.toString())),
      ),
    );
  }

  Future<void> _openNewThread(
    BuildContext context,
    WidgetRef ref,
    String projectPath,
  ) async {
    await ref.read(selectedProjectPathProvider.notifier).select(projectPath);
    if (context.mounted) context.push('/threads/new');
  }

  Future<void> _onProjectHeaderTap(
    WidgetRef ref, {
    required EcoProject project,
  }) async {
    await ref.read(collapsedProjectPathsProvider.notifier).toggle(project.path);
    await ref.read(selectedProjectPathProvider.notifier).select(project.path);
  }

  Future<void> _showOpenProjectSheet(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return _OpenProjectSheet(
          onOpen: (path) async {
            try {
              await openProjectPath(ref, path);
              if (sheetContext.mounted) {
                Navigator.pop(sheetContext);
              }
              messenger.showSnackBar(
                const SnackBar(content: Text('项目已打开')),
              );
            } catch (error) {
              messenger.showSnackBar(
                SnackBar(content: Text(error.toString())),
              );
              rethrow;
            }
          },
        );
      },
    );
  }
}

class _OpenProjectSheet extends StatefulWidget {
  const _OpenProjectSheet({required this.onOpen});

  final Future<void> Function(String path) onOpen;

  @override
  State<_OpenProjectSheet> createState() => _OpenProjectSheetState();
}

class _OpenProjectSheetState extends State<_OpenProjectSheet> {
  final _pathController = TextEditingController();
  bool _opening = false;

  @override
  void dispose() {
    _pathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('打开项目', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            '输入 Desktop 上的项目绝对路径',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted,
                ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _pathController,
            enabled: !_opening,
            decoration: const InputDecoration(
              labelText: '项目路径',
              hintText: '/Users/you/projects/my-app',
            ),
            autofocus: true,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _opening
                ? null
                : () async {
                    final path = _pathController.text.trim();
                    if (path.isEmpty) return;
                    setState(() => _opening = true);
                    try {
                      await widget.onOpen(path);
                    } catch (_) {
                      if (mounted) {
                        setState(() => _opening = false);
                      }
                    }
                  },
            child: _opening
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('打开'),
          ),
        ],
      ),
    );
  }
}
