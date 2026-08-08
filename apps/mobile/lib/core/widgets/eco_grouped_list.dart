import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';
import 'eco_pressable.dart';

/// Inset grouped list radius (iOS Settings / Mail).
const ecoGroupedCornerRadius = 12.0;

/// Horizontal inset for grouped sections on phone.
const ecoGroupedHorizontalInset = 16.0;

/// Section label above an inset group.
class EcoGroupedSectionHeader extends StatelessWidget {
  const EcoGroupedSectionHeader({super.key, required this.label, this.caption});

  final String label;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        ecoGroupedHorizontalInset + 4,
        0,
        ecoGroupedHorizontalInset + 4,
        8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: eco.textMuted,
              fontSize: 13,
              fontWeight: FontWeight.w400,
              letterSpacing: 0.2,
              height: 1.2,
            ),
          ),
          if (caption != null) ...[
            const SizedBox(height: 4),
            Text(
              caption!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: eco.textMuted.withValues(alpha: 0.85),
                height: 1.35,
                letterSpacing: -0.08,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// SecondarySystemGroupedBackground-style surface with continuous corners.
class EcoGroupedSurface extends StatelessWidget {
  const EcoGroupedSurface({
    super.key,
    required this.child,
    this.margin = const EdgeInsets.symmetric(
      horizontal: ecoGroupedHorizontalInset,
    ),
    this.padding,
    this.clipBehavior = Clip.antiAlias,
  });

  final Widget child;
  final EdgeInsetsGeometry margin;
  final EdgeInsetsGeometry? padding;
  final Clip clipBehavior;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: margin,
      child: Material(
        color: eco.cardSurface,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ecoGroupedCornerRadius),
        ),
        clipBehavior: clipBehavior,
        child: padding == null
            ? child
            : Padding(padding: padding!, child: child),
      ),
    );
  }
}

/// Divider between rows inside [EcoGroupedSurface] — inset like iOS separators.
class EcoGroupedDivider extends StatelessWidget {
  const EcoGroupedDivider({
    super.key,
    this.indent = 16,
    this.soft = false,
  });

  final double indent;

  /// Session-list style: lower contrast than Settings/Mail separators.
  final bool soft;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isLight = Theme.of(context).brightness == Brightness.light;
    // Light: softer than system opaque separator (~0.29) — avoid hard rules.
    // Dark: hairline on elevated surface; never replace #38383A with a high alpha.
    final color = isLight
        ? Color(soft ? 0x123C3C43 : 0x243C3C43) // ~7% / ~14%
        : eco.borderSubtle.withValues(alpha: soft ? 0.28 : 0.55);

    return Divider(
      height: 0.5,
      thickness: 0.5,
      indent: indent,
      endIndent: 0,
      color: color,
    );
  }
}

/// A single tappable row for inset grouped lists.
class EcoGroupedTile extends StatelessWidget {
  const EcoGroupedTile({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    this.highlighted = false,
    this.minHeight = 44,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final EdgeInsetsGeometry padding;
  final bool highlighted;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final content = ConstrainedBox(
      constraints: BoxConstraints(minHeight: minHeight),
      child: Padding(
        padding: padding,
        child: Align(alignment: Alignment.centerLeft, child: child),
      ),
    );

    if (onTap == null && onLongPress == null) {
      return ColoredBox(
        color: highlighted ? eco.navActive : Colors.transparent,
        child: content,
      );
    }

    return EcoPressable(
      onTap: onTap,
      onLongPress: onLongPress,
      child: ColoredBox(
        color: highlighted ? eco.navActive : Colors.transparent,
        child: content,
      ),
    );
  }
}

/// Convenience: header + inset surface + optional footer caption.
class EcoGroupedSection extends StatelessWidget {
  const EcoGroupedSection({
    super.key,
    this.label,
    this.caption,
    this.footer,
    required this.child,
    this.topSpacing = 28,
  });

  final String? label;
  final String? caption;
  final String? footer;
  final Widget child;
  final double topSpacing;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(height: topSpacing),
        if (label != null)
          EcoGroupedSectionHeader(label: label!, caption: caption),
        EcoGroupedSurface(child: child),
        if (footer != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              ecoGroupedHorizontalInset + 4,
              8,
              ecoGroupedHorizontalInset + 4,
              0,
            ),
            child: Text(
              footer!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: eco.textMuted.withValues(alpha: 0.85),
                height: 1.35,
                letterSpacing: -0.08,
              ),
            ),
          ),
      ],
    );
  }
}
