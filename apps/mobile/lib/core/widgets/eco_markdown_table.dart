import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/markdown_repair.dart';

/// Feed markdown table with hover/press expand affordance (no fixed chrome).
class EcoMarkdownTable extends StatefulWidget {
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

  @override
  State<EcoMarkdownTable> createState() => _EcoMarkdownTableState();
}

class _EcoMarkdownTableState extends State<EcoMarkdownTable> {
  bool _showExpand = false;

  Future<void> _openExpanded() async {
    final eco = ecoColors(context);
    final l10n = context.l10n;
    await showDialog<void>(
      context: context,
      barrierColor: eco.bgOverlay,
      builder: (dialogContext) {
        return _TableExpandDialog(
          table: widget.table,
          title: dialogContext.l10n.markdownTableExpand,
          closeLabel: l10n.commonClose,
          muted: widget.muted,
          fontSizeScale: widget.fontSizeScale,
        );
      },
    );
  }

  void _setShowExpand(bool value) {
    if (_showExpand == value) return;
    setState(() => _showExpand = value);
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final l10n = context.l10n;

    return MouseRegion(
      onEnter: (_) => _setShowExpand(true),
      onExit: (_) => _setShowExpand(false),
      child: Listener(
        onPointerDown: (event) {
          if (event.kind == PointerDeviceKind.touch ||
              event.kind == PointerDeviceKind.stylus) {
            _setShowExpand(true);
          }
        },
        onPointerUp: (_) => _setShowExpand(false),
        onPointerCancel: (_) => _setShowExpand(false),
        child: GestureDetector(
          onLongPress: _openExpanded,
          child: Container(
            width: double.infinity,
            margin: EdgeInsets.symmetric(vertical: widget.compact ? 6 : 8),
            decoration: BoxDecoration(
              color: Color.alphaBlend(
                eco.textHeading.withValues(alpha: 0.035),
                eco.codeBg.withValues(alpha: 0.55),
              ),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: eco.textHeading.withValues(alpha: 0.08),
              ),
            ),
            clipBehavior: Clip.hardEdge,
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: _MarkdownTableView(
                    table: widget.table,
                    muted: widget.muted,
                    fontSizeScale: widget.fontSizeScale,
                    headerMaxLines: 2,
                    scrollable: true,
                  ),
                ),
                Positioned(
                  top: 4,
                  right: 4,
                  child: IgnorePointer(
                    ignoring: !_showExpand,
                    child: AnimatedOpacity(
                      opacity: _showExpand ? 1 : 0,
                      duration: const Duration(milliseconds: 120),
                      child: Material(
                        color: eco.bgElevated,
                        elevation: 2,
                        borderRadius: BorderRadius.circular(8),
                        child: IconButton(
                          tooltip: l10n.markdownTableExpand,
                          onPressed: _openExpanded,
                          icon: Icon(
                            EcoIcons.expandFullscreen,
                            size: 16,
                            color: eco.textMuted,
                          ),
                          visualDensity: VisualDensity.compact,
                          constraints: const BoxConstraints.tightFor(
                            width: 32,
                            height: 32,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TableExpandDialog extends StatelessWidget {
  const _TableExpandDialog({
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
    return Dialog(
      backgroundColor: eco.bgElevated,
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 1100,
          maxHeight: MediaQuery.sizeOf(context).height - 32,
        ),
        child: Material(
          color: eco.bgElevated,
          borderRadius: BorderRadius.circular(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: eco.textMuted,
                            ),
                      ),
                    ),
                    IconButton(
                      tooltip: closeLabel,
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(Icons.close, size: 18, color: eco.textHeading),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  decoration: BoxDecoration(
                    color: eco.cardSurface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: eco.borderSubtle),
                  ),
                  child: _MarkdownTableView(
                    table: table,
                    muted: muted,
                    fontSizeScale: fontSizeScale,
                    headerMaxLines: null,
                    scrollable: true,
                  ),
                ),
              ),
            ],
          ),
        ),
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
  });

  final MarkdownTable table;
  final bool muted;
  final double fontSizeScale;
  final int? headerMaxLines;
  final bool scrollable;

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
        decoration: BoxDecoration(
          color: eco.textHeading.withValues(alpha: 0.04),
        ),
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
      border: TableBorder(
        horizontalInside: BorderSide(color: eco.borderSubtle),
        verticalInside: BorderSide(color: eco.borderSubtle),
      ),
      children: rows,
    );

    if (!widget.scrollable) return tableWidget;

    return Scrollbar(
      controller: _scrollController,
      thumbVisibility: true,
      child: SingleChildScrollView(
        controller: _scrollController,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: tableWidget,
      ),
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
