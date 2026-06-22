import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/relative_time.dart';
import '../../core/utils/thread_status.dart';
import '../projects/project_menu_sheets.dart';
import '../projects/project_providers.dart';
import 'thread_providers.dart';

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(displayProjectsProvider);
    final pinnedPaths = ref.watch(pinnedProjectPathsProvider);
    final threadsByProject = ref.watch(threadsByProjectProvider);
    final selectedPath = ref.watch(selectedProjectPathProvider).valueOrNull;
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
            icon: const Icon(Icons.computer_outlined),
          ),
          IconButton(
            tooltip: '打开项目',
            onPressed: () => _showOpenProjectSheet(context, ref),
            icon: const Icon(Icons.folder_open_outlined),
          ),
          IconButton(
            onPressed: () async {
              await ref.read(threadListProvider.notifier).refresh();
              await ref.read(projectListProvider.notifier).refresh();
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: projectsAsync.when(
              data: (projects) {
                if (projects.isEmpty) {
                  return const Center(child: Text('暂无项目，点击右上角打开项目'));
                }
                return RefreshIndicator(
                  onRefresh: () async {
                    await ref.read(threadListProvider.notifier).refresh();
                    await ref.read(projectListProvider.notifier).refresh();
                  },
                  child: ListView.builder(
                    itemCount: projects.length,
                    itemBuilder: (context, index) {
                      final project = projects[index];
                      final threads = threadsByProject[
                              normalizeProjectPath(project.path)] ??
                          const [];
                      final isSelected = selectedPath == project.path;
                      final isCollapsed = collapsedNotifier.isProjectCollapsed(project);

                      final isPinned = !project.isHome &&
                          pinnedPaths.any(
                            (path) =>
                                normalizeProjectPath(path) ==
                                normalizeProjectPath(project.path),
                          );

                      return _ProjectSection(
                        project: project,
                        threads: threads,
                        isSelected: isSelected,
                        isCollapsed: isCollapsed,
                        isPinned: isPinned,
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
            Navigator.pop(sheetContext);
            try {
              await ref.read(projectListProvider.notifier).openProjectPath(path);
              messenger.showSnackBar(
                const SnackBar(content: Text('项目已打开')),
              );
            } catch (error) {
              messenger.showSnackBar(
                SnackBar(content: Text(error.toString())),
              );
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

  @override
  void dispose() {
    _pathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('打开项目', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text('输入 Desktop 上的项目绝对路径'),
          const SizedBox(height: 12),
          TextField(
            controller: _pathController,
            decoration: const InputDecoration(
              labelText: '项目路径',
              hintText: '/Users/you/projects/my-app',
            ),
            autofocus: true,
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () async {
              final path = _pathController.text.trim();
              if (path.isEmpty) return;
              await widget.onOpen(path);
            },
            child: const Text('打开'),
          ),
        ],
      ),
    );
  }
}

class _ProjectSection extends StatefulWidget {
  const _ProjectSection({
    required this.project,
    required this.threads,
    required this.isSelected,
    required this.isCollapsed,
    required this.isPinned,
    required this.onHeaderTap,
    this.onHeaderLongPress,
    required this.onNewThread,
    required this.onThreadTap,
  });

  final EcoProject project;
  final List<ThreadSummary> threads;
  final bool isSelected;
  final bool isCollapsed;
  final bool isPinned;
  final VoidCallback onHeaderTap;
  final VoidCallback? onHeaderLongPress;
  final VoidCallback onNewThread;
  final void Function(ThreadSummary thread) onThreadTap;

  @override
  State<_ProjectSection> createState() => _ProjectSectionState();
}

class _ProjectSectionState extends State<_ProjectSection> {
  var _threadsExpanded = false;

  @override
  void didUpdateWidget(covariant _ProjectSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.path != widget.project.path ||
        oldWidget.threads.length <= projectVisibleThreadLimit) {
      _threadsExpanded = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final project = widget.project;
    final threads = widget.threads;
    final isSelected = widget.isSelected;
    final isCollapsed = widget.isCollapsed;
    final slice = sliceProjectThreads(threads, expanded: _threadsExpanded);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: isSelected ? ecoColors(context).navActive : Colors.transparent,
          child: InkWell(
            onTap: widget.onHeaderTap,
            onLongPress: widget.onHeaderLongPress,
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: ecoColors(context).borderSubtle),
                  left: BorderSide(
                    color: isSelected ? ecoColors(context).accent : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 12, 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(
                        isCollapsed
                            ? Icons.chevron_right
                            : Icons.expand_more,
                        size: 20,
                        color: ecoColors(context).textMuted,
                      ),
                    ),
                    const SizedBox(width: 2),
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: widget.isPinned
                          ? Icon(
                              Icons.push_pin,
                              size: 14,
                              color: isSelected
                                  ? ecoColors(context).accentText
                                  : ecoColors(context).textMuted,
                            )
                          : const SizedBox(width: 14),
                    ),
                    const SizedBox(width: 2),
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Icon(
                        project.isHome
                            ? Icons.home_outlined
                            : isCollapsed
                                ? Icons.folder_outlined
                                : Icons.folder_open_outlined,
                        size: 18,
                        color: isSelected
                            ? ecoColors(context).textPrimary
                            : ecoColors(context).textMuted,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  project.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(
                                        fontWeight: FontWeight.w500,
                                        color: isSelected
                                            ? ecoColors(context).textHeading
                                            : ecoColors(context).textPrimary,
                                      ),
                                ),
                              ),
                              if (shouldShowProjectBranch(project.branch)) ...[
                                const SizedBox(width: 8),
                                _ProjectMetaChip(
                                  icon: Icons.call_split,
                                  label: project.branch!,
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            project.path,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: ecoColors(context).textMuted,
                                  fontSize: 11,
                                ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: '新建会话',
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                      icon: Icon(
                        Icons.add_comment_outlined,
                        size: 18,
                        color: isSelected
                            ? ecoColors(context).textPrimary
                            : ecoColors(context).textMuted,
                      ),
                      onPressed: widget.onNewThread,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (!isCollapsed)
          ...slice.visible.map(
            (thread) => _ThreadTile(
              thread: thread,
              onTap: () => widget.onThreadTap(thread),
            ),
          ),
        if (!isCollapsed && slice.hasMore)
          Padding(
            padding: const EdgeInsets.fromLTRB(44, 4, 16, 8),
            child: TextButton(
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                alignment: Alignment.centerLeft,
              ),
              onPressed: () => setState(() => _threadsExpanded = true),
              child: Text(
                '展开显示',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).accentText,
                    ),
              ),
            ),
          ),
        if (!isCollapsed && threads.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(44, 8, 16, 12),
            child: Text(
              '暂无会话',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textMuted,
                  ),
            ),
          ),
      ],
    );
  }
}

