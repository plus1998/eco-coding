import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../threads/thread_providers.dart';
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

  return showEcoActionSheet<void>(
    context: context,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const EcoSheetGrabber(),
            EcoSheetHeader(
              title: project.name,
              subtitle: project.path,
              maxTitleLines: 1,
            ),
            EcoActionSheetActions(
              items: [
                EcoActionSheetItem(
                  icon: EcoIcons.pin,
                  label: isPinned ? '取消置顶' : '置顶',
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
                EcoActionSheetItem(
                  icon: EcoIcons.delete,
                  label: '移除项目',
                  destructive: true,
                  onTap: () async {
                    Navigator.pop(sheetContext);
                    await ref
                        .read(hiddenProjectPathsProvider.notifier)
                        .removeProject(project);
                  },
                ),
              ],
            ),
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
    backgroundColor: ecoColors(context).bgMain,
    builder: (sheetContext) {
      final rpc = ref.read(desktopRpcProvider);
      return _OpenProjectSheet(
        initialPath: () async {
          if (rpc == null) throw StateError('未选择 PC');
          return rpc.getUserHomePath();
        },
        listDirectories: (path) async {
          if (rpc == null) throw StateError('未选择 PC');
          return rpc.listWorkspaceDirectories(path);
        },
        onOpen: (path) async {
          try {
            await openProjectPath(ref, path);
            if (sheetContext.mounted) {
              Navigator.pop(sheetContext);
            }
            messenger.showSnackBar(const SnackBar(content: Text('项目已打开')));
          } catch (error) {
            messenger.showSnackBar(SnackBar(content: Text(error.toString())));
            rethrow;
          }
        },
      );
    },
  );
}

class _OpenProjectSheet extends StatefulWidget {
  const _OpenProjectSheet({
    required this.initialPath,
    required this.listDirectories,
    required this.onOpen,
  });

  final Future<String> Function() initialPath;
  final Future<WorkspaceDirectoryListing> Function(String path) listDirectories;
  final Future<void> Function(String path) onOpen;

  @override
  State<_OpenProjectSheet> createState() => _OpenProjectSheetState();
}

class _OpenProjectSheetState extends State<_OpenProjectSheet> {
  WorkspaceDirectoryListing? _listing;
  String? _error;
  bool _loading = true;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    _loadInitialDirectory();
  }

  Future<void> _loadInitialDirectory() async {
    try {
      final initialPath = await widget.initialPath();
      await _loadDirectory(initialPath);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _loadDirectory(String path) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final listing = await widget.listDirectories(path);
      if (!mounted) return;
      setState(() {
        _listing = listing;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _openCurrentDirectory() async {
    final path = _listing?.path;
    if (path == null || _opening) return;
    setState(() => _opening = true);
    try {
      await widget.onOpen(path);
    } catch (_) {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(0, 0, 0, 16 + bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const EcoSheetGrabber(),
            const EcoSheetHeader(title: '打开项目'),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: ecoGroupedHorizontalInset,
              ),
              child: EcoGroupedSurface(
                margin: EdgeInsets.zero,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Text(
                  _listing?.path ?? '正在读取 Desktop 文件夹…',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: eco.textSecondary,
                        letterSpacing: -0.15,
                      ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 320,
              child: _loading
                  ? Center(
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: eco.accent,
                      ),
                    )
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _error!,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: eco.danger),
                                ),
                                const SizedBox(height: 16),
                                TextButton(
                                  onPressed: _loadInitialDirectory,
                                  child: const Text('重试'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : EcoGroupedSurface(
                          child: _OpenProjectDirectoryList(
                            listing: _listing!,
                            opening: _opening,
                            onOpenParent: (path) => _loadDirectory(path),
                            onOpenDirectory: (path) => _loadDirectory(path),
                          ),
                        ),
            ),
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: ecoGroupedHorizontalInset,
              ),
              child: FilledButton(
                onPressed: _listing == null || _loading || _opening
                    ? null
                    : _openCurrentDirectory,
                child: _opening
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: eco.onAccent,
                        ),
                      )
                    : const Text('打开当前文件夹'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OpenProjectDirectoryList extends StatelessWidget {
  const _OpenProjectDirectoryList({
    required this.listing,
    required this.opening,
    required this.onOpenParent,
    required this.onOpenDirectory,
  });

  final WorkspaceDirectoryListing listing;
  final bool opening;
  final ValueChanged<String> onOpenParent;
  final ValueChanged<String> onOpenDirectory;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final directories = listing.directories;
    final hasParent = listing.parentPath != null;

    if (directories.isEmpty && !hasParent) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(
            '此文件夹没有子文件夹',
            style: TextStyle(color: eco.textMuted),
          ),
        ),
      );
    }

    return ListView(
      children: [
        if (hasParent)
          EcoGroupedTile(
            onTap: opening ? null : () => onOpenParent(listing.parentPath!),
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            child: Row(
              children: [
                Icon(EcoIcons.back, size: 20, color: eco.accent),
                const SizedBox(width: 14),
                Text(
                  '上一级',
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontSize: 17,
                      ),
                ),
              ],
            ),
          ),
        for (var i = 0; i < directories.length; i++) ...[
          if (i > 0 || hasParent) const EcoGroupedDivider(indent: 50),
          EcoGroupedTile(
            onTap: opening
                ? null
                : () => onOpenDirectory(directories[i].path),
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            child: Row(
              children: [
                Icon(EcoIcons.folder, size: 20, color: eco.accent),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    directories[i].name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontSize: 17,
                        ),
                  ),
                ),
                Icon(
                  EcoIcons.chevronRight,
                  size: 18,
                  color: eco.textMuted.withValues(alpha: 0.45),
                ),
              ],
            ),
          ),
        ],
        if (directories.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                '此文件夹没有子文件夹',
                style: TextStyle(color: eco.textMuted),
              ),
            ),
          ),
      ],
    );
  }
}
