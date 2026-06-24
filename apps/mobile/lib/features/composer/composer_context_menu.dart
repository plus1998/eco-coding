import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';

class ComposerContextMenuEntry {
  const ComposerContextMenuEntry({
    required this.value,
    required this.icon,
    required this.label,
    this.enabled = true,
    this.danger = false,
  });

  final String value;
  final IconData icon;
  final String label;
  final bool enabled;
  final bool danger;
}

const _menuRowHorizontalPadding = 16.0;
const _menuRowVerticalPadding = 12.0;
const _menuIconSize = 18.0;
const _menuIconGap = 10.0;
const _menuCardVerticalPadding = 6.0;
const _menuBorderRadius = 16.0;
const _menuMinWidth = 220.0;

double _menuWidthForEntries(
  BuildContext context,
  List<ComposerContextMenuEntry> entries,
) {
  final rowHorizontalPadding = _menuRowHorizontalPadding * 2;
  final textStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
        fontWeight: FontWeight.w500,
      );
  final painter = TextPainter(
    textDirection: Directionality.of(context),
    maxLines: 1,
  );
  var maxTextWidth = 0.0;
  for (final entry in entries) {
    painter.text = TextSpan(text: entry.label, style: textStyle);
    painter.layout();
    maxTextWidth = math.max(maxTextWidth, painter.width);
  }
  return math.max(
    _menuMinWidth,
    rowHorizontalPadding + _menuIconSize + _menuIconGap + maxTextWidth,
  );
}

void showComposerContextMenu({
  required BuildContext context,
  required GlobalKey anchorKey,
  required List<ComposerContextMenuEntry> entries,
  required ValueChanged<String> onSelected,
}) {
  final box = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  if (box == null || !box.hasSize) return;

  final overlayState = Overlay.of(context);
  final overlayBox = overlayState.context.findRenderObject() as RenderBox;
  final origin = box.localToGlobal(Offset.zero, ancestor: overlayBox);
  final menuWidth = _menuWidthForEntries(context, entries);
  final left = (origin.dx + box.size.width - menuWidth).clamp(
    12.0,
    overlayBox.size.width - menuWidth - 12,
  );
  final top = origin.dy + box.size.height + 4;

  late OverlayEntry entry;
  entry = OverlayEntry(
    builder: (overlayContext) {
      return Material(
        type: MaterialType.transparency,
        child: Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                onTap: () => entry.remove(),
                behavior: HitTestBehavior.opaque,
                child: ColoredBox(
                  color: ecoColors(overlayContext).shadowScrim.withValues(
                        alpha: 0.08,
                      ),
                ),
              ),
            ),
            Positioned(
              left: left,
              top: top,
              width: menuWidth,
              child: _ComposerContextMenuCard(
                entries: entries,
                onSelected: (value) {
                  entry.remove();
                  onSelected(value);
                },
              ),
            ),
          ],
        ),
      );
    },
  );

  overlayState.insert(entry);
}

class _ComposerContextMenuCard extends StatelessWidget {
  const _ComposerContextMenuCard({
    required this.entries,
    required this.onSelected,
  });

  final List<ComposerContextMenuEntry> entries;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Material(
      color: Colors.transparent,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: eco.bgMenu,
          borderRadius: BorderRadius.circular(_menuBorderRadius),
          border: Border.all(color: eco.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: eco.shadowScrim.withValues(
                alpha: Theme.of(context).brightness == Brightness.dark ? 0.28 : 0.14,
              ),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_menuBorderRadius),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: _menuCardVerticalPadding),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final entry in entries)
                  _ComposerContextMenuRow(
                    entry: entry,
                    onTap: entry.enabled ? () => onSelected(entry.value) : null,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ComposerContextMenuRow extends StatelessWidget {
  const _ComposerContextMenuRow({
    required this.entry,
    required this.onTap,
  });

  final ComposerContextMenuEntry entry;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = entry.enabled;
    final color = !enabled
        ? eco.textMuted.withValues(alpha: 0.55)
        : (entry.danger ? eco.danger : eco.textPrimary);
    final iconColor = !enabled
        ? eco.textMuted.withValues(alpha: 0.45)
        : (entry.danger ? eco.danger : eco.textSecondary);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: _menuRowHorizontalPadding,
            vertical: _menuRowVerticalPadding,
          ),
          child: Row(
            children: [
              Icon(entry.icon, size: _menuIconSize, color: iconColor),
              const SizedBox(width: _menuIconGap),
              Expanded(
                child: Text(
                  entry.label,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: color,
                        fontWeight: FontWeight.w500,
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
