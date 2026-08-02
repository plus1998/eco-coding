import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

/// Presents a second-level adaptive popup for [AdaptivePopupMenuButton] flows.
///
/// Matches the package’s non-iOS-26 paths:
/// - Android → Material [showMenu]
/// - elsewhere (including iOS) → [CupertinoActionSheet]
///
/// Gap: iOS 26+ first-level menus are native `UIMenu`, but this helper cannot
/// reopen a native `UIMenu` programmatically — the second layer uses an action
/// sheet on iOS.
Future<void> showAdaptivePopupMenu<T>({
  required BuildContext context,
  required GlobalKey anchorKey,
  required List<AdaptivePopupMenuEntry> items,
  required void Function(int index, AdaptivePopupMenuItem<T> entry) onSelected,
  String? title,
}) async {
  if (PlatformInfo.isAndroid) {
    await _showMaterialPopupMenu<T>(
      context: context,
      anchorKey: anchorKey,
      items: items,
      onSelected: onSelected,
    );
    return;
  }

  await _showCupertinoPopupMenu<T>(
    context: context,
    items: items,
    onSelected: onSelected,
    title: title,
  );
}

Future<void> _showMaterialPopupMenu<T>({
  required BuildContext context,
  required GlobalKey anchorKey,
  required List<AdaptivePopupMenuEntry> items,
  required void Function(int index, AdaptivePopupMenuItem<T> entry) onSelected,
}) async {
  final box = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  if (box == null || !box.hasSize) return;

  final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
  final topLeft = box.localToGlobal(Offset.zero, ancestor: overlay);
  final bottomRight = box.localToGlobal(box.size.bottomRight(Offset.zero), ancestor: overlay);
  final position = RelativeRect.fromRect(
    Rect.fromPoints(topLeft, bottomRight),
    Offset.zero & overlay.size,
  );

  final menuItems = <PopupMenuEntry<int>>[];
  for (var i = 0; i < items.length; i++) {
    final entry = items[i];
    if (entry is AdaptivePopupMenuDivider) {
      menuItems.add(const PopupMenuDivider());
      continue;
    }
    if (entry is! AdaptivePopupMenuItem<T>) continue;
    menuItems.add(
      PopupMenuItem<int>(
        value: i,
        enabled: entry.enabled,
        child: Row(
          children: [
            if (entry.icon != null) ...[
              Icon(
                entry.icon is IconData ? entry.icon as IconData : Icons.circle,
                size: 20,
              ),
              const SizedBox(width: 12),
            ],
            Expanded(child: Text(entry.label)),
          ],
        ),
      ),
    );
  }

  final selected = await showMenu<int>(
    context: context,
    position: position,
    items: menuItems,
  );
  if (selected == null) return;
  final selectedEntry = items[selected];
  if (selectedEntry is AdaptivePopupMenuItem<T>) {
    onSelected(selected, selectedEntry);
  }
}

Future<void> _showCupertinoPopupMenu<T>({
  required BuildContext context,
  required List<AdaptivePopupMenuEntry> items,
  required void Function(int index, AdaptivePopupMenuItem<T> entry) onSelected,
  String? title,
}) async {
  final selected = await showCupertinoModalPopup<int>(
    context: context,
    builder: (ctx) {
      return CupertinoActionSheet(
        title: title != null ? Text(title) : null,
        actions: [
          for (var i = 0; i < items.length; i++)
            if (items[i] is AdaptivePopupMenuItem<T>)
              Builder(
                builder: (actionContext) {
                  final entry = items[i] as AdaptivePopupMenuItem<T>;
                  return CupertinoActionSheetAction(
                    onPressed: entry.enabled
                        ? () => Navigator.of(ctx).pop(i)
                        : () {},
                    child: Text(
                      entry.label,
                      style: entry.enabled
                          ? null
                          : TextStyle(
                              color: CupertinoColors.secondaryLabel
                                  .resolveFrom(actionContext),
                            ),
                    ),
                  );
                },
              )
            else
              const SizedBox(height: 8),
        ],
        cancelButton: CupertinoActionSheetAction(
          onPressed: () => Navigator.of(ctx).pop(),
          isDefaultAction: true,
          child: Text(
            PlatformInfo.isIOS
                ? CupertinoLocalizations.of(ctx).cancelButtonLabel
                : MaterialLocalizations.of(ctx).cancelButtonLabel,
          ),
        ),
      );
    },
  );

  if (selected == null) return;
  final selectedEntry = items[selected];
  if (selectedEntry is AdaptivePopupMenuItem<T>) {
    onSelected(selected, selectedEntry);
  }
}

String adaptiveMenuSelectedLabel(String label, {required bool selected}) {
  if (!selected) return label;
  return '✓ $label';
}
