import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/git_models.dart';
import '../../core/theme/eco_theme.dart';
import 'composer_stack_card.dart';

const _iosNativeGlassWidthSafetyPadding = 28.0;

class WorkspaceChangesPill extends StatelessWidget {
  const WorkspaceChangesPill({
    super.key,
    required this.summary,
    this.busy = false,
    this.onTap,
  });

  final WorkspaceChangesSummary? summary;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (summary == null || !summary!.hasChanges) {
      return const SizedBox.shrink();
    }

    final eco = ecoColors(context);
    final labelStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: eco.composerPillText,
      fontSize: 13,
      height: 1.2,
    );
    final child = Padding(
      padding: PlatformInfo.isIOS ? composerStackRowPadding : EdgeInsets.zero,
      child: _WorkspaceChangesPillContent(
        summary: summary!,
        busy: busy,
        labelStyle: labelStyle,
      ),
    );

    return Padding(
      padding: composerStackOuterPadding,
      child: Center(
        child:
            PlatformInfo.isIOS &&
                Theme.of(context).brightness == Brightness.dark
            ? AdaptiveButton.child(
                onPressed: onTap ?? () {},
                style: AdaptiveButtonStyle.glass,
                size: AdaptiveButtonSize.medium,
                minSize: Size(
                  _iosWorkspaceChangesPillWidth(
                    context: context,
                    summary: summary!,
                    busy: busy,
                    labelStyle: labelStyle,
                  ),
                  36,
                ),
                enabled: true,
                useSmoothRectangleBorder: false,
                child: child,
              )
            : ComposerStackCard(
                stadium: true,
                onTap: onTap,
                padding: composerStackRowPadding,
                child: child,
              ),
      ),
    );
  }
}

double _iosWorkspaceChangesPillWidth({
  required BuildContext context,
  required WorkspaceChangesSummary summary,
  required bool busy,
  required TextStyle? labelStyle,
}) {
  double textWidth(String text, TextStyle? style) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: 1,
    )..layout();
    return painter.width;
  }

  final eco = ecoColors(context);
  final countWidth = textWidth(
    context.l10n.diffFilesChanged(summary.fileCount),
    labelStyle,
  );
  final additionsWidth = textWidth(
    '+${summary.totalAdditions}',
    TextStyle(
      color: eco.success,
      fontSize: 13,
      fontWeight: FontWeight.w600,
      height: 1.2,
    ),
  );
  final deletionsWidth = textWidth(
    '-${summary.totalDeletions}',
    TextStyle(
      color: eco.danger,
      fontSize: 13,
      fontWeight: FontWeight.w600,
      height: 1.2,
    ),
  );
  final busyWidth = busy ? 14.0 + 8.0 : 0.0;
  return composerStackRowPadding.horizontal +
      busyWidth +
      countWidth +
      8.0 +
      additionsWidth +
      4.0 +
      deletionsWidth +
      _iosNativeGlassWidthSafetyPadding;
}

class _WorkspaceChangesPillContent extends StatelessWidget {
  const _WorkspaceChangesPillContent({
    required this.summary,
    required this.busy,
    required this.labelStyle,
  });

  final WorkspaceChangesSummary summary;
  final bool busy;
  final TextStyle? labelStyle;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (busy)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: eco.composerPillText,
              ),
            ),
          ),
        Text(
          context.l10n.diffFilesChanged(summary.fileCount),
          style: labelStyle,
        ),
        const SizedBox(width: 8),
        Text(
          '+${summary.totalAdditions}',
          style: TextStyle(
            color: eco.success,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 1.2,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          '-${summary.totalDeletions}',
          style: TextStyle(
            color: eco.danger,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 1.2,
          ),
        ),
      ],
    );
  }
}
