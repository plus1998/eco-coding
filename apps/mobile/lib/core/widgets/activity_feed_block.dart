import 'package:flutter/material.dart';

import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import 'eco_pressable.dart';

const activityFeedBlockRadius = 12.0;

Color activityFeedBlockBorderColor(BuildContext context) {
  final eco = ecoColors(context);
  final isLight = Theme.of(context).brightness == Brightness.light;
  return isLight
      ? const Color(0x123C3C43)
      : eco.borderSubtle.withValues(alpha: 0.45);
}

/// Shared chrome for Bash / file-change / subagent cards in the activity feed.
class ActivityFeedBlock extends StatelessWidget {
  const ActivityFeedBlock({
    super.key,
    required this.child,
    this.onTap,
    this.margin = const EdgeInsets.symmetric(vertical: 4),
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry margin;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(activityFeedBlockRadius),
      side: BorderSide(
        color: activityFeedBlockBorderColor(context),
        width: 0.5,
      ),
    );

    final material = Material(
      color: eco.cardSurface,
      elevation: 0,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: child,
    );

    return Padding(
      padding: margin,
      child: onTap == null
          ? material
          : EcoPressable(
              onTap: onTap,
              borderRadius: BorderRadius.circular(activityFeedBlockRadius),
              child: material,
            ),
    );
  }
}

class ActivityFeedBlockHeader extends StatelessWidget {
  const ActivityFeedBlockHeader({
    super.key,
    required this.title,
    this.icon,
    this.leading,
    this.preview,
    this.meta,
    this.trailing,
    this.iconColor,
    this.titleColor,
    this.expanded,
    this.dense = false,
  });

  final String title;
  final IconData? icon;
  final Widget? leading;
  final String? preview;
  final String? meta;
  final Widget? trailing;
  final Color? iconColor;
  final Color? titleColor;

  /// When non-null, shows expand chevron reflecting this state.
  final bool? expanded;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final muted = eco.textMuted;
    final resolvedIconColor = iconColor ?? muted;

    final titleStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
      color: titleColor ?? eco.textPrimary,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      fontSize: Theme.of(context).textTheme.bodyMedium?.fontSize ?? 14,
    );
    final hasPreview = preview != null && preview!.isNotEmpty;

    return Padding(
      padding: EdgeInsets.fromLTRB(12, dense ? 8 : 10, 10, dense ? 8 : 10),
      child: Row(
        children: [
          if (leading != null) ...[
            leading!,
            const SizedBox(width: 8),
          ] else if (icon != null) ...[
            Icon(icon, size: 16, color: resolvedIconColor),
            const SizedBox(width: 8),
          ],
          // Keep the title shrink-wrapped when the chevron must follow it.
          // Without a preview or chevron, the title can fill the row.
          if (hasPreview || expanded != null)
            Flexible(
              flex: 0,
              fit: FlexFit.loose,
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: titleStyle,
              ),
            )
          else
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: titleStyle,
              ),
            ),
          if (expanded != null) ...[
            const SizedBox(width: 4),
            AnimatedRotation(
              turns: expanded! ? 0.5 : 0,
              duration: const Duration(milliseconds: 160),
              curve: Curves.easeOutCubic,
              child: Icon(EcoIcons.expandDown, size: 16, color: muted),
            ),
          ],
          if (hasPreview) ...[
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                preview!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: muted.withValues(alpha: 0.9),
                  height: 1.3,
                ),
              ),
            ),
          ],
          if (meta != null && meta!.isNotEmpty) ...[
            const SizedBox(width: 8),
            Text(
              meta!,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: muted,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
          if (trailing != null) ...[const SizedBox(width: 6), trailing!],
        ],
      ),
    );
  }
}

class ActivityFeedBlockDivider extends StatelessWidget {
  const ActivityFeedBlockDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isLight = Theme.of(context).brightness == Brightness.light;
    return Divider(
      height: 0.5,
      thickness: 0.5,
      color: isLight
          ? const Color(0x143C3C43)
          : eco.borderSubtle.withValues(alpha: 0.5),
    );
  }
}

class ActivityFeedStatusChip extends StatelessWidget {
  const ActivityFeedStatusChip({
    super.key,
    required this.label,
    this.active = false,
    this.danger = false,
  });

  final String label;
  final bool active;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final color = danger
        ? eco.danger
        : active
        ? eco.accent
        : eco.textMuted;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: active || danger ? 0.12 : 0.08),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: color,
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),
    );
  }
}

class ActivityFeedRoleDot extends StatelessWidget {
  const ActivityFeedRoleDot({super.key, required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
