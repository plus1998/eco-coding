import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/project_models.dart';
import '../../core/theme/eco_theme.dart';
import 'project_providers.dart';

Future<void> showProjectActionSheet({
  required BuildContext context,
  required WidgetRef ref,
  required EcoProject project,
}) {
  if (project.isHome) return Future.value();

  final pinnedPaths = ref.read(pinnedProjectPathsProvider);
  final normalizedPath = normalizeProjectPath(project.path);
  final isPinned = pinnedPaths.any(
    (path) => normalizeProjectPath(path) == normalizedPath,
  );

  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetContext) {
      final eco = ecoColors(sheetContext);
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: Theme.of(sheetContext).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    project.path,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(sheetContext).textTheme.bodySmall?.copyWith(
                          color: ecoColors(context).textMuted,
                        ),
                  ),
                ],
              ),
            ),
            ListTile(
              leading: Icon(
                isPinned ? Icons.push_pin_outlined : Icons.push_pin,
                size: 20,
                color: ecoColors(context).textSecondary,
              ),
              title: Text(isPinned ? '取消置顶' : '置顶'),
              onTap: () async {
                Navigator.pop(sheetContext);
                if (isPinned) {
                  await ref
                      .read(pinnedProjectPathsProvider.notifier)
                      .unpin(project.path);
                } else {
                  await ref
                      .read(pinnedProjectPathsProvider.notifier)
                      .pin(project.path);
                }
              },
            ),
            ListTile(
              leading: Icon(
                Icons.delete_outline,
                size: 20,
                color: ecoColors(context).statusDenyText,
              ),
              title: Text(
                '移除项目',
                style: TextStyle(color: ecoColors(context).statusDenyText),
              ),
              onTap: () async {
                Navigator.pop(sheetContext);
                await ref
                    .read(hiddenProjectPathsProvider.notifier)
                    .removeProject(project);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      );
    },
  );
}
