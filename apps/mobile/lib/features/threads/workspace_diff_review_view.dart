import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/git_models.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/unified_diff.dart';
import '../../core/widgets/eco_surface_card.dart';

class WorkspaceDiffReviewView extends StatelessWidget {
  const WorkspaceDiffReviewView({
    super.key,
    required this.diff,
    required this.scrollController,
    required this.workspacePath,
    required this.rpc,
  });

  final WorkspaceDiffResult diff;
  final ScrollController scrollController;
  final String workspacePath;
  final DesktopRpc rpc;

  @override
  Widget build(BuildContext context) {
    final parsedFiles = mergeDiffFilesWithStats(
      patch: diff.patch,
      files: diff.files,
    );

    if (parsedFiles.isEmpty) {
      return Center(
        child: Text(
          context.l10n.diffNoChanges,
          style: TextStyle(color: ecoColors(context).textMuted),
        ),
      );
    }

    final entries = <String, _DiffTreeFile>{
      for (final file in parsedFiles)
        file.path: _DiffTreeFile(
          parsed: file,
          stats: diff.files.firstWhere(
            (entry) => entry.path == file.path,
            orElse: () => WorkspaceDiffFile(
              path: file.path,
              additions: file.additions,
              deletions: file.deletions,
            ),
          ),
        ),
    };
    final diffTree = _buildDiffTree(entries.values.toList());

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        _ReviewHeader(
          fileCount: diff.fileCount,
          totalAdditions: diff.totalAdditions,
          totalDeletions: diff.totalDeletions,
        ),
        if (diff.patchTruncated)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              context.l10n.diffTruncated,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: ecoColors(context).textMuted,
              ),
            ),
          ),
        ...diffTree.map(
          (node) => _DiffTreeTile(
            key: ValueKey('diff-tree-${node.key}'),
            node: node,
            revisionToken: diff,
            workspacePath: workspacePath,
            rpc: rpc,
          ),
        ),
      ],
    );
  }
}

class _ReviewHeader extends StatelessWidget {
  const _ReviewHeader({
    required this.fileCount,
    required this.totalAdditions,
    required this.totalDeletions,
  });

