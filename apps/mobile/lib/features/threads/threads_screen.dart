import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import 'thread_providers.dart';

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadsAsync = ref.watch(threadListProvider);
    final desktopId = ref.watch(selectedDesktopIdProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('会话'),
        actions: [
          IconButton(
            onPressed: () => ref.read(threadListProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: desktopId == null
          ? const Center(child: Text('请先在「PC」页选择已绑定的桌面'))
          : threadsAsync.when(
              data: (threads) {
                if (threads.isEmpty) {
                  return const Center(child: Text('暂无会话，点击右下角新建'));
                }
                return RefreshIndicator(
                  onRefresh: () =>
                      ref.read(threadListProvider.notifier).refresh(),
                  child: ListView.separated(
                    itemCount: threads.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final thread = threads[index];
                      return ListTile(
                        title: Text(
                          thread.title.isNotEmpty
                              ? thread.title
                              : workspaceDisplayName(thread.workspacePath),
                        ),
                        subtitle: Text(
                          '${_statusLabel(thread.status)} · ${thread.message}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => context.push('/threads/${thread.id}'),
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

  Future<void> _showNewThreadDialog(BuildContext context, WidgetRef ref) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;

    final promptController = TextEditingController();
    String? workspacePath;
    String? workspaceLabel;
    ThreadRuntimeConfigInput? runtimeConfig = ref.read(runtimeConfigProvider);

    try {
      workspacePath = await rpc.getCurrentWorkspace();
      final info = await rpc.inspectWorkspace(workspacePath);
      workspaceLabel = '${info.name} (${info.branch ?? 'no branch'})';
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
              Text(workspaceLabel ?? workspacePath!),
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
                      workspacePath: workspacePath!,
                      prompt: prompt,
                      runtimeConfig: runtimeConfig!,
                    );
                    ref.invalidate(threadListProvider);
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
