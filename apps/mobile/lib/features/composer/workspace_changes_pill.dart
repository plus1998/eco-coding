import 'package:flutter/material.dart';

import '../../core/models/git_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';

class WorkspaceChangesPill extends StatelessWidget {
  const WorkspaceChangesPill({
    super.key,
    required this.diff,
    this.busy = false,
    this.onTap,
  });

  final WorkspaceDiffResult? diff;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (diff == null || !diff!.hasChanges) {
      return const SizedBox.shrink();
    }

    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Material(
        color: eco.composerPillBg,
        shape: StadiumBorder(
          side: BorderSide(color: eco.composerPillBorder),
        ),
        child: InkWell(
          onTap: onTap,
          customBorder: const StadiumBorder(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
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
                        color: eco.textSecondary,
                      ),
                    ),
                  ),
                Text(
                  '${diff!.fileCount} 个文件已更改',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textPrimary,
                        fontWeight: FontWeight.w500,
                      ),
                ),
                const SizedBox(width: 8),
                Text(
                  '+${diff!.totalAdditions}',
                  style: TextStyle(
                    color: eco.success,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  '-${diff!.totalDeletions}',
                  style: TextStyle(
                    color: eco.danger,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(EcoIcons.chevronRight, size: 16, color: eco.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
