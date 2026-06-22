import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/device_display.dart';
import '../projects/project_providers.dart';
import 'thread_session_menu.dart';

const threadSessionToolbarHeight = 52.0;
const sessionToolbarButtonSize = 32.0;
const sessionToolbarIconSize = 18.0;
const sessionToolbarButtonGap = 8.0;
const sessionTopFrostBlurSigma = 20.0;
const sessionTopFrostTintOpacity = 0.52;
const sessionTopFrostTailExtension = 48.0;
const sessionTopFrostTailOverlap = 8.0;

double _sessionTopFrostTintAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark ? sessionTopFrostTintOpacity : sessionTopFrostTintOpacity + 0.04;
}

double sessionContentTopPadding(BuildContext context) {
  return MediaQuery.paddingOf(context).top + threadSessionToolbarHeight + 8;
}

double sessionToolbarFrostHeight(BuildContext context) {
  return MediaQuery.paddingOf(context).top + threadSessionToolbarHeight;
}

/// Frosted glass for the status bar + toolbar. Uses a uniform backdrop blur with
/// a tint gradient (strongest at the status bar, fading to clear at the bottom).
/// ShaderMask must not wrap [BackdropFilter] — that breaks blur on device.
class SessionTopFrostGradient extends StatelessWidget {
  const SessionTopFrostGradient({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final tintAlpha = _sessionTopFrostTintAlpha(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final totalHeight = constraints.maxHeight;
        final statusBarHeight = MediaQuery.paddingOf(context).top;
        final statusStop = totalHeight > 0
            ? (statusBarHeight / totalHeight * 0.92).clamp(0.18, 0.4)
            : 0.28;

        return ClipRect(
          child: BackdropFilter(
            filter: ImageFilter.blur(
              sigmaX: sessionTopFrostBlurSigma,
              sigmaY: sessionTopFrostBlurSigma,
            ),
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    eco.bgMain.withValues(alpha: tintAlpha),
                    eco.bgMain.withValues(alpha: tintAlpha * 0.88),
                    eco.bgMain.withValues(alpha: tintAlpha * 0.48),
                    eco.bgMain.withValues(alpha: 0),
                  ],
                  stops: [0.0, statusStop, 0.72, 1.0],
                ),
              ),
              child: const SizedBox.expand(),
            ),
          ),
        );
      },
    );
  }
}

/// Tint-only fade below the toolbar; blur stays in [SessionTopFrostGradient].
class SessionTopFrostTail extends StatelessWidget {
  const SessionTopFrostTail({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return IgnorePointer(
      child: SizedBox(
        height: sessionTopFrostTailExtension,
        width: double.infinity,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                eco.bgMain.withValues(alpha: 0.08),
                eco.bgMain.withValues(alpha: 0),
              ],
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
    flexibleSpace: Stack(
      fit: StackFit.expand,
      children: [
        const SessionTopFrostGradient(),
        SafeArea(
          bottom: false,
          child: SizedBox(
            height: threadSessionToolbarHeight,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  SessionToolbarIconButton(
                    icon: EcoIcons.chevronLeft,
                    tooltip: '返回',
                    onPressed: () => context.pop(),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: Column(
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
                                      Clipboard.setData(
                                        ClipboardData(text: workspacePath),
                                      );
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
                    ),
                  ),
                  if (showNewThreadAction) ...[
                    SessionToolbarIconButton(
                      icon: EcoIcons.newThread,
                      tooltip: '新建会话',
                      onPressed: workspacePath.isEmpty
                          ? null
                          : () async {
                              await ref
                                  .read(selectedProjectPathProvider.notifier)
                                  .select(workspacePath);
                              if (context.mounted) {
                                context.push('/threads/new');
                              }
                            },
                    ),
                    const SizedBox(width: sessionToolbarButtonGap),
                  ],
                  ThreadSessionMenuButton(
                    threadId: threadId,
                    workspacePath: workspacePath,
                    runtimeConfig: runtimeConfig,
                    isRunning: isRunning,
                    gitStatus: gitStatus,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class SessionToolbarIconButton extends StatelessWidget {
  const SessionToolbarIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onPressed != null;

    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: sessionToolbarButtonSize,
        height: sessionToolbarButtonSize,
        child: Material(
          color: eco.bgElevated.withValues(alpha: 0.88),
          shape: CircleBorder(
            side: BorderSide(
              color: eco.borderSubtle.withValues(alpha: 0.7),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onPressed,
            child: Center(
              child: Icon(
                icon,
                size: sessionToolbarIconSize,
                color: enabled
                    ? eco.textHeading
                    : eco.textHeading.withValues(alpha: 0.38),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
