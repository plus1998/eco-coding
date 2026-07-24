import 'package:flutter/material.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import 'eco_grouped_list.dart';
import 'eco_modal_sheet.dart';
import 'eco_pressable.dart';

/// Shared iOS-style action sheet chrome (grabber + header + inset actions).
Future<T?> showEcoActionSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool isDismissible = true,
  bool enableDrag = true,
  bool? showDragHandle,
}) {
  final eco = ecoColors(context);
  return showEcoModalBottomSheet<T>(
    context: context,
    backgroundColor: eco.bgMain,
    elevation: 0,
    isScrollControlled: isScrollControlled,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    showDragHandle: showDragHandle ?? false,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
    ),
    builder: builder,
  );
}

/// Drag indicator matching iOS sheet grabber.
class EcoSheetGrabber extends StatelessWidget {
  const EcoSheetGrabber({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Center(
        child: Container(
          width: 36,
          height: 5,
          decoration: BoxDecoration(
            color: eco.textMuted.withValues(alpha: 0.35),
            borderRadius: BorderRadius.circular(2.5),
          ),
        ),
      ),
    );
  }
}

/// Centered title / subtitle used at the top of action sheets.
class EcoSheetHeader extends StatelessWidget {
  const EcoSheetHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.maxTitleLines = 2,
  });

  final String title;
  final String? subtitle;
  final int maxTitleLines;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
      child: Column(
        children: [
          Text(
            title,
            maxLines: maxTitleLines,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
              letterSpacing: -0.25,
            ),
          ),
          if (subtitle != null && subtitle!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              subtitle!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: eco.textMuted,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class EcoActionSheetItem {
  const EcoActionSheetItem({
    required this.label,
    required this.onTap,
    this.icon,
    this.destructive = false,
  });

  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  final bool destructive;
}

/// Inset grouped action list with press-down feedback.
class EcoActionSheetActions extends StatelessWidget {
  const EcoActionSheetActions({
    super.key,
    required this.items,
    this.cancelLabel,
    this.onCancel,
  });

  final List<EcoActionSheetItem> items;
  final String? cancelLabel;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        ecoGroupedHorizontalInset,
        0,
        ecoGroupedHorizontalInset,
        8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          EcoGroupedSurface(
            margin: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < items.length; i++) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  _ActionRow(item: items[i]),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          EcoGroupedSurface(
            margin: EdgeInsets.zero,
            child: EcoPressable(
              onTap: onCancel ?? () => Navigator.pop(context),
              child: SizedBox(
                height: 52,
                child: Center(
                  child: Text(
                    cancelLabel ?? context.l10n.commonCancel,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: eco.accent,
                      fontSize: 17,
                      letterSpacing: -0.2,
                    ),
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

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.item});

  final EcoActionSheetItem item;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final color = item.destructive ? eco.danger : eco.textPrimary;
    final iconColor = item.destructive ? eco.danger : eco.accent;

    return EcoGroupedTile(
      onTap: item.onTap,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      minHeight: 52,
      child: Row(
        children: [
          if (item.icon != null) ...[
            Icon(item.icon, size: 22, color: iconColor),
            const SizedBox(width: 14),
          ],
          Expanded(
            child: Text(
              item.label,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: color,
                fontSize: 17,
                letterSpacing: -0.2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Scrollable sheet chrome: grabber + optional header + content on grouped canvas.
class EcoSheetScaffold extends StatelessWidget {
  const EcoSheetScaffold({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.maxHeightFactor = 0.72,
    this.bottomPadding = 16,
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final double maxHeightFactor;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final maxHeight = MediaQuery.sizeOf(context).height * maxHeightFactor;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const EcoSheetGrabber(),
            if (title != null)
              EcoSheetHeader(title: title!, subtitle: subtitle),
            Flexible(child: child),
            SizedBox(height: bottomPadding),
          ],
        ),
      ),
    );
  }
}

/// Selectable inset row with optional leading icon, title, subtitle, checkmark.
class EcoSheetOptionTile extends StatelessWidget {
  const EcoSheetOptionTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.selected = false,
    this.enabled = true,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final bool selected;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: enabled ? onTap : null,
      highlighted: selected,
      padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 14)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontSize: 17,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    letterSpacing: -0.2,
                    color: enabled ? eco.textPrimary : eco.textMuted,
                  ),
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.3,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (selected) ...[
            const SizedBox(width: 8),
            Icon(EcoIcons.check, size: 18, color: eco.accent),
          ],
        ],
      ),
    );
  }
}

/// Settings-style switch row for inset groups.
class EcoSheetSwitchTile extends StatelessWidget {
  const EcoSheetSwitchTile({
    super.key,
    required this.title,
    this.subtitle,
    required this.value,
    this.onChanged,
    this.enabled = true,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontSize: 17,
                    letterSpacing: -0.2,
                    color: enabled ? eco.textPrimary : eco.textMuted,
                  ),
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          Switch.adaptive(
            value: value,
            onChanged: enabled ? onChanged : null,
            activeTrackColor: eco.accent,
          ),
        ],
      ),
    );
  }
}
