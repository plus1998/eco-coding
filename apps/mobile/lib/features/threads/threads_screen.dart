import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/project_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/adaptive_nav_bar.dart';
import '../../core/widgets/adaptive_toolbar_icon.dart';
import '../../core/widgets/shell_toolbar_actions.dart';
import '../projects/project_list_widgets.dart';
import '../projects/project_menu_sheets.dart';
import '../projects/project_providers.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';
import 'thread_search_sheet.dart';

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(displayProjectsProvider);
    final pinnedPaths = ref.watch(pinnedProjectPathsProvider);
    final pinnedThreadIds = ref.watch(pinnedThreadIdsProvider).toSet();
    final threadsByProject = ref.watch(threadsByProjectProvider);
    ref.watch(collapsedProjectPathsProvider);
    final collapsedNotifier = ref.read(collapsedProjectPathsProvider.notifier);

    ref.listen(displayProjectsProvider, (previous, next) {
      next.whenData(collapsedNotifier.applyProjectDefaults);
    });
    projectsAsync.whenData(collapsedNotifier.applyProjectDefaults);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        leadingWidth: 64,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: AdaptiveToolbarIcon(
            tooltip: '切换 PC',
            icon: EcoIcons.desktop,
            size: sessionToolbarButtonSize,
            onPressed: () => context.push('/connect'),
          ),
        ),
        title: const Text('会话'),
        actions: [
          ShellToolbarActions(
            showSearch: true,
            showOpenProject: true,
            showSwitchPc: false,
            onSearch: () => _openSearch(context, ref),
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
              padding: EdgeInsets.only(
                top: 4,
                bottom: adaptiveNavOverlayInset(context),
              ),
              itemCount: projects.length,
              itemBuilder: (context, index) {
                final project = projects[index];
                final threads =
                    threadsByProject[normalizeProjectPath(project.path)] ??
                    const [];
                final isCollapsed = collapsedNotifier.isProjectCollapsed(
                  project,
                );

                final isPinned =
                    !project.isHome &&
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
                  pinnedThreadIds: pinnedThreadIds,
                  onHeaderTap: () => _onProjectHeaderTap(ref, project: project),
                  onHeaderLongPress: project.isHome
                      ? null
                      : () => showProjectActionSheet(
                          context: context,
                          ref: ref,
                          project: project,
                        ),
                  onNewThread: () => _openNewThread(context, ref, project.path),
                  onThreadTap: (thread) =>
                      context.push('/threads/${thread.id}'),
                  onThreadLongPress: (thread) => showThreadActionSheet(
                    context: context,
                    ref: ref,
                    thread: thread,
                  ),
                );
              },
            ),
          );
        },
        loading: () =>
            const Center(child: CircularProgressIndicator(strokeWidth: 2)),
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

  Future<void> _openSearch(BuildContext context, WidgetRef ref) async {
    final threads = ref.read(threadListProvider).valueOrNull ?? const [];
    final projects = ref.read(displayProjectsProvider).valueOrNull ?? const [];
    final selection = await showThreadSearchSheet(
      context: context,
      threads: threads,
      projects: projects,
    );
    if (selection == null || !context.mounted) return;

    final thread = selection.thread;
    if (thread != null) {
      context.push('/threads/${thread.id}');
      return;
    }

    final project = selection.project;
    if (project == null) return;
    try {
      await openProjectPath(ref, project.path);
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _onProjectHeaderTap(
    WidgetRef ref, {
    required EcoProject project,
  }) async {
    await ref.read(collapsedProjectPathsProvider.notifier).toggle(project.path);
    await ref.read(selectedProjectPathProvider.notifier).select(project.path);
  }
}
