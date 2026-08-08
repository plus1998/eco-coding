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
/// Keep blur full-strength over this fraction of the frost rect, then dissolve.
const sessionTopFrostSolidFraction = 0.78;
/// Slight overshoot past chrome so frost dissolve isn’t hard-clipped.
const sessionFrostHeightExtra = 10.0;

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

/// Height of status + title row under the session [Scaffold] body.
///
/// With [Scaffold.extendBodyBehindAppBar], body [MediaQuery.padding.top] is
/// already raised to at least the AppBar height
/// (`max(systemSafeTop, appBarHeight)`), **not** the raw status-bar inset.
/// See Scaffold `_BodyBuilder`. So this is already roughly “to the toolbar
/// bottom” — do **not** add [threadSessionToolbarHeight] again.
double sessionAppBarChromeHeight(BuildContext context) {
  return MediaQuery.paddingOf(context).top;
}

/// Progressive frost overlay height (body stack). Independent from feed inset.
double sessionToolbarFrostHeight(BuildContext context) {
  return sessionAppBarChromeHeight(context) + sessionFrostHeightExtra;
}

/// Feed / landing top inset so content clears the title chrome.
///
/// Kept separate from [sessionToolbarFrostHeight]: frost may overshoot for a
/// soft dissolve, but list padding must not be derived from that overshoot.
double sessionContentTopPadding(BuildContext context) {
  return sessionAppBarChromeHeight(context) + 10;
}

/// Header frost: [ProgressiveBlur] as a body overlay under the transparent AppBar.
///
/// Height is [sessionToolbarFrostHeight] (= Scaffold-inflated padding.top + extra).
class SessionTopFrostGradient extends StatelessWidget {
  const SessionTopFrostGradient({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final statusAlpha = _sessionTopFrostStatusAlpha(context);
    final toolbarAlpha = _sessionTopFrostToolbarAlpha(context);
    // True system status inset (not Scaffold-inflated [MediaQuery.padding.top]).
    final statusH = MediaQuery.viewPaddingOf(context).top;
    final totalH = sessionToolbarFrostHeight(context);
    if (totalH <= 0) return const SizedBox.shrink();

    final sStatus = (statusH / totalH).clamp(0.0, 0.55);

    return Stack(
      fit: StackFit.expand,
      children: [
        // THIS is the blur background (rect height = sessionToolbarFrostHeight).
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
