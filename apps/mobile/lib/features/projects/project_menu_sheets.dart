import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
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
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('打开项目', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: eco.bgInput,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              _listing?.path ?? '正在读取 Desktop 文件夹…',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: eco.textSecondary),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 320,
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: TextStyle(color: eco.statusDenyText),
                          ),
                          const SizedBox(height: 12),
                          OutlinedButton.icon(
                            onPressed: _loadInitialDirectory,
                            icon: const Icon(EcoIcons.refresh, size: 18),
                            label: const Text('重试'),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView(
                    children: [
                      if (_listing?.parentPath != null)
                        ListTile(
                          leading: const Icon(EcoIcons.back, size: 20),
                          title: const Text('上一级'),
                          onTap: _opening
                              ? null
                              : () => _loadDirectory(_listing!.parentPath!),
                        ),
                      for (final directory in _listing?.directories ?? const [])
                        ListTile(
                          leading: const Icon(EcoIcons.folder, size: 20),
                          title: Text(
                            directory.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: const Icon(EcoIcons.chevronRight, size: 18),
                          onTap: _opening
                              ? null
                              : () => _loadDirectory(directory.path),
                        ),
                      if (_listing?.directories.isEmpty ?? false)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Center(child: Text('此文件夹没有子文件夹')),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _listing == null || _loading || _opening
                ? null
                : _openCurrentDirectory,
            child: _opening
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('打开当前文件夹'),
          ),
        ],
      ),
    );
  }
}
