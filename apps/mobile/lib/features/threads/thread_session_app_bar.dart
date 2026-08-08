import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/device_display.dart';
import '../../core/utils/thread_title.dart';
import '../../core/widgets/adaptive_toolbar_icon.dart'
    show AdaptiveToolbarIcon, sessionToolbarButtonGap, sessionToolbarButtonSize;
import '../../core/widgets/progressive_blur.dart';
import '../projects/project_providers.dart';
import 'thread_providers.dart';
import 'thread_session_menu.dart';

const threadSessionToolbarHeight = 54.0;
/// Progressive blur sigma at the strong edge (full AppBar chrome height).
const sessionTopFrostBlurSigma = 18.0;
const sessionTopFrostStatusOpacity = 0.20;
const sessionTopFrostToolbarOpacity = 0.28;
/// Keep blur full-strength over this fraction of chrome, then dissolve.
/// (~title bar including status; only the last ~20% softens.)
const sessionTopFrostSolidFraction = 0.78;
/// Feed peek under the chrome (does not change blur paint rect).
const sessionContentTopOverlap = 20.0;

double _sessionTopFrostStatusAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark
      ? sessionTopFrostStatusOpacity + 0.06
      : sessionTopFrostStatusOpacity;
}

double _sessionTopFrostToolbarAlpha(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return isDark
      ? sessionTopFrostToolbarOpacity + 0.08
      : sessionTopFrostToolbarOpacity;
}

/// AppBar preferred height = status + title row.
double sessionAppBarChromeHeight(BuildContext context) {
  return MediaQuery.paddingOf(context).top + 10;
}

/// [SessionTopFrostGradient] / overlay height — same as chrome (not taller).
double sessionToolbarFrostHeight(BuildContext context) {
  return sessionAppBarChromeHeight(context);
}

double sessionContentTopPadding(BuildContext context) {
  final chrome = sessionAppBarChromeHeight(context);
  final raw = chrome - sessionContentTopOverlap;
  return raw.clamp(0.0, chrome);
}

/// Header frost: [ProgressiveBlur] over the **full AppBar chrome**.
///
/// What blurs is this layer (body overlay), not the AppBar Material. Height
/// matches status+toolbar; [sessionTopFrostSolidFraction] controls how soon
/// blur eases off near the bottom edge (not by shrinking the rect).
class SessionTopFrostGradient extends StatelessWidget {
  const SessionTopFrostGradient({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final statusAlpha = _sessionTopFrostStatusAlpha(context);
    final toolbarAlpha = _sessionTopFrostToolbarAlpha(context);
    final statusH = MediaQuery.paddingOf(context).top;
    final totalH = sessionToolbarFrostHeight(context);
    if (totalH <= 0) return const SizedBox.shrink();

    final sStatus = (statusH / totalH).clamp(0.0, 0.55);

    return Stack(
      fit: StackFit.expand,
      children: [
        // THIS is the blur background (rect = AppBar chrome only).
        const ProgressiveBlur(
          maxSigma: sessionTopFrostBlurSigma,
          direction: ProgressiveBlurDirection.topToBottom,
          falloff: 1.6,
          solidFraction: sessionTopFrostSolidFraction,
        ),
        // Tint only — paint color, not blur height.
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                eco.bgMain.withValues(alpha: statusAlpha),
                eco.bgMain.withValues(alpha: toolbarAlpha),
                eco.bgMain.withValues(alpha: toolbarAlpha * 0.4),
                eco.bgMain.withValues(alpha: 0),
              ],
              stops: [0.0, sStatus, 0.85, 1.0],
            ),
          ),
          child: const SizedBox.expand(),
        ),
      ],
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
  bool titleGenerating = false,
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
    forceMaterialTransparency: true,
    elevation: 0,
    scrolledUnderElevation: 0,
    surfaceTintColor: Colors.transparent,
    shadowColor: Colors.transparent,
    shape: const Border(),
    toolbarHeight: threadSessionToolbarHeight,
    // Frost is painted under this AppBar in the body stack (fade tail past icons).
    flexibleSpace: SafeArea(
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
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    height: 1.15,
                                  ),
                            ),
                          ),
                          if (threadId != null &&
                              canRegenerateThreadTitle(
                                title,
                                titleGenerating: titleGenerating,
                              )) ...[
                            const SizedBox(width: 2),
                            Tooltip(
                              message: context.l10n.threadRegenerateTitle,
                              child: IconButton(
                                icon: Icon(
                                  EcoIcons.refresh,
                                  size: 16,
                                  color: ecoColors(context).textMuted,
                                ),
                                visualDensity: VisualDensity.compact,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 28,
                                  minHeight: 28,
                                ),
                                onPressed: () async {
                                  final rpc = ref.read(desktopRpcProvider);
                                  if (rpc == null) return;
                                  try {
                                    await rpc.regenerateThreadTitle(threadId);
                                  } catch (error) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('$error')),
                                    );
                                  }
                                },
                              ),
                            ),
                          ],
                        ],
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