  final int fileCount;
  final int totalAdditions;
  final int totalDeletions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.l10n.diffFilesChanged(fileCount),
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Text(
                '+$totalAdditions',
                style: TextStyle(
                  color: ecoColors(context).success,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '-$totalDeletions',
                style: TextStyle(
                  color: ecoColors(context).danger,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DiffTreeFile {
  const _DiffTreeFile({required this.parsed, required this.stats});

  final ParsedDiffFile parsed;
  final WorkspaceDiffFile stats;
}

class _DiffTreeNode {
  _DiffTreeNode({
    required this.label,
    required this.key,
    required this.isFile,
    required this.children,
    this.file,
  });

  String label;
  List<_DiffTreeNode> children;
  final String key;
  final bool isFile;
  final _DiffTreeFile? file;

  int get additions {
    if (file != null) return file!.stats.additions;
    return children.fold(0, (sum, child) => sum + child.additions);
  }

  int get deletions {
    if (file != null) return file!.stats.deletions;
    return children.fold(0, (sum, child) => sum + child.deletions);
  }
}

List<_DiffTreeNode> _buildDiffTree(List<_DiffTreeFile> files) {
  final root = _DiffTreeNode(
    label: '',
    key: '',
    isFile: false,
    children: <_DiffTreeNode>[],
  );

  for (final entry in files) {
    final segments = entry.parsed.path
        .replaceAll('\\', '/')
        .split('/')
        .where((segment) => segment.isNotEmpty)
        .toList();
    var parent = root;
    var currentPath = '';

    for (var index = 0; index < segments.length; index++) {
      final segment = segments[index];
      currentPath = currentPath.isEmpty ? segment : '$currentPath/$segment';
      final isFile = index == segments.length - 1;
      final existing = parent.children.where((node) {
        if (node.isFile != isFile) return false;
        return isFile ? node.key == entry.parsed.path : node.key == currentPath;
      }).firstOrNull;

      final child =
          existing ??
          _DiffTreeNode(
            label: segment,
            key: isFile ? entry.parsed.path : currentPath,
            isFile: isFile,
            children: <_DiffTreeNode>[],
            file: isFile ? entry : null,
          );
      if (!parent.children.contains(child)) {
        parent.children = [...parent.children, child];
      }
      parent = child;
    }
  }

  void sortAndCompact(_DiffTreeNode node) {
    final sortedChildren = [...node.children]
      ..sort((a, b) {
        if (a.isFile != b.isFile) return a.isFile ? 1 : -1;
        return a.label.toLowerCase().compareTo(b.label.toLowerCase());
      });
    node.children = sortedChildren;
    for (final child in node.children) {
      sortAndCompact(child);
    }

    while (node.children.length == 1 && !node.children.first.isFile) {
      final child = node.children.single;
      node.label = node.label.isEmpty
          ? child.label
          : '${node.label}/${child.label}';
      node.children = child.children;
    }
  }

  sortAndCompact(root);
  return root.children;
}

/// Review-only rules should sit behind the content, not compete with card
/// edges. `borderSubtle` is stronger than EcoSurfaceCard's effective border.
Color _reviewHairline(BuildContext context) {
  final base = ecoColors(context).borderSubtle;
  return base.withValues(alpha: base.a * 0.42);
}

class _DiffTreeTile extends StatefulWidget {
  const _DiffTreeTile({
    super.key,
    required this.node,
    required this.revisionToken,
    required this.workspacePath,
    required this.rpc,
  });

  final _DiffTreeNode node;
  final Object revisionToken;
  final String workspacePath;
  final DesktopRpc rpc;

  @override
  State<_DiffTreeTile> createState() => _DiffTreeTileState();
}

class _DiffTreeTileState extends State<_DiffTreeTile> {
  bool _expanded = true;

  @override
  void didUpdateWidget(covariant _DiffTreeTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.node.key != oldWidget.node.key) {
      _expanded = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final node = widget.node;

    if (node.isFile) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: _DiffFileCard(
          file: node.file!.parsed,
          additions: node.file!.stats.additions,
          deletions: node.file!.stats.deletions,
          revisionToken: widget.revisionToken,
          workspacePath: widget.workspacePath,
          rpc: widget.rpc,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
              child: Row(
                children: [
                  Icon(
                    _expanded ? EcoIcons.expandUp : EcoIcons.expandDown,
                    size: 18,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 6),
                  Icon(
                    _expanded ? EcoIcons.folderOpen : EcoIcons.folder,
                    size: 17,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      node.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.textSecondary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _DiffStats(
                    additions: node.additions,
                    deletions: node.deletions,
                  ),
                ],
              ),
            ),
          ),
        ),
        if (_expanded)
          Padding(
            padding: const EdgeInsets.only(left: 12, bottom: 6),
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(color: _reviewHairline(context), width: 0.6),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.only(left: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final child in node.children)
                      _DiffTreeTile(
                        key: ValueKey('diff-tree-${child.key}'),
                        node: child,
                        revisionToken: widget.revisionToken,
                        workspacePath: widget.workspacePath,
                        rpc: widget.rpc,
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _DiffFileCard extends StatefulWidget {
  const _DiffFileCard({
    required this.file,
    required this.additions,
    required this.deletions,
    required this.revisionToken,
    required this.workspacePath,
    required this.rpc,
  });

  final ParsedDiffFile file;
  final int additions;
  final int deletions;
  final Object revisionToken;
  final String workspacePath;
  final DesktopRpc rpc;

  @override
  State<_DiffFileCard> createState() => _DiffFileCardState();
}

class _DiffFileCardState extends State<_DiffFileCard> {
  bool _expanded = false;
  bool _loading = false;
  String? _error;
  bool _patchTruncated = false;
  List<DiffHunk>? _hunks;
  int _loadGeneration = 0;

  @override
  void didUpdateWidget(covariant _DiffFileCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final revisionChanged = !identical(
      widget.revisionToken,
      oldWidget.revisionToken,
    );
    final pathChanged = widget.file.path != oldWidget.file.path;
    if (!revisionChanged && !pathChanged) {
      return;
    }

    _loadGeneration++;
    _hunks = null;
    _loading = false;
    _error = null;
    if (_expanded) {
      _load();
    }
  }

  Future<void> _toggleExpanded() async {
    if (_expanded) {
      setState(() => _expanded = false);
      return;
    }

    setState(() {
      _expanded = true;
      _error = null;
    });

    if (_hunks != null || _loading) {
      return;
    }

    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final generation = ++_loadGeneration;
    try {
      final result = await widget.rpc.getWorkspaceFileDiff(
        workspacePath: widget.workspacePath,
        path: widget.file.path,
      );
      if (!mounted || generation != _loadGeneration) {
        return;
      }

      final parsed = parseUnifiedDiff(result.patch);
      final matched = parsed.where((entry) => entry.path == widget.file.path);
      final hunks = matched.isNotEmpty
          ? matched.expand((entry) => entry.hunks).toList()
          : parsed.expand((entry) => entry.hunks).toList();
      setState(() {
        _hunks = hunks;
        _patchTruncated = result.patchTruncated;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted || generation != _loadGeneration) {
        return;
      }
      setState(() {
        _loading = false;
        _error = error.toString();
        _hunks = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return EcoSurfaceCard(
      onTap: _toggleExpanded,
      borderRadius: BorderRadius.circular(14),
      borderColor: ecoColors(context).borderSubtle,
      backgroundColor: ecoColors(context).bgElevated,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 1),
                  child: Icon(
                    _expanded ? EcoIcons.expandUp : EcoIcons.expandDown,
                    size: 20,
                    color: ecoColors(context).textMuted,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    widget.file.fileName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                ),
                _DiffStats(
                  additions: widget.additions,
                  deletions: widget.deletions,
                ),
              ],
            ),
          ),
          if (_expanded) ...[
            if (_loading)
              const Padding(
                padding: EdgeInsets.fromLTRB(14, 0, 14, 16),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: Text(
                  _error!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).danger,
                  ),
                ),
              )
            else ...[
              if (_patchTruncated)
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                  child: Text(
                    context.l10n.diffTruncated,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textMuted,
                    ),
                  ),
                ),
              if ((_hunks ?? const <DiffHunk>[]).isEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                  child: Text(
                    context.l10n.diffNoContent,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textMuted,
                    ),
                  ),
                )
              else
                ...(_hunks!).map((hunk) => _DiffHunkSection(hunk: hunk)),
            ],
          ],
        ],
      ),
    );
  }
}

