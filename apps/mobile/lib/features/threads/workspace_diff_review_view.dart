import 'package:flutter/material.dart';

import '../../core/models/git_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/unified_diff.dart';

class WorkspaceDiffReviewView extends StatelessWidget {
  const WorkspaceDiffReviewView({
    super.key,
    required this.diff,
    required this.scrollController,
  });

  final WorkspaceDiffResult diff;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final parsedFiles = mergeDiffFilesWithStats(
      patch: diff.patch,
      files: diff.files,
    );

    if (parsedFiles.isEmpty) {
      return Center(
        child: Text(
          '工作区暂无未提交变更',
          style: TextStyle(color: ecoColors(context).textMuted),
        ),
      );
    }

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
              'Diff 内容过长，部分文件可能未完整显示',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textMuted,
                  ),
            ),
          ),
        ...parsedFiles.map((file) {
          final stats = diff.files.firstWhere(
            (entry) => entry.path == file.path,
            orElse: () => WorkspaceDiffFile(
              path: file.path,
              additions: file.additions,
              deletions: file.deletions,
            ),
          );
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _DiffFileCard(
              file: file,
              additions: stats.additions,
              deletions: stats.deletions,
            ),
          );
        }),
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
            '$fileCount 个文件已更改',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
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

class _DiffFileCard extends StatefulWidget {
  const _DiffFileCard({
    required this.file,
    required this.additions,
    required this.deletions,
  });

  final ParsedDiffFile file;
  final int additions;
  final int deletions;

  @override
  State<_DiffFileCard> createState() => _DiffFileCardState();
}

class _DiffFileCardState extends State<_DiffFileCard> {
  bool _expanded = true;

  void _toggleExpanded() {
    setState(() => _expanded = !_expanded);
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).bgElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: ecoColors(context).borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: _toggleExpanded,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
              child: Padding(
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
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.file.fileName,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 15,
                            ),
                          ),
                          if (widget.file.directory.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              widget.file.directory,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: ecoColors(context).textMuted,
                                  ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    _DiffStats(
                      additions: widget.additions,
                      deletions: widget.deletions,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_expanded) ...[
            if (widget.file.hunks.isEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: Text(
                  '暂无 diff 内容',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: ecoColors(context).textMuted,
                      ),
                ),
              )
            else
              ...widget.file.hunks.map(
                (hunk) => _DiffHunkSection(hunk: hunk),
              ),
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
    final eco = ecoColors(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
          child: Row(
            children: [
              Icon(EcoIcons.expandDown, size: 18, color: ecoColors(context).textMuted),
              const SizedBox(width: 4),
              Text(
                hunk.rangeLabel,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
              ),
              const Spacer(),
              _DiffStats(additions: hunk.additions, deletions: hunk.deletions),
            ],
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: ecoColors(context).borderSubtle),
            ),
          ),
          child: Column(
            children: [
              for (final line in hunk.lines) _DiffLineRow(line: line),
            ],
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
    final eco = ecoColors(context);
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
                  color: line.kind == DiffLineKind.deletion
                      ? ecoColors(context).statusDenyText
                      : line.kind == DiffLineKind.addition
                          ? ecoColors(context).statusAllowText
                          : ecoColors(context).textPrimary,
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
  const _DiffStats({
    required this.additions,
    required this.deletions,
  });

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
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '-$deletions',
          style: TextStyle(
            color: ecoColors(context).danger,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
