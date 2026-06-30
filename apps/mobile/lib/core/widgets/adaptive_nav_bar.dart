import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../theme/eco_adaptive_icons.dart';
import '../theme/eco_theme.dart';

const adaptiveNavBarHeight = 56.0;
const adaptiveNavHorizontalPadding = 8.0;
/// Native iOS 26 UITabBar intrinsic content height (home indicator handled by native).
const adaptiveNavBarNativeHeight = 50.0;
/// Lift tab bar slightly above the screen edge (above home-indicator strip).
const adaptiveNavBottomLift = 8.0;

double adaptiveNavBarTotalHeight(BuildContext context) {
  final safeBottom = MediaQuery.paddingOf(context).bottom;
  if (PlatformInfo.isIOS26OrHigher()) {
    return adaptiveNavBarNativeHeight + safeBottom + adaptiveNavBottomLift;
  }
  return adaptiveNavBarHeight + (safeBottom > 0 ? safeBottom : 8);
}

double adaptiveNavOverlayInset(BuildContext context) {
  return adaptiveNavBarTotalHeight(context) + 8;
}

class AdaptiveNavDestination {
  const AdaptiveNavDestination({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;
}

class AdaptiveNavBar extends StatelessWidget {
  const AdaptiveNavBar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<AdaptiveNavDestination> destinations;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final navDestinations = [
      for (final destination in destinations)
        AdaptiveNavigationDestination(
          icon: adaptivePlatformIcon(destination.icon),
          label: destination.label,
        ),
    ];

    final tabBar = _buildTabBar(
      context: context,
      eco: eco,
      destinations: navDestinations,
    );

    final bottomInset = PlatformInfo.isIOS26OrHigher()
        ? adaptiveNavBottomLift
        : MediaQuery.paddingOf(context).bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        adaptiveNavHorizontalPadding,
        0,
        adaptiveNavHorizontalPadding,
        bottomInset,
      ),
      child: tabBar,
    );
  }

  Widget _buildTabBar({
    required BuildContext context,
    required EcoColors eco,
    required List<AdaptiveNavigationDestination> destinations,
  }) {
    if (PlatformInfo.isIOS26OrHigher()) {
      return IOS26NativeTabBar(
        destinations: destinations,
        selectedIndex: selectedIndex,
        onTap: onDestinationSelected,
        tint: eco.textHeading,
        unselectedItemTint: eco.textHeading,
      );
    }

    if (PlatformInfo.isIOS) {
      return CupertinoTabBar(
        currentIndex: selectedIndex,
        onTap: onDestinationSelected,
        activeColor: eco.textHeading,
        inactiveColor: eco.textHeading,
        backgroundColor: Colors.transparent,
        height: adaptiveNavBarHeight,
        iconSize: 22,
        items: [
          for (final destination in destinations)
            BottomNavigationBarItem(
              icon: _navigationIcon(destination.icon, eco.textHeading),
              label: destination.label,
            ),
        ],
      );
    }

    return NavigationBar(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      backgroundColor: Colors.transparent,
      indicatorColor: eco.navActive,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      height: adaptiveNavBarHeight,
      destinations: [
        for (final destination in destinations)
          NavigationDestination(
            icon: _navigationIcon(destination.icon, eco.textHeading),
            label: destination.label,
          ),
      ],
    );
  }

  Widget _navigationIcon(dynamic icon, Color color) {
    const tabIconSize = 22.0;
    if (icon is String) {
      return Icon(CupertinoIcons.circle, size: tabIconSize, color: color);
    }
    if (icon is IconData) {
      return Icon(icon, size: tabIconSize, color: color);
    }
    if (icon is Widget) {
      return icon;
    }
    return Icon(Icons.circle, size: tabIconSize, color: color);
  }
}
