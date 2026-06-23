import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../composer/commit_push_sheet.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';
import 'thread_session_app_bar.dart' show SessionToolbarIconButton;

class ThreadSessionMenuButton extends ConsumerStatefulWidget {
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

  @override
  ConsumerState<ThreadSessionMenuButton> createState() =>
      _ThreadSessionMenuButtonState();
}

class _ThreadSessionMenuButtonState extends ConsumerState<ThreadSessionMenuButton> {
  final _buttonKey = GlobalKey();

  bool get _hasThread =>
      widget.threadId != null && widget.threadId!.isNotEmpty;

  bool get _canPull =>
      widget.gitStatus?.isGitRepository == true &&
      (widget.gitStatus?.behindCount ?? 0) > 0;

  List<_ThreadSessionMenuEntry> get _entries => [
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
          enabled: widget.workspacePath.isNotEmpty,
        ),
        _ThreadSessionMenuEntry(
          value: 'commit',
          icon: EcoIcons.commitPush,
          label: '提交与推送',
          enabled: !widget.isRunning &&
              widget.workspacePath.isNotEmpty &&
              (widget.gitStatus?.isGitRepository ?? false),
        ),
        _ThreadSessionMenuEntry(
          value: 'pull',
          icon: EcoIcons.pull,
          label: _canPull
              ? '拉取（落后 ${widget.gitStatus!.behindCount}）'
              : '拉取',
          enabled: !widget.isRunning && _canPull,
        ),
        _ThreadSessionMenuEntry(
          value: 'scripts',
          icon: EcoIcons.npmScripts,
          label: 'npm scripts',
          enabled: !widget.isRunning && widget.workspacePath.isNotEmpty,
        ),
      ];

  @override
  Widget build(BuildContext context) {
    return SessionToolbarIconButton(
      key: _buttonKey,
      icon: EcoIcons.more,
      tooltip: '更多',
      onPressed: _showMenu,
    );
  }

  void _showMenu() {
    final box = _buttonKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;

    final overlayState = Overlay.of(context);
    final overlayBox =
        overlayState.context.findRenderObject() as RenderBox;
    final origin = box.localToGlobal(Offset.zero, ancestor: overlayBox);
    final entries = _entries;
    final menuWidth = _menuWidthForEntries(context, entries);
    final left = (origin.dx + box.size.width - menuWidth).clamp(
      12.0,
      overlayBox.size.width - menuWidth - 12,
    );
    final top = origin.dy + box.size.height + 4;

    late OverlayEntry entry;
    entry = OverlayEntry(
      builder: (overlayContext) {
        return Material(
          type: MaterialType.transparency,
          child: Stack(
            children: [
              Positioned.fill(
                child: GestureDetector(
                  onTap: () => entry.remove(),
                  behavior: HitTestBehavior.opaque,
                  child: ColoredBox(
                    color: ecoColors(overlayContext).shadowScrim.withValues(
                          alpha: 0.08,
                        ),
                  ),
                ),
              ),
              Positioned(
                left: left,
                top: top,
                width: menuWidth,
                child: _ThreadSessionMenuCard(
                  entries: entries,
                  onSelected: (value) {
                    entry.remove();
                    if (!mounted) return;
                    handleThreadSessionMenuAction(
                      context: context,
                      ref: ref,
                      value: value,
                      threadId: widget.threadId,
                      workspacePath: widget.workspacePath,
                      runtimeConfig: widget.runtimeConfig,
                      gitStatus: widget.gitStatus,
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );

    overlayState.insert(entry);
  }
}

const _menuRowHorizontalPadding = 16.0;
const _menuRowVerticalPadding = 12.0;
const _menuIconSize = 18.0;
const _menuIconGap = 10.0;
const _menuCardVerticalPadding = 6.0;
const _menuBorderRadius = 16.0;

double _menuWidthForEntries(
  BuildContext context,
  List<_ThreadSessionMenuEntry> entries,
) {
  final rowHorizontalPadding = _menuRowHorizontalPadding * 2;
  final textStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
        fontWeight: FontWeight.w500,
      );
  final painter = TextPainter(
    textDirection: Directionality.of(context),
    maxLines: 1,
  );
  var maxTextWidth = 0.0;
  for (final entry in entries) {
    painter.text = TextSpan(text: entry.label, style: textStyle);
    painter.layout();
    maxTextWidth = math.max(maxTextWidth, painter.width);
  }
  return rowHorizontalPadding + _menuIconSize + _menuIconGap + maxTextWidth;
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
    required this.entries,
    required this.onSelected,
  });

  final List<_ThreadSessionMenuEntry> entries;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Material(
      color: Colors.transparent,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: eco.bgMenu,
          borderRadius: BorderRadius.circular(_menuBorderRadius),
          border: Border.all(color: eco.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: eco.shadowScrim.withValues(
                alpha: Theme.of(context).brightness == Brightness.dark ? 0.28 : 0.14,
              ),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_menuBorderRadius),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: _menuCardVerticalPadding),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
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
    final eco = ecoColors(context);
    final enabled = entry.enabled;
    final color = !enabled
        ? eco.textMuted.withValues(alpha: 0.55)
        : eco.textPrimary;
    final iconColor = !enabled
        ? eco.textMuted.withValues(alpha: 0.45)
        : eco.textSecondary;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: _menuRowHorizontalPadding,
            vertical: _menuRowVerticalPadding,
          ),
          child: Row(
            children: [
              Icon(entry.icon, size: _menuIconSize, color: iconColor),
              const SizedBox(width: _menuIconGap),
              Expanded(
                child: Text(
                  entry.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
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
        const SnackBar(content: Text('请先在 Composer 设置中选择智能体配置')),
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