class _DiffHunkSection extends StatelessWidget {
  const _DiffHunkSection({required this.hunk});

  final DiffHunk hunk;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
          child: Row(
            children: [
              Icon(
                EcoIcons.expandDown,
                size: 18,
                color: ecoColors(context).textMuted,
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  hunk.rangeLabel(context.l10n),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textSecondary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              _DiffStats(additions: hunk.additions, deletions: hunk.deletions),
            ],
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: _reviewHairline(context), width: 0.6),
            ),
          ),
          child: Column(
            children: [for (final line in hunk.lines) _DiffLineRow(line: line)],
          ),
        ),
      ],
    );
  }
}

class _DiffLineRow extends StatelessWidget {
  const _DiffLineRow({required this.line});

  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    Color? background;
    switch (line.kind) {
      case DiffLineKind.addition:
        background = ecoColors(context).statusAllowBg;
      case DiffLineKind.deletion:
        background = ecoColors(context).statusDenyBg;
      case DiffLineKind.context:
        background = null;
    }

    final gutter = line.kind == DiffLineKind.deletion
        ? (line.oldLineNumber?.toString() ?? '')
        : (line.newLineNumber?.toString() ?? '');

    return DecoratedBox(
      decoration: BoxDecoration(color: background),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 42,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 3, 4, 3),
              child: Text(
                gutter,
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontFamily: 'Menlo',
                  fontFamilyFallback: const ['monospace'],
                  fontSize: 11,
                  color: ecoColors(context).textMuted,
                  height: 1.45,
                ),
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 3, 10, 3),
              child: Text(
                line.content,
                style: TextStyle(
                  fontFamily: 'Menlo',
                  fontFamilyFallback: const ['monospace'],
                  fontSize: 12,
                  height: 1.45,
                  color: ecoColors(context).textPrimary,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffStats extends StatelessWidget {
  const _DiffStats({required this.additions, required this.deletions});

  final int additions;
  final int deletions;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '+$additions',
          style: TextStyle(
            color: ecoColors(context).success,
            fontWeight: FontWeight.w600,
            fontSize: 12,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '-$deletions',
          style: TextStyle(
            color: ecoColors(context).danger,
            fontWeight: FontWeight.w600,
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}
