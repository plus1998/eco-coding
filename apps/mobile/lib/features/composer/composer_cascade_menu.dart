import 'package:flutter/material.dart';

import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';

class ComposerCascadeMenuEntry {
  const ComposerCascadeMenuEntry({
    required this.value,
    required this.label,
    this.icon,
    this.detail,
    this.enabled = true,
    this.selected = false,
    this.submenu,
  });

  final String value;
  final String label;
  final IconData? icon;
  final String? detail;
  final bool enabled;
  final bool selected;
  final String? submenu;
}

class ComposerCascadeMenuPage {
  const ComposerCascadeMenuPage({required this.entries, this.title});

  final String? title;
  final List<ComposerCascadeMenuEntry> entries;
}

void showComposerCascadeMenu({
  required BuildContext context,
  required GlobalKey anchorKey,
  required ComposerCascadeMenuPage root,
  required Map<String, ComposerCascadeMenuPage> submenus,
  required ValueChanged<String> onSelected,
}) {
  final anchorBox = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  if (anchorBox == null || !anchorBox.hasSize) return;

  final overlayState = Overlay.of(context);
  final overlayBox = overlayState.context.findRenderObject() as RenderBox;
  final origin = anchorBox.localToGlobal(Offset.zero, ancestor: overlayBox);
  final viewPadding = MediaQuery.viewPaddingOf(context);
  final menuWidth = (overlayBox.size.width - 24).clamp(0.0, 280.0);
  final left = (origin.dx + anchorBox.size.width - menuWidth).clamp(
    12.0,
    overlayBox.size.width - menuWidth - 12,
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
              child: ColoredBox(
                color: ecoColors(
                  overlayContext,
                ).shadowScrim.withValues(alpha: 0.08),
              ),
            ),
          ),
          Positioned(
            left: left,
            bottom: bottom,
            width: menuWidth,
            child: _ComposerCascadeMenuCard(
              root: root,
              submenus: submenus,
              maxHeight: maxHeight,
              onClose: close,
              onSelected: (value) {
                close();
                onSelected(value);
              },
            ),
          ),
        ],
      ),
    ),
  );

  overlayState.insert(overlayEntry);
}

class _ComposerCascadeMenuCard extends StatefulWidget {
  const _ComposerCascadeMenuCard({
    required this.root,
    required this.submenus,
    required this.maxHeight,
    required this.onClose,
    required this.onSelected,
  });

  final ComposerCascadeMenuPage root;
  final Map<String, ComposerCascadeMenuPage> submenus;
  final double maxHeight;
  final VoidCallback onClose;
  final ValueChanged<String> onSelected;

  @override
  State<_ComposerCascadeMenuCard> createState() =>
      _ComposerCascadeMenuCardState();
}

class _ComposerCascadeMenuCardState extends State<_ComposerCascadeMenuCard> {
  String? _pageKey;

  ComposerCascadeMenuPage get _page =>
      _pageKey == null ? widget.root : widget.submenus[_pageKey]!;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final page = _page;

    return Material(
      color: Colors.transparent,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: widget.maxHeight),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: eco.bgMenu,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: eco.borderSubtle),
            boxShadow: [
              BoxShadow(
                color: eco.shadowScrim.withValues(
                  alpha: Theme.of(context).brightness == Brightness.dark
                      ? 0.28
                      : 0.14,
                ),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_pageKey != null)
                  _ComposerCascadeMenuHeader(
                    title: page.title ?? '',
                    onBack: () => setState(() => _pageKey = null),
                    onClose: widget.onClose,
                  ),
                Flexible(
                  child: ListView.builder(
                    shrinkWrap: true,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    itemCount: page.entries.length,
                    itemBuilder: (context, index) {
                      final entry = page.entries[index];
                      return _ComposerCascadeMenuRow(
                        entry: entry,
                        onTap: !entry.enabled
                            ? null
                            : () {
                                final submenu = entry.submenu;
                                if (submenu != null &&
                                    widget.submenus.containsKey(submenu)) {
                                  setState(() => _pageKey = submenu);
                                  return;
                                }
                                widget.onSelected(entry.value);
                              },
                      );
                    },
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

class _ComposerCascadeMenuHeader extends StatelessWidget {
  const _ComposerCascadeMenuHeader({
    required this.title,
    required this.onBack,
    required this.onClose,
  });

  final String title;
  final VoidCallback onBack;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: eco.borderSubtle)),
      ),
      child: SizedBox(
        height: 42,
        child: Row(
          children: [
            IconButton(
              onPressed: onBack,
              icon: const Icon(EcoIcons.chevronLeft, size: 17),
              color: eco.textSecondary,
              visualDensity: VisualDensity.compact,
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            ),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: eco.textPrimary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            IconButton(
              onPressed: onClose,
              icon: const Icon(EcoIcons.close, size: 16),
              color: eco.textMuted,
              visualDensity: VisualDensity.compact,
              tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerCascadeMenuRow extends StatelessWidget {
  const _ComposerCascadeMenuRow({required this.entry, required this.onTap});

  final ComposerCascadeMenuEntry entry;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = onTap != null;
    final primaryColor = enabled
        ? eco.textPrimary
        : eco.textMuted.withValues(alpha: 0.55);
    final secondaryColor = enabled
        ? eco.textMuted
        : eco.textMuted.withValues(alpha: 0.45);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                if (entry.icon != null) ...[
                  Icon(entry.icon, size: 17, color: secondaryColor),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: primaryColor,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      if (entry.detail?.isNotEmpty == true) ...[
                        const SizedBox(height: 2),
                        Text(
                          entry.detail!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: secondaryColor, fontSize: 11),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (entry.selected)
                  Icon(EcoIcons.check, size: 17, color: eco.accent)
                else if (entry.submenu != null)
                  Icon(EcoIcons.chevronRight, size: 17, color: secondaryColor),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