class _ProjectMetaChip extends StatelessWidget {
  const _ProjectMetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: ecoColors(context).composerPillBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: ecoColors(context).composerPillBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: ecoColors(context).textMuted),
          const SizedBox(width: 4),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: ecoColors(context).textSecondary,
                  fontSize: 10,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
          ),
        ],
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.onTap});

  final ThreadSummary thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final title = thread.title;
    final showStatus = hasThreadStatusIndicator(thread);
    final timeLabel = formatRelativeTime(threadStatusTime(thread));

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: ecoColors(context).borderSubtle.withValues(alpha: 0.6)),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(44, 9, 12, 9),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                      if (thread.message.isNotEmpty && showStatus) ...[
                        const SizedBox(height: 3),
                        Text(
                          thread.message,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: ecoColors(context).textMuted,
                              ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _ThreadTrailingIndicator(
                  thread: thread,
                  timeLabel: timeLabel,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ThreadTrailingIndicator extends StatelessWidget {
  const _ThreadTrailingIndicator({
    required this.thread,
    required this.timeLabel,
  });

  final ThreadSummary thread;
  final String timeLabel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    if (isThreadWaitingForApproval(thread)) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: ecoColors(context).statusAllowBg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: ecoColors(context).statusAllowBorder),
        ),
        child: Text(
          '等待批准',
          style: TextStyle(
            color: ecoColors(context).statusAllowText,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
      );
    }

    if (isThreadBusy(thread)) {
      return SizedBox(
        width: 16,
        height: 16,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: threadStatusDotColor('running', eco),
        ),
      );
    }

    if (thread.status == 'failed' || thread.status == 'blocked') {
      return Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: threadStatusDotColor(thread.status, eco),
          shape: BoxShape.circle,
        ),
      );
    }

    if (timeLabel.isEmpty) return const SizedBox.shrink();

    return Text(
      timeLabel,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: ecoColors(context).textMuted,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
    );
  }
}
