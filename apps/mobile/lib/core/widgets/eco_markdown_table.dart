import 'package:flutter/material.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/markdown_repair.dart';
import 'eco_action_sheet.dart';
import 'eco_modal_sheet.dart';

/// Feed markdown table. Tap opens a bottom-sheet preview; wide tables scroll horizontally.
class EcoMarkdownTable extends StatelessWidget {
  const EcoMarkdownTable({
    super.key,
    required this.table,
    this.compact = false,
    this.muted = false,
    this.fontSizeScale = 1,
  });

  final MarkdownTable table;
  final bool compact;
  final bool muted;
  final double fontSizeScale;

  Future<void> _openExpanded(BuildContext context) async {
    await showEcoModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.78,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          builder: (context, scrollController) {
            return _TablePreviewSheet(
              table: table,
              title: sheetContext.l10n.markdownTableExpand,
              closeLabel: sheetContext.l10n.commonClose,
              muted: muted,
              fontSizeScale: fontSizeScale,
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final l10n = context.l10n;

    return Semantics(
      button: true,
      label: l10n.markdownTableExpand,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _openExpanded(context),
          borderRadius: BorderRadius.circular(14),
          splashColor: eco.navHover,
          highlightColor: eco.navHover.withValues(alpha: 0.65),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: _MarkdownTableView(
              table: table,
              muted: muted,
              fontSizeScale: fontSizeScale,
              headerMaxLines: 2,
              scrollable: true,
              showScrollBar: true,
            ),
          ),
        ),
      ),
    );
  }
}

class _TablePreviewSheet extends StatelessWidget {
  const _TablePreviewSheet({
    required this.table,
    required this.title,
    required this.closeLabel,
    required this.muted,
    required this.fontSizeScale,
  });

  final MarkdownTable table;
  final String title;
  final String closeLabel;
  final bool muted;
  final double fontSizeScale;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      top: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          const EcoSheetGrabber(),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 4, 0),
            child: Row(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: eco.textHeading,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: closeLabel,
                  onPressed: () => Navigator.of(context).pop(),
                  icon: Icon(EcoIcons.close, color: eco.textHeading),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: eco.cardSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: eco.cardSurfaceBorder),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: _MarkdownTableView(
                    table: table,
                    muted: muted,
                    fontSizeScale: fontSizeScale,
                    headerMaxLines: null,
                    scrollable: true,
                    showScrollBar: true,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MarkdownTableView extends StatefulWidget {
  const _MarkdownTableView({
    required this.table,
    required this.muted,
    required this.fontSizeScale,
    required this.headerMaxLines,
    required this.scrollable,
    required this.showScrollBar,
  });

  final MarkdownTable table;
  final bool muted;
  final double fontSizeScale;
  final int? headerMaxLines;
  final bool scrollable;
  final bool showScrollBar;

  @override
  State<_MarkdownTableView> createState() => _MarkdownTableViewState();
}

class _MarkdownTableViewState extends State<_MarkdownTableView> {
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final baseStyle = Theme.of(context).textTheme.bodyMedium;
    final bodyStyle = baseStyle?.copyWith(
      fontSize: (baseStyle.fontSize ?? 13) * widget.fontSizeScale,
      height: 1.45,
      color: widget.muted
          ? eco.textMuted.withValues(alpha: 0.85)
          : eco.textHeading,
    );
    final headStyle = bodyStyle?.copyWith(
      fontWeight: FontWeight.w600,
      fontSize: (bodyStyle.fontSize ?? 13) - 0.5,
      height: 1.35,
      color: widget.muted ? eco.textMuted : eco.textSecondary,
    );

    final columnCount = widget.table.header.length;
    final rows = <TableRow>[
      TableRow(
        decoration: BoxDecoration(color: eco.navHover),
        children: [
          for (final cell in widget.table.header)
            _cell(
              text: cell,
              style: headStyle,
              maxLines: widget.headerMaxLines,
            ),
        ],
      ),
      for (final row in widget.table.rows)
        TableRow(
          children: [
            for (var i = 0; i < columnCount; i += 1)
              _cell(
                text: i < row.length ? row[i] : '',
                style: bodyStyle,
                maxLines: null,
              ),
          ],
        ),
    ];

    final tableWidget = Table(
      defaultColumnWidth: const IntrinsicColumnWidth(),
      defaultVerticalAlignment: TableCellVerticalAlignment.top,
      border: TableBorder.all(color: eco.cardSurfaceBorder),
      children: rows,
    );

    if (!widget.scrollable) return tableWidget;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SingleChildScrollView(
          controller: _scrollController,
          scrollDirection: Axis.horizontal,
          child: tableWidget,
        ),
        if (widget.showScrollBar)
          _HorizontalTableScrollBar(controller: _scrollController),
      ],
    );
  }

  Widget _cell({
    required String text,
    required TextStyle? style,
    required int? maxLines,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      child: Text(
        text,
        style: style,
        maxLines: maxLines,
        overflow: maxLines == null ? TextOverflow.visible : TextOverflow.ellipsis,
        softWrap: true,
      ),
    );
  }
}

/// Bottom-aligned horizontal scroll track (avoids Flutter [Scrollbar] drawing through tall tables).
class _HorizontalTableScrollBar extends StatelessWidget {
  const _HorizontalTableScrollBar({required this.controller});

  final ScrollController controller;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        if (!controller.hasClients) {
          return const SizedBox(height: 8);
        }
        final position = controller.position;
        if (!position.hasContentDimensions) {
          return const SizedBox(height: 8);
        }
        if (position.maxScrollExtent <= 0) {
          return const SizedBox(height: 8);
        }
        final viewport = position.viewportDimension;
        final extent = position.maxScrollExtent + viewport;
        final thumbFraction = (viewport / extent).clamp(0.1, 1.0);
        final scrollFraction = extent <= viewport
            ? 0.0
            : (position.pixels / (extent - viewport)).clamp(0.0, 1.0);

        return LayoutBuilder(
          builder: (context, constraints) {
            final trackWidth = constraints.maxWidth;
            final thumbWidth = trackWidth * thumbFraction;
            final thumbLeft = (trackWidth - thumbWidth) * scrollFraction;

            return Padding(
              padding: const EdgeInsets.fromLTRB(0, 6, 0, 4),
              child: SizedBox(
                height: 16,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onHorizontalDragUpdate: (details) {
                    if (!controller.hasClients) return;
                    final maxExtent = controller.position.maxScrollExtent;
                    if (maxExtent <= 0) return;
                    final deltaFraction = details.delta.dx / trackWidth;
                    controller.jumpTo(
                      (controller.offset + deltaFraction * extent)
                          .clamp(0.0, maxExtent),
                    );
                  },
                  onTapDown: (details) {
                    if (!controller.hasClients) return;
                    final maxExtent = controller.position.maxScrollExtent;
                    if (maxExtent <= 0) return;
                    final localX = details.localPosition.dx.clamp(0.0, trackWidth);
                    final targetFraction = trackWidth <= thumbWidth
                        ? 0.0
                        : ((localX - thumbWidth / 2) / (trackWidth - thumbWidth))
                            .clamp(0.0, 1.0);
                    controller.jumpTo(targetFraction * maxExtent);
                  },
                  child: Stack(
                    alignment: Alignment.centerLeft,
                    children: [
                      Positioned(
                        left: 0,
                        right: 0,
                        top: 6,
                        bottom: 6,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: eco.textMuted.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      ),
                      Positioned(
                        left: thumbLeft,
                        width: thumbWidth,
                        top: 6,
                        bottom: 6,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: eco.textMuted.withValues(alpha: 0.52),
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
