import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';

const liquidGlassNavBlurSigma = 36.0;
const liquidGlassNavTintOpacityDark = 0.12;
const liquidGlassNavTintOpacityLight = 0.14;
const liquidGlassNavBarHeight = 62.64;
const liquidGlassNavBarRadius = 30.24;
const liquidGlassNavHorizontalInset = 20.0;
const liquidGlassNavItemInset = 4.32;
const liquidGlassNavItemRadius =
    liquidGlassNavBarRadius - liquidGlassNavItemInset;
const liquidGlassNavItemHeight =
    liquidGlassNavBarHeight - liquidGlassNavItemInset * 2;
const liquidGlassNavActiveBorderWidth = 0.65;
const liquidGlassNavIconSize = 25.0;
const liquidGlassNavLabelFontSize = 9.0;

double liquidGlassNavOverlayInset(BuildContext context) {
  final safeBottom = MediaQuery.paddingOf(context).bottom;
  return liquidGlassNavBarHeight + (safeBottom > 0 ? safeBottom : 12) + 12;
}

class LiquidGlassNavDestination {
  const LiquidGlassNavDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
}

class LiquidGlassNavBar extends StatelessWidget {
  const LiquidGlassNavBar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<LiquidGlassNavDestination> destinations;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final tintOpacity =
        isDark ? liquidGlassNavTintOpacityDark : liquidGlassNavTintOpacityLight;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        liquidGlassNavHorizontalInset,
        0,
        liquidGlassNavHorizontalInset,
        bottomInset > 0 ? bottomInset : 12,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(liquidGlassNavBarRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: liquidGlassNavBlurSigma,
            sigmaY: liquidGlassNavBlurSigma,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(liquidGlassNavBarRadius),
              color: isDark
                  ? eco.bgElevated.withValues(alpha: tintOpacity)
                  : Colors.white.withValues(alpha: tintOpacity),
              border: Border.all(
                color: isDark
                    ? Colors.white.withValues(alpha: 0.14)
                    : Colors.white.withValues(alpha: 0.42),
                width: 0.7,
              ),
            ),
            child: SizedBox(
              width: double.infinity,
              height: liquidGlassNavBarHeight,
              child: Row(
                children: [
                  for (var index = 0; index < destinations.length; index++)
                    Expanded(
                      child: _LiquidGlassNavItem(
                        destination: destinations[index],
                        selected: selectedIndex == index,
                        onTap: () => onDestinationSelected(index),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LiquidGlassNavItem extends StatelessWidget {
  const _LiquidGlassNavItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final LiquidGlassNavDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(liquidGlassNavItemRadius),
        splashColor: eco.navHover,
        highlightColor: eco.navHover,
        child: Padding(
          padding: const EdgeInsets.all(liquidGlassNavItemInset),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 240),
            curve: Curves.easeOutCubic,
            width: double.infinity,
            height: liquidGlassNavItemHeight,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(liquidGlassNavItemRadius),
              color: selected
                  ? (isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : Colors.white.withValues(alpha: 0.22))
                  : Colors.transparent,
              border: selected
                  ? Border.all(
                      color: isDark
                          ? Colors.white.withValues(alpha: 0.12)
                          : Colors.white.withValues(alpha: 0.45),
                      width: liquidGlassNavActiveBorderWidth,
                    )
                  : null,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.max,
              children: [
                Icon(
                  selected ? destination.selectedIcon : destination.icon,
                  size: liquidGlassNavIconSize,
                  color: selected ? eco.textHeading : eco.textMuted,
                ),
                const SizedBox(height: 3),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    destination.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    softWrap: false,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontSize: liquidGlassNavLabelFontSize,
                          fontWeight:
                              selected ? FontWeight.w600 : FontWeight.w400,
                          color: selected ? eco.textHeading : eco.textMuted,
                          letterSpacing: 0.1,
                          height: 1.1,
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
