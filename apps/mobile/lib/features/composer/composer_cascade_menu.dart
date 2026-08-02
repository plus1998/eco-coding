import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';

class ComposerMenuEntry {
  const ComposerMenuEntry({
    required this.value,
    required this.label,
    this.enabled = true,
    this.selected = false,
  }) : isDivider = false;

  const ComposerMenuEntry.divider()
    : value = '',
      label = '',
      enabled = false,
      selected = false,
      isDivider = true;

  final String value;
  final String label;
  final bool enabled;
  final bool selected;
  final bool isDivider;
}

void showComposerMenu({
  required BuildContext context,
  required GlobalKey anchorKey,
  required List<ComposerMenuEntry> entries,
  required ValueChanged<String> onSelected,
}) {
  final anchorBox = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  if (anchorBox == null || !anchorBox.hasSize) return;

  final overlayState = Overlay.of(context);
  final overlayBox = overlayState.context.findRenderObject() as RenderBox;
  final origin = anchorBox.localToGlobal(Offset.zero, ancestor: overlayBox);
  final viewPadding = MediaQuery.viewPaddingOf(context);
  final maxWidth = (overlayBox.size.width - 24).clamp(120.0, 280.0);
  final anchorRight = origin.dx + anchorBox.size.width;
  final right = (overlayBox.size.width - anchorRight).clamp(
    12.0,
    overlayBox.size.width - 12,
  );
  final maxHeight = (origin.dy - viewPadding.top - 20).clamp(120.0, 420.0);
  final bottom = overlayBox.size.height - origin.dy + 8;

  late OverlayEntry overlayEntry;
  void close() => overlayEntry.remove();

  overlayEntry = OverlayEntry(
    builder: (overlayContext) => Material(
      type: MaterialType.transparency,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: close,
              child: const ColoredBox(color: Colors.transparent),
            ),
          ),
          Positioned(
            right: right,
            bottom: bottom,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: maxWidth,
                maxHeight: maxHeight,
              ),
              child: _ComposerMenuCard(
                entries: entries,
                onSelected: (value) {
                  close();
                  onSelected(value);
                },
              ),
            ),
          ),
        ],
      ),
    ),
  );

  overlayState.insert(overlayEntry);
}

class _ComposerMenuCard extends StatelessWidget {
  const _ComposerMenuCard({
    required this.entries,
    required this.onSelected,
  });

  final List<ComposerMenuEntry> entries;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final radius = BorderRadius.circular(14);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: Colors.transparent,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: eco.shadowScrim.withValues(alpha: isDark ? 0.3 : 0.16),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          key: const ValueKey('composer-cascade-glass'),
          borderRadius: radius,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 26, sigmaY: 26),
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    eco.bgMenu.withValues(alpha: isDark ? 0.34 : 0.28),
                    eco.bgMenu.withValues(alpha: isDark ? 0.22 : 0.18),
                  ],
                ),
                borderRadius: radius,
                border: Border.all(
                  color: eco.textHeading.withValues(
                    alpha: isDark ? 0.18 : 0.38,
                  ),
                ),
              ),
              child: IntrinsicWidth(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 140),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final entry in entries)
                          if (entry.isDivider)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Divider(
                                height: 1,
                                thickness: 1,
                                indent: 12,
                                endIndent: 12,
                                color: eco.borderSubtle.withValues(alpha: 0.7),
                              ),
                            )
                          else
                            _ComposerMenuRow(
                              entry: entry,
                              onTap: !entry.enabled
                                  ? null
                                  : () => onSelected(entry.value),
                            ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ComposerMenuRow extends StatelessWidget {
  const _ComposerMenuRow({required this.entry, required this.onTap});

  final ComposerMenuEntry entry;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onTap != null;
    final primaryColor = enabled
        ? eco.textPrimary
        : eco.textMuted.withValues(alpha: 0.55);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    entry.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: primaryColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (entry.selected) ...[
                  const SizedBox(width: 10),
                  Icon(EcoIcons.check, size: 16, color: eco.accent),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
