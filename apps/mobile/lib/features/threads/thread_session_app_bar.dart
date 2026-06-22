import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/device_display.dart';
import '../projects/project_providers.dart';
import 'thread_session_menu.dart';

const threadSessionToolbarHeight = 52.0;
const sessionTopFrostFadeExtension = 40.0;
const sessionTopFrostPeakOpacity = 0.8;

double sessionContentTopPadding(BuildContext context) {
  return MediaQuery.paddingOf(context).top + threadSessionToolbarHeight + 8;
}

double sessionTopFrostHeight(BuildContext context) {
  return MediaQuery.paddingOf(context).top +
      threadSessionToolbarHeight +
      sessionTopFrostFadeExtension;
}

/// Static top fade pinned to the session body. Uses a gradient instead of live
/// backdrop blur so scrolling and keyboard resize stay smooth.
class SessionTopFrostOverlay extends StatelessWidget {
  const SessionTopFrostOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    final height = sessionTopFrostHeight(context);
    final peak = ecoColors(context).bgMain.withValues(alpha: sessionTopFrostPeakOpacity);
    return IgnorePointer(
      child: RepaintBoundary(
        child: SizedBox(
          height: height,
          width: double.infinity,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  peak,
                  peak.withValues(alpha: sessionTopFrostPeakOpacity * 0.72),
                  peak.withValues(alpha: 0),
                ],
                stops: const [0.0, 0.58, 1.0],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

PreferredSizeWidget buildThreadSessionAppBar(
  BuildContext context,
  WidgetRef ref, {
  required String title,
  required String workspacePath,
  String? threadId,
  String? projectName,
  required ThreadRuntimeConfigInput runtimeConfig,
  required bool isRunning,
  GitWorkingTreeStatus? gitStatus,
  bool showNewThreadAction = true,
}) {
  final eco = ecoColors(context);
  final desktopLabel = ref.watch(selectedDesktopLabelProvider);
  final subtitle = threadSessionSubtitleLabel(
    projectName: projectName,
    workspacePath: workspacePath,
    desktopLabel: desktopLabel,
  );

  return AppBar(
    automaticallyImplyLeading: false,
    backgroundColor: Colors.transparent,
    elevation: 0,
    scrolledUnderElevation: 0,
    surfaceTintColor: Colors.transparent,
    shadowColor: Colors.transparent,
    toolbarHeight: threadSessionToolbarHeight,
    titleSpacing: 0,
    leading: Padding(
      padding: const EdgeInsets.only(left: 8),
      child: _SessionIconButton(
        icon: Icons.chevron_left_rounded,
        tooltip: '返回',
        onPressed: () => context.pop(),
      ),
    ),
    leadingWidth: 52,
    title: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
                height: 1.15,
              ),
        ),
        if (subtitle.isNotEmpty)
          GestureDetector(
            onLongPress: workspacePath.isEmpty
                ? null
                : () {
                    Clipboard.setData(ClipboardData(text: workspacePath));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('工作目录已复制')),
                    );
                  },
            child: Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textMuted,
                    height: 1.2,
                  ),
            ),
          ),
      ],
    ),
    actions: [
      _SessionActionsPill(
        showNewThreadAction: showNewThreadAction,
        onNewThread: workspacePath.isEmpty
            ? null
            : () async {
                await ref
                    .read(selectedProjectPathProvider.notifier)
                    .select(workspacePath);
                if (context.mounted) {
                  context.push('/threads/new');
                }
              },
        menuButton: ThreadSessionMenuButton(
          threadId: threadId,
          workspacePath: workspacePath,
          runtimeConfig: runtimeConfig,
          isRunning: isRunning,
          gitStatus: gitStatus,
        ),
      ),
      const SizedBox(width: 8),
    ],
  );
}

class _SessionIconButton extends StatelessWidget {
  const _SessionIconButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: ecoColors(context).bgElevated.withValues(alpha: 0.88),
        foregroundColor: ecoColors(context).textHeading,
        shape: const CircleBorder(),
        side: BorderSide(color: ecoColors(context).borderSubtle.withValues(alpha: 0.7)),
        minimumSize: const Size(36, 36),
        fixedSize: const Size(36, 36),
        padding: EdgeInsets.zero,
      ),
      icon: Icon(icon, size: 22),
    );
  }
}

class _SessionActionsPill extends StatelessWidget {
  const _SessionActionsPill({
    required this.showNewThreadAction,
    required this.onNewThread,
    required this.menuButton,
  });

  final bool showNewThreadAction;
  final VoidCallback? onNewThread;
  final Widget menuButton;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).bgElevated.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: ecoColors(context).borderSubtle.withValues(alpha: 0.7)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showNewThreadAction)
            IconButton(
              tooltip: '新建会话',
              onPressed: onNewThread,
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              constraints: const BoxConstraints(minWidth: 40, minHeight: 36),
              icon: const Icon(Icons.add_comment_outlined, size: 18),
            ),
          if (showNewThreadAction)
            Container(
              width: 1,
              height: 18,
              color: ecoColors(context).borderSubtle.withValues(alpha: 0.7),
            ),
          menuButton,
        ],
      ),
    );
  }
}
