import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_adaptive_icons.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/adaptive_toolbar_icon.dart'
    show AdaptiveToolbarIcon, sessionToolbarButtonSize;
import '../composer/commit_push_sheet.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';

String resolveGitRemoteSyncAction(int behindCount) {
  return behindCount > 0 ? 'pull' : 'fetch';
}

String resolveGitRemoteSyncLabel(GitWorkingTreeStatus? gitStatus) {
  final behindCount = gitStatus?.behindCount ?? 0;
  return behindCount > 0 ? '拉取（落后 $behindCount）' : '抓取';
}

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
      gitStatus?.isGitRepository == true &&
      gitStatus?.branch != null &&
      gitStatus!.branch != 'detached' &&
      (gitStatus?.hasUpstream ?? false);

  List<_ThreadSessionMenuEntry> _entries() => [
    _ThreadSessionMenuEntry(
      value: 'todos',
      icon: EcoIcons.todos,
      label: '任务进度',
      enabled: _hasThread,
    ),
    _ThreadSessionMenuEntry(
      value: 'review',
      icon: EcoIcons.codeReview,
      label: '代码审查',
      enabled: workspacePath.isNotEmpty,
    ),
    _ThreadSessionMenuEntry(
      value: 'commit',
      icon: EcoIcons.commitPush,
      label: '提交与推送',
      enabled:
          workspacePath.isNotEmpty && (gitStatus?.isGitRepository ?? false),
    ),
    _ThreadSessionMenuEntry(
      value: resolveGitRemoteSyncAction(gitStatus?.behindCount ?? 0),
      icon: EcoIcons.pull,
      label: resolveGitRemoteSyncLabel(gitStatus),
      enabled: !isRunning && _canPull,
    ),
    _ThreadSessionMenuEntry(
      value: 'scripts',
      icon: EcoIcons.npmScripts,
      label: 'npm scripts',
      enabled: workspacePath.isNotEmpty,
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = _entries();
    final menuItems = [
      for (final entry in entries)
        AdaptivePopupMenuItem<String>(
          label: entry.label,
          icon: adaptivePlatformIcon(entry.icon),
          enabled: entry.enabled,
          value: entry.value,
        ),
    ];

    return SizedBox.square(
      dimension: sessionToolbarButtonSize,
      child: Center(
        child: AdaptivePopupMenuButton.widget<String>(
          items: menuItems,
          onSelected: (index, item) {
            if (!item.enabled) return;
            final value = item.value;
            if (value == null) return;
            handleThreadSessionMenuAction(
              context: context,
              ref: ref,
              value: value,
              threadId: threadId,
              workspacePath: workspacePath,
              runtimeConfig: runtimeConfig,
              gitStatus: gitStatus,
            );
          },
          child: AdaptiveToolbarIcon(
            icon: EcoIcons.more,
            tooltip: '更多',
            size: sessionToolbarButtonSize,
            visualOnly: true,
          ),
        ),
      ),
    );
  }
}

class _ThreadSessionMenuEntry {
  const _ThreadSessionMenuEntry({
    required this.value,
    required this.icon,
    required this.label,
    required this.enabled,
  });

  final String value;
  final IconData icon;
  final String label;
  final bool enabled;
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
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('请先开始会话后再查看任务进度')));
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
      case 'fetch':
        if (workspacePath.isEmpty) return;
        await fetchChangesFromMenu(
          context: context,
          ref: ref,
          workspacePath: workspacePath,
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('请先在 Composer 设置中选择智能体配置')));
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

  if (committed != null && context.mounted) {
    refreshWorkspaceChanges(ref, workspacePath);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(committed == 'commit-push' ? '已提交并推送到远程' : '已提交')),
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

  if (!context.mounted) return;
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => const Center(
      child: Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 12),
              Text('正在拉取…'),
            ],
          ),
        ),
      ),
    ),
  );

  try {
    final result = await rpc.pullChanges(
      workspacePath: workspacePath,
      branch: branch,
    );
    refreshWorkspaceChanges(ref, workspacePath);
    if (!context.mounted) return;

    if (result.conflicted) {
      final files = result.conflictFiles.join(', ');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(files.isEmpty ? '拉取产生冲突，请在 Desktop 处理' : '拉取冲突：$files'),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(result.pulled ? '拉取成功' : '当前分支已与远程同步')),
    );
  } finally {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
  }
}

Future<void> fetchChangesFromMenu({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;

  if (!context.mounted) return;
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => const Center(
      child: Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 12),
              Text('正在抓取…'),
            ],
          ),
        ),
      ),
    ),
  );

  try {
    await rpc.fetchChanges(workspacePath: workspacePath);
    refreshWorkspaceChanges(ref, workspacePath);
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('抓取完成')));
  } finally {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
  }
}
