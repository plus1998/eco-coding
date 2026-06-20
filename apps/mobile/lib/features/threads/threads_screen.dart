import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_theme.dart';
import '../projects/project_providers.dart';
import 'thread_providers.dart';

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(projectListProvider);
    final threadsByProject = ref.watch(threadsByProjectProvider);
    final selectedPath = ref.watch(selectedProjectPathProvider).valueOrNull;
    final collapsedPaths = ref.watch(collapsedProjectPathsProvider);
    final desktopId = ref.watch(selectedDesktopIdProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('会话'),
        actions: [
          IconButton(
            tooltip: '打开项目',
            onPressed: desktopId == null
                ? null
                : () => _showOpenProjectSheet(context, ref),
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
      body: desktopId == null
          ? const Center(child: Text('请先在「PC」页选择已绑定的桌面'))
          : projectsAsync.when(
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
                      final threads = threadsByProject[project.path] ?? const [];
                      final isSelected = selectedPath == project.path;
                      final isCollapsed = collapsedPaths.contains(project.path);

                      return _ProjectSection(
                        project: project,
                        threads: threads,
                        isSelected: isSelected,
                        isCollapsed: isCollapsed,
                        onHeaderTap: () => _onProjectHeaderTap(ref, project: project),
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
      floatingActionButton: desktopId == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _showNewThreadDialog(context, ref),
              icon: const Icon(Icons.add),
              label: const Text('新建会话'),
            ),
    );
  }

  Future<void> _onProjectHeaderTap(
    WidgetRef ref, {
    required EcoProject project,
  }) async {
    await ref.read(collapsedProjectPathsProvider.notifier).toggle(project.path);
    await ref.read(selectedProjectPathProvider.notifier).select(project.path);
  }

  Future<void> _showOpenProjectSheet(BuildContext context, WidgetRef ref) async {
    final pathController = TextEditingController();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
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
                controller: pathController,
                decoration: const InputDecoration(
                  labelText: '项目路径',
                  hintText: '/Users/you/projects/my-app',
                ),
                autofocus: true,
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () async {
                  final path = pathController.text.trim();
                  if (path.isEmpty) return;
                  Navigator.pop(context);
                  try {
                    await ref
                        .read(projectListProvider.notifier)
                        .openProjectPath(path);
                  } catch (error) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(error.toString())),
                      );
                    }
                  }
                },
                child: const Text('打开'),
              ),
            ],
          ),
        );
      },
    );
    pathController.dispose();
  }

  Future<void> _showNewThreadDialog(BuildContext context, WidgetRef ref) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;

    final selectedPath = ref.read(selectedProjectPathProvider).valueOrNull;
    if (selectedPath == null || selectedPath.isEmpty) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('请先选择一个项目')),
        );
      }
      return;
    }

    final promptController = TextEditingController();
    ThreadRuntimeConfigInput? runtimeConfig = ref.read(runtimeConfigProvider);

    WorkspaceInfo workspaceInfo;
    try {
      workspaceInfo = await rpc.inspectWorkspace(selectedPath);
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('获取工作区失败: $error')));
      }
      return;
    }

    if (!context.mounted) return;

    final modelSettings = await ref.read(modelSettingsProvider.future);
    final workflow = await ref.read(workflowSettingsProvider.future);
    runtimeConfig ??= _defaultRuntimeConfig(modelSettings, workflow);

    if (!context.mounted) return;

    var homePath = '';
    try {
      homePath = await rpc.getHomeProjectPath();
    } catch (_) {
      // Older Center Server builds may not expose workspace:get-home-path yet.
    }
    if (!context.mounted) return;

    final projectName = isHomeProjectPath(selectedPath, homePath)
        ? homeProjectDisplayName
        : workspaceInfo.name;
    final workspaceLabel =
        '$projectName (${workspaceInfo.branch ?? 'no branch'})';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
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
              Text('新建会话', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(workspaceLabel),
              const SizedBox(height: 4),
              Text(
                selectedPath,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoThemeExtras(context).textMuted,
                    ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: promptController,
                decoration: const InputDecoration(
                  labelText: '任务描述',
                  hintText: '描述你想让 Agent 完成的工作…',
                ),
                maxLines: 4,
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () async {
                  final prompt = promptController.text.trim();
                  if (prompt.isEmpty) return;
                  Navigator.pop(context);
                  try {
                    await rpc.startThread(
                      workspacePath: selectedPath,
                      prompt: prompt,
                      runtimeConfig: runtimeConfig!,
                    );
                    ref.invalidate(threadListProvider);
                    ref.invalidate(projectListProvider);
                  } catch (error) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text(error.toString())));
                    }
                  }
                },
                child: const Text('开始'),
              ),
            ],
          ),
        );
      },
    );
    promptController.dispose();
  }

  ThreadRuntimeConfigInput _defaultRuntimeConfig(
    ModelSettingsSnapshot? modelSettings,
    WorkflowSettingsSnapshot? workflow,
  ) {
    final profileId =
        modelSettings?.orchestrationProfiles.firstOrNull?.id ?? '';
    final subagents = {
      for (final role in subagentRoles) role: role == 'explore',
    };
    return ThreadRuntimeConfig(
      routeProfileId: profileId,
      agentProfileId: profileId.isEmpty ? null : profileId,
      subagentEnabled: subagents,
      planModeEnabled: workflow?.planModeEnabled ?? false,
      bashReviewMode: 'always',
    );
  }
}

class _ProjectSection extends StatelessWidget {
  const _ProjectSection({
    required this.project,
    required this.threads,
    required this.isSelected,
    required this.isCollapsed,
    required this.onHeaderTap,
    required this.onThreadTap,
  });

  final EcoProject project;
  final List<ThreadSummary> threads;
  final bool isSelected;
  final bool isCollapsed;
  final VoidCallback onHeaderTap;
  final void Function(ThreadSummary thread) onThreadTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final branchLabel = project.branch ?? 'no branch';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: isSelected ? EcoColors.accentSoft : Colors.transparent,
          child: InkWell(
            onTap: onHeaderTap,
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: eco.borderSubtle),
                  left: BorderSide(
                    color: isSelected ? EcoColors.accent : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                child: Row(
                  children: [
                    Icon(
                      isCollapsed
                          ? Icons.chevron_right
                          : Icons.expand_more,
                      size: 20,
                      color: eco.textMuted,
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${project.name} · $branchLabel · ${project.threadCount} 会话',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            project.path,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: eco.textMuted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (!isCollapsed)
          ...threads.map(
            (thread) => _ThreadTile(
              thread: thread,
              onTap: () => onThreadTap(thread),
            ),
          ),
        if (!isCollapsed && threads.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(40, 8, 16, 12),
            child: Text(
              '暂无会话',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted,
                  ),
            ),
          ),
      ],
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.onTap});

  final ThreadSummary thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.only(left: 40, right: 16),
      title: Text(
        thread.title.isNotEmpty
            ? thread.title
            : workspaceDisplayName(thread.workspacePath),
      ),
      subtitle: Text(
        _statusLabel(thread.status) + (thread.message.isNotEmpty ? ' · ${thread.message}' : ''),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: onTap,
    );
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'running':
        return '运行中';
      case 'awaiting_plan':
        return '待审批计划';
      case 'blocked':
        return '等待操作';
      case 'queued':
        return '排队中';
      case 'failed':
        return '失败';
      case 'completed':
        return '已完成';
      default:
        return '空闲';
    }
  }
}
