import 'package:flutter/material.dart';

import '../../core/models/git_models.dart';
import '../../core/theme/eco_theme.dart';
import 'composer_stack_card.dart';

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

    return Padding(
      padding: composerStackOuterPadding,
      child: Center(
        child: ComposerStackCard(
          stadium: true,
          onTap: onTap,
          padding: composerStackRowPadding,
          child: Row(
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
                '${summary!.fileCount} 个文件已更改',
                style: labelStyle,
              ),
              const SizedBox(width: 8),
              Text(
                '+${summary!.totalAdditions}',
                style: TextStyle(
                  color: eco.success,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  height: 1.2,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                '-${summary!.totalDeletions}',
                style: TextStyle(
                  color: eco.danger,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
