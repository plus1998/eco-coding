import 'package:flutter/material.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/markdown_repair.dart';
import 'eco_action_sheet.dart';
import 'eco_modal_sheet.dart';

const _previewChromeHeight = 112.0;
const _previewTablePadding = 32.0;

/// Estimates rendered table body height for preview sheet sizing.
double estimateMarkdownTableBodyHeight({
  required BuildContext context,
  required MarkdownTable table,
  required double fontSizeScale,
  bool includeScrollBar = true,
}) {
  final baseFontSize =
      (Theme.of(context).textTheme.bodyMedium?.fontSize ?? 13) * fontSizeScale;
  const cellVerticalPadding = 12.0;
  final bodyLineHeight = baseFontSize * 1.45 + cellVerticalPadding;
  final headerLineHeight = (baseFontSize - 0.5) * 1.35 + cellVerticalPadding;
  final tableHeight = headerLineHeight + table.rows.length * bodyLineHeight;
  final scrollBarHeight = includeScrollBar ? 26.0 : 0.0;
  return tableHeight + scrollBarHeight;
}

double estimateTablePreviewSheetFraction({
  required BuildContext context,
  required MarkdownTable table,
  required double fontSizeScale,
}) {
  final screenHeight = MediaQuery.sizeOf(context).height;
  if (screenHeight <= 0) return 0.78;

  final tableHeight = estimateMarkdownTableBodyHeight(
    context: context,
    table: table,
    fontSizeScale: fontSizeScale,
  );
  final safeBottom = MediaQuery.paddingOf(context).bottom;
  final desiredHeight =
      _previewChromeHeight + _previewTablePadding + tableHeight + safeBottom;
  return (desiredHeight / screenHeight).clamp(0.24, 0.96);
}

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
        final screenHeight = MediaQuery.sizeOf(sheetContext).height;
        var wideLayout = false;
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final sheetFraction = wideLayout
                ? 0.96
                : estimateTablePreviewSheetFraction(
                    context: sheetContext,
                    table: table,
                    fontSizeScale: fontSizeScale,
                  );
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
              ),
              child: SizedBox(
                height: screenHeight * sheetFraction,
                child: _TablePreviewSheet(
                  table: table,
                  title: sheetContext.l10n.markdownTableExpand,
                  closeLabel: sheetContext.l10n.commonClose,
                  wideLayoutLabel: sheetContext.l10n.markdownTableRotateLandscape,
                  portraitLayoutLabel:
                      sheetContext.l10n.markdownTableRotatePortrait,
                  muted: muted,
                  fontSizeScale: fontSizeScale,
                  wideLayout: wideLayout,
                  onWideLayoutChanged: (wide) {
                    setSheetState(() => wideLayout = wide);
                  },
                ),
              ),
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
          child: Ink(
            decoration: BoxDecoration(
              color: eco.cardSurface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: eco.cardSurfaceBorder),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(13),
              clipBehavior: Clip.antiAlias,
              child: _MarkdownTableView(
                table: table,
                muted: muted,
                fontSizeScale: fontSizeScale,
                headerMaxLines: 2,
                scrollable: true,
                showScrollBar: true,
                includeOuterBorder: false,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TablePreviewSheet extends StatefulWidget {
  const _TablePreviewSheet({
    required this.table,
    required this.title,
    required this.closeLabel,
    required this.wideLayoutLabel,
    required this.portraitLayoutLabel,
    required this.muted,
    required this.fontSizeScale,
    required this.wideLayout,
    required this.onWideLayoutChanged,
  });

  final MarkdownTable table;
  final String title;
  final String closeLabel;
  final String wideLayoutLabel;
  final String portraitLayoutLabel;
  final bool muted;
  final double fontSizeScale;
  final bool wideLayout;
  final ValueChanged<bool> onWideLayoutChanged;

  @override
  State<_TablePreviewSheet> createState() => _TablePreviewSheetState();
}

class _TablePreviewSheetState extends State<_TablePreviewSheet> {
  Widget _buildTableCard({
    required double viewportWidth,
    bool shrinkWrap = false,
  }) {
    final eco = ecoColors(context);
    final tableView = _MarkdownTableView(
      table: widget.table,
      muted: widget.muted,
      fontSizeScale: widget.fontSizeScale,
      headerMaxLines: null,
      scrollable: true,
      showScrollBar: true,
      includeOuterBorder: false,
      viewportWidth: shrinkWrap ? null : viewportWidth,
    );
    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: eco.cardSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: eco.cardSurfaceBorder),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: tableView,
      ),
    );
    if (!shrinkWrap) return card;
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: viewportWidth),
      child: IntrinsicWidth(child: card),
    );
  }

  /// Landscape preview: rotate content so sheet height becomes table layout width.
  Widget _buildLandscapeTable({
    required BoxConstraints constraints,
  }) {
    final layoutWidth = constraints.maxHeight;
    final layoutHeight = constraints.maxWidth;
    return Center(
      child: RotatedBox(
        quarterTurns: 1,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: layoutWidth,
            maxHeight: layoutHeight,
          ),
          child: SingleChildScrollView(
            child: _buildTableCard(
              viewportWidth: layoutWidth,
              shrinkWrap: true,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final horizontalPadding = widget.wideLayout ? 8.0 : 16.0;
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
                      widget.title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: eco.textHeading,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: widget.wideLayout
                      ? widget.portraitLayoutLabel
                      : widget.wideLayoutLabel,
                  onPressed: () =>
                      widget.onWideLayoutChanged(!widget.wideLayout),
                  icon: Icon(
                    widget.wideLayout
                        ? EcoIcons.galleryVertical
                        : EcoIcons.galleryHorizontal,
                    color: widget.wideLayout ? eco.accentText : eco.textHeading,
                  ),
                ),
                IconButton(
                  tooltip: widget.closeLabel,
                  onPressed: () => Navigator.of(context).pop(),
                  icon: Icon(EcoIcons.close, color: eco.textHeading),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                horizontalPadding,
                0,
                horizontalPadding,
                16,
              ),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  if (widget.wideLayout) {
                    return _buildLandscapeTable(constraints: constraints);
                  }
                  return Align(
                    alignment: Alignment.topCenter,
                    child: SingleChildScrollView(
                      child: _buildTableCard(
                        viewportWidth: constraints.maxWidth,
                      ),
                    ),
                  );
                },
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
    this.includeOuterBorder = true,
    this.viewportWidth,
  });

  final MarkdownTable table;
  final bool muted;
  final double fontSizeScale;
  final int? headerMaxLines;
  final bool scrollable;
  final bool showScrollBar;
  final bool includeOuterBorder;
  /// When set, horizontal scroll viewport uses this width for layout (landscape preview).
  final double? viewportWidth;

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
      border: widget.includeOuterBorder
          ? TableBorder.all(color: eco.cardSurfaceBorder)
          : TableBorder(
              horizontalInside: BorderSide(color: eco.cardSurfaceBorder),
              verticalInside: BorderSide(color: eco.cardSurfaceBorder),
            ),
      children: rows,
    );

    if (!widget.scrollable) return tableWidget;

    final horizontalScroll = SingleChildScrollView(
      controller: _scrollController,
      scrollDirection: Axis.horizontal,
      clipBehavior: Clip.hardEdge,
      child: tableWidget,
    );

    final tableColumn = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        horizontalScroll,
        if (widget.showScrollBar)
          _HorizontalTableScrollBar(controller: _scrollController),
      ],
    );

    if (widget.viewportWidth == null) return tableColumn;

    // Fixed viewport width — IntrinsicWidth breaks horizontal scroll extents.
    return SizedBox(
      width: widget.viewportWidth,
      child: tableColumn,
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
class _HorizontalTableScrollBar extends StatefulWidget {
  const _HorizontalTableScrollBar({required this.controller});

  final ScrollController controller;

  @override
  State<_HorizontalTableScrollBar> createState() =>
      _HorizontalTableScrollBarState();
}

class _HorizontalTableScrollBarState extends State<_HorizontalTableScrollBar> {
  bool _tableScrolling = false;
  bool _thumbDragging = false;
  ScrollPosition? _position;

  bool get _visible => _tableScrolling || _thumbDragging;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_syncPositionListener);
  }

  @override
  void didUpdateWidget(covariant _HorizontalTableScrollBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_syncPositionListener);
      _detachPositionListener();
      widget.controller.addListener(_syncPositionListener);
    }
    _syncPositionListener();
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncPositionListener);
    _detachPositionListener();
    super.dispose();
  }

  void _syncPositionListener() {
    if (!widget.controller.hasClients) {
      _detachPositionListener();
      return;
    }
    final position = widget.controller.position;
    if (_position == position) return;
    _detachPositionListener();
    _position = position;
    position.isScrollingNotifier.addListener(_onScrollingChanged);
    _onScrollingChanged();
  }

  void _detachPositionListener() {
    _position?.isScrollingNotifier.removeListener(_onScrollingChanged);
    _position = null;
  }

  void _onScrollingChanged() {
    if (!mounted || _position == null) return;
    final scrolling = _position!.isScrollingNotifier.value;
    if (scrolling == _tableScrolling) return;
    setState(() => _tableScrolling = scrolling);
  }

  void _setThumbDragging(bool dragging) {
    if (_thumbDragging == dragging) return;
    setState(() => _thumbDragging = dragging);
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        if (!widget.controller.hasClients) {
          return const SizedBox.shrink();
        }
        final position = widget.controller.position;
        if (!position.hasContentDimensions) {
          return const SizedBox.shrink();
        }
        if (position.maxScrollExtent <= 0) {
          return const SizedBox.shrink();
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

            return ClipRect(
              child: AnimatedAlign(
                alignment: Alignment.topCenter,
                heightFactor: _visible ? 1 : 0,
                duration: const Duration(milliseconds: 160),
                curve: Curves.easeOut,
                child: AnimatedOpacity(
                  opacity: _visible ? 1 : 0,
                  duration: const Duration(milliseconds: 160),
                  curve: Curves.easeOut,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(0, 6, 0, 4),
                    child: SizedBox(
                      height: 16,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onHorizontalDragStart: (_) => _setThumbDragging(true),
                        onHorizontalDragEnd: (_) => _setThumbDragging(false),
                        onHorizontalDragCancel: () => _setThumbDragging(false),
                        onHorizontalDragUpdate: (details) {
                          if (!widget.controller.hasClients) return;
                          final maxExtent =
                              widget.controller.position.maxScrollExtent;
                          if (maxExtent <= 0) return;
                          final deltaFraction = details.delta.dx / trackWidth;
                          widget.controller.jumpTo(
                            (widget.controller.offset + deltaFraction * extent)
                                .clamp(0.0, maxExtent),
                          );
                        },
                        onTapDown: (details) {
                          if (!widget.controller.hasClients) return;
                          final maxExtent =
                              widget.controller.position.maxScrollExtent;
                          if (maxExtent <= 0) return;
                          final localX =
                              details.localPosition.dx.clamp(0.0, trackWidth);
                          final targetFraction = trackWidth <= thumbWidth
                              ? 0.0
                              : ((localX - thumbWidth / 2) /
                                      (trackWidth - thumbWidth))
                                  .clamp(0.0, 1.0);
                          widget.controller.jumpTo(targetFraction * maxExtent);
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
