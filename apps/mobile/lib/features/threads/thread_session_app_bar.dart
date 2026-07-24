import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/locale/app_localizations_ext.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/device_display.dart';
import '../../core/widgets/adaptive_toolbar_icon.dart'
    show AdaptiveToolbarIcon, sessionToolbarButtonGap, sessionToolbarButtonSize;
import '../projects/project_providers.dart';
import 'thread_session_menu.dart';

const threadSessionToolbarHeight = 52.0;
const sessionTopFrostBlurSigma = 20.0;
const sessionTopFrostTintOpacity = 0.52;

/// Pull the first content row slightly under the frosted header fade.
const sessionContentTopOverlap = 46.0;

double _sessionTopFrostTintAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark
      ? sessionTopFrostTintOpacity
      : sessionTopFrostTintOpacity + 0.04;
}

double sessionContentTopPadding(BuildContext context) {
  return sessionToolbarFrostHeight(context) - sessionContentTopOverlap;
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
                    tooltip: context.l10n.commonBack,
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
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
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
                                      ScaffoldMessenger.of(
                                        context,
                                      ).showSnackBar(
                                        SnackBar(
                                          content: Text(
                                            context.l10n.threadWorkspaceCopied,
                                          ),
                                        ),
                                      );
                                    },
                              child: Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
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
                      tooltip: context.l10n.threadNew,
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
    return AdaptiveToolbarIcon(
      icon: icon,
      tooltip: tooltip,
      onPressed: onPressed,
      size: sessionToolbarButtonSize,
    );
  }
}
