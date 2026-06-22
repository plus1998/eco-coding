import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../composer/commit_push_sheet.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';

class ThreadSessionMenuButton extends ConsumerWidget {
  const ThreadSessionMenuButton({
    super.key,
    this.threadId,
    this.threadTitle,
    required this.workspacePath,
    required this.runtimeConfig,
    required this.isRunning,
    this.gitStatus,
  });

  final String? threadId;
  final String? threadTitle;
  final String workspacePath;
  final ThreadRuntimeConfigInput runtimeConfig;
  final bool isRunning;
  final GitWorkingTreeStatus? gitStatus;

  bool get _hasThread => threadId != null && threadId!.isNotEmpty;

  bool get _canPull =>
      gitStatus?.isGitRepository == true && (gitStatus?.behindCount ?? 0) > 0;

  List<_ThreadSessionMenuEntry> get _entries => [
        _ThreadSessionMenuEntry(
          value: 'todos',
          icon: Icons.checklist_rounded,
          label: '任务进度',
          enabled: _hasThread,
        ),
        _ThreadSessionMenuEntry(
          value: 'review',
          icon: Icons.rate_review_outlined,
          label: '代码审查',
          enabled: workspacePath.isNotEmpty,
        ),
        _ThreadSessionMenuEntry(
          value: 'commit',
          icon: Icons.publish_outlined,
          label: '提交与推送',
          enabled: !isRunning &&
              workspacePath.isNotEmpty &&
              (gitStatus?.isGitRepository ?? false),
        ),
        _ThreadSessionMenuEntry(
          value: 'pull',
          icon: Icons.download_outlined,
          label: _canPull ? '拉取（落后 ${gitStatus!.behindCount}）' : '拉取',
          enabled: !isRunning && _canPull,
        ),
        _ThreadSessionMenuEntry(
          value: 'scripts',
          icon: Icons.terminal_outlined,
          label: 'npm scripts',
          enabled: !isRunning && workspacePath.isNotEmpty,
        ),
      ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconButton(
      tooltip: '更多',
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      constraints: const BoxConstraints(minWidth: 40, minHeight: 36),
      icon: const Icon(Icons.more_horiz_rounded, size: 20),
      onPressed: () => _showMenu(context, ref),
    );
  }

  Future<void> _showMenu(BuildContext context, WidgetRef ref) async {
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;

    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    final origin = box.localToGlobal(Offset.zero, ancestor: overlay);
    const menuWidth = 188.0;
    final left = (origin.dx + box.size.width - menuWidth).clamp(
      12.0,
      overlay.size.width - menuWidth - 12,
    );
    final top = origin.dy + box.size.height + 6;

    final selected = await showDialog<String>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.08),
      builder: (dialogContext) {
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                onTap: () => Navigator.pop(dialogContext),
                behavior: HitTestBehavior.opaque,
                child: const SizedBox.expand(),
              ),
            ),
            Positioned(
              left: left,
              top: top,
              width: menuWidth,
              child: _ThreadSessionMenuCard(
                threadTitle: threadTitle?.trim(),
                entries: _entries,
                onSelected: (value) => Navigator.pop(dialogContext, value),
              ),
            ),
          ],
        );
      },
    );

    if (selected == null || !context.mounted) return;
    await handleThreadSessionMenuAction(
      context: context,
      ref: ref,
      value: selected,
      threadId: threadId,
      workspacePath: workspacePath,
      runtimeConfig: runtimeConfig,
      gitStatus: gitStatus,
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

class _ThreadSessionMenuCard extends StatelessWidget {
  const _ThreadSessionMenuCard({
    required this.threadTitle,
    required this.entries,
    required this.onSelected,
  });

  final String? threadTitle;
  final List<_ThreadSessionMenuEntry> entries;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Material(
      color: Colors.transparent,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: EcoColors.bgMenu,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: eco.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.28),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (threadTitle != null && threadTitle!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                  child: Text(
                    threadTitle!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: EcoColors.textHeading,
                          fontWeight: FontWeight.w600,
                          height: 1.35,
                        ),
                  ),
                ),
              if (threadTitle != null && threadTitle!.isNotEmpty)
                Divider(height: 1, color: eco.borderSubtle),
              ...entries.map((entry) {
                return _ThreadSessionMenuRow(
                  entry: entry,
                  onTap: entry.enabled ? () => onSelected(entry.value) : null,
                );
              }),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThreadSessionMenuRow extends StatelessWidget {
  const _ThreadSessionMenuRow({
    required this.entry,
    required this.onTap,
  });

  final _ThreadSessionMenuEntry entry;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final enabled = entry.enabled;
    final color = !enabled
        ? eco.textMuted.withValues(alpha: 0.55)
        : EcoColors.textPrimary;
    final iconColor = !enabled
        ? eco.textMuted.withValues(alpha: 0.45)
        : eco.textSecondary;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Row(
            children: [
              Icon(entry.icon, size: 16, color: iconColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  entry.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: color,
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
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
