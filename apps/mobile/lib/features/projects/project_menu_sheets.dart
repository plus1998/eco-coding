import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/project_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_modal_sheet.dart';
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

  return showEcoModalBottomSheet<void>(
    context: context,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetContext) {
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
                isPinned ? EcoIcons.pin : EcoIcons.pin,
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
                EcoIcons.delete,
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

Future<void> showOpenProjectSheet({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final messenger = ScaffoldMessenger.of(context);

  await showEcoModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) {
      return _OpenProjectSheet(
        onOpen: (path) async {
          try {
            await openProjectPath(ref, path);
            if (sheetContext.mounted) {
              Navigator.pop(sheetContext);
            }
            messenger.showSnackBar(
              const SnackBar(content: Text('项目已打开')),
            );
          } catch (error) {
            messenger.showSnackBar(
              SnackBar(content: Text(error.toString())),
            );
            rethrow;
          }
        },
      );
    },
  );
}

class _OpenProjectSheet extends StatefulWidget {
  const _OpenProjectSheet({required this.onOpen});

  final Future<void> Function(String path) onOpen;

  @override
  State<_OpenProjectSheet> createState() => _OpenProjectSheetState();
}

class _OpenProjectSheetState extends State<_OpenProjectSheet> {
  final _pathController = TextEditingController();
  bool _opening = false;

  @override
  void dispose() {
    _pathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('打开项目', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            '输入 Desktop 上的项目绝对路径',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted,
                ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _pathController,
            enabled: !_opening,
            decoration: const InputDecoration(
              labelText: '项目路径',
              hintText: '/Users/you/projects/my-app',
            ),
            autofocus: true,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _opening
                ? null
                : () async {
                    final path = _pathController.text.trim();
                    if (path.isEmpty) return;
                    setState(() => _opening = true);
                    try {
                      await widget.onOpen(path);
                    } catch (_) {
                      if (mounted) {
                        setState(() => _opening = false);
                      }
                    }
                  },
            child: _opening
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('打开'),
          ),
        ],
      ),
    );
  }
}
