import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../composer/commit_push_sheet.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';

class ThreadSessionMenuButton extends ConsumerWidget {
  const ThreadSessionMenuButton({
    super.key,
    this.threadId,
    required this.workspacePath,
    required this.runtimeConfig,
    required this.isRunning,
    this.gitStatus,
  });

  final String? threadId;
  final String workspacePath;
  final ThreadRuntimeConfigInput runtimeConfig;
  final bool isRunning;
  final GitWorkingTreeStatus? gitStatus;

  bool get _hasThread => threadId != null && threadId!.isNotEmpty;

  bool get _canPull =>
      gitStatus?.isGitRepository == true && (gitStatus?.behindCount ?? 0) > 0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<String>(
      onSelected: (value) => handleThreadSessionMenuAction(
        context: context,
        ref: ref,
        value: value,
        threadId: threadId,
        workspacePath: workspacePath,
        runtimeConfig: runtimeConfig,
        gitStatus: gitStatus,
      ),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'todos',
          enabled: _hasThread,
          child: const Text('任务进度'),
        ),
        PopupMenuItem(
          value: 'review',
          enabled: workspacePath.isNotEmpty,
          child: const Text('代码审查'),
        ),
        PopupMenuItem(
          value: 'commit',
          enabled: !isRunning &&
              workspacePath.isNotEmpty &&
              (gitStatus?.isGitRepository ?? false),
          child: const Text('提交与推送'),
        ),
        PopupMenuItem(
          value: 'pull',
          enabled: !isRunning && _canPull,
          child: Text(
            _canPull ? '拉取（落后 ${gitStatus!.behindCount}）' : '拉取',
          ),
        ),
        PopupMenuItem(
          value: 'scripts',
          enabled: !isRunning && workspacePath.isNotEmpty,
          child: const Text('npm scripts'),
        ),
      ],
    );
  }
}

Future<void> handleThreadSessionMenuAction({
  required BuildContext context,
  required WidgetRef ref,
  required String value,
  String? threadId,
  required String workspacePath,
  required ThreadRuntimeConfigInput runtimeConfig,
  GitWorkingTreeStatus? gitStatus,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;

  try {
    switch (value) {
      case 'todos':
        if (threadId == null || threadId.isEmpty) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('请先开始会话后再查看任务进度')),
            );
          }
          return;
        }
        await showThreadTodoSheet(
          context: context,
          ref: ref,
          threadId: threadId,
        );
      case 'review':
        if (workspacePath.isEmpty) return;
        await showWorkspaceDiffReviewSheet(
          context: context,
          ref: ref,
          workspacePath: workspacePath,
        );
      case 'commit':
        await openCommitPushFromMenu(
          context: context,
          ref: ref,
          workspacePath: workspacePath,
          runtimeConfig: runtimeConfig,
          branch: gitStatus?.branch,
        );
      case 'pull':
        if (workspacePath.isEmpty) return;
        await pullChangesFromMenu(
          context: context,
          ref: ref,
          workspacePath: workspacePath,
          branch: gitStatus?.branch,
        );
      case 'scripts':
        if (workspacePath.isEmpty) return;
        await showNpmScriptsSheet(
          context: context,
          ref: ref,
          workspacePath: workspacePath,
        );
    }
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }
}

Future<void> openCommitPushFromMenu({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
  required ThreadRuntimeConfigInput runtimeConfig,
  String? branch,
}) async {
  if (workspacePath.isEmpty) return;
  final profileId =
      runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;
  if (profileId.isEmpty) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先在 Composer 设置中选择 Agent Profile')),
      );
    }
    return;
  }

  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;

  final diff = await rpc.getWorkspaceDiff(workspacePath);
  if (!context.mounted) return;

  final committed = await showCommitPushSheet(
    context: context,
    ref: ref,
    workspacePath: workspacePath,
    profileId: profileId,
    diff: diff,
    branch: branch,
  );

  if (committed == true && context.mounted) {
    ref.invalidate(gitStatusProvider(workspacePath));
    ref.invalidate(workspaceDiffProvider(workspacePath));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已提交并推送到远程')),
    );
  }
}

Future<void> pullChangesFromMenu({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
  String? branch,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;

  final result = await rpc.pullChanges(
    workspacePath: workspacePath,
    branch: branch,
  );
  ref.invalidate(gitStatusProvider(workspacePath));
  ref.invalidate(workspaceDiffProvider(workspacePath));
  if (!context.mounted) return;

  if (result.conflicted) {
    final files = result.conflictFiles.join(', ');
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          files.isEmpty ? '拉取产生冲突，请在 Desktop 处理' : '拉取冲突：$files',
        ),
      ),
    );
    return;
  }

  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(result.pulled ? '拉取成功' : '当前分支已与远程同步'),
    ),
  );
}
