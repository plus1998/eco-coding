import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../theme/eco_adaptive_icons.dart';
import '../theme/eco_theme.dart';
import 'eco_android_glass.dart';

const adaptiveNavBarHeight = 56.0;
const adaptiveNavHorizontalPadding = 8.0;
/// Native iOS 26 UITabBar intrinsic content height (home indicator handled by native).
const adaptiveNavBarNativeHeight = 50.0;
/// Lift tab bar slightly above the screen edge (above home-indicator strip).
const adaptiveNavBottomLift = 8.0;

/// Android frosted tab bar height (matches original NavigationBar sizing).
const adaptiveNavBarAndroidHeight = 56.0;
const adaptiveNavAndroidIconSize = 22.0;
const adaptiveNavAndroidLabelSize = 12.0;

double adaptiveNavBarTotalHeight(BuildContext context) {
  final safeBottom = MediaQuery.paddingOf(context).bottom;
  if (PlatformInfo.isIOS26OrHigher()) {
    return adaptiveNavBarNativeHeight + safeBottom + adaptiveNavBottomLift;
  }
  if (PlatformInfo.isAndroid) {
    return adaptiveNavBarAndroidHeight + (safeBottom > 0 ? safeBottom : 8);
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
              icon: _navigationIcon(destination.icon, color: eco.textHeading),
              label: destination.label,
            ),
        ],
      );
    }

    return _buildAndroidNavigationBar(
      context: context,
      eco: eco,
      destinations: destinations,
    );
  }

  Widget _buildAndroidNavigationBar({
    required BuildContext context,
    required EcoColors eco,
    required List<AdaptiveNavigationDestination> destinations,
  }) {
    final navBar = NavigationBar(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      indicatorColor: Colors.transparent,
      overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      labelPadding: const EdgeInsets.only(top: 2),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      height: adaptiveNavBarAndroidHeight,
      destinations: [
        for (final destination in destinations)
          NavigationDestination(
            icon: _navigationIcon(
              destination.icon,
              size: adaptiveNavAndroidIconSize,
              color: eco.textMuted,
            ),
            selectedIcon: _navigationIcon(
              destination.selectedIcon ?? destination.icon,
              size: adaptiveNavAndroidIconSize,
              color: eco.textHeading,
            ),
            label: destination.label,
          ),
      ],
    );

    return Theme(
      data: Theme.of(context).copyWith(
        navigationBarTheme: NavigationBarThemeData(
          height: adaptiveNavBarAndroidHeight,
          backgroundColor: Colors.transparent,
          indicatorColor: Colors.transparent,
          overlayColor: const WidgetStatePropertyAll(Colors.transparent),
          elevation: 0,
          labelPadding: const EdgeInsets.only(top: 2),
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            final selected = states.contains(WidgetState.selected);
            return TextStyle(
              color: selected ? eco.textHeading : eco.textMuted,
              fontSize: adaptiveNavAndroidLabelSize,
              height: 1.0,
              fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            final selected = states.contains(WidgetState.selected);
            return IconThemeData(
              color: selected ? eco.textHeading : eco.textMuted,
              size: adaptiveNavAndroidIconSize,
            );
          }),
        ),
      ),
      child: MediaQuery.removePadding(
        // NavigationBar wraps content in SafeArea(top: true) by default, which
        // injects status-bar padding and leaves a large gap above icons when the
        // bar is floated above the home-indicator strip in our Stack layout.
        context: context,
        removeTop: true,
        removeBottom: true,
        child: EcoAndroidGlassSurface(
          borderRadius: BorderRadius.circular(adaptiveNavBarAndroidHeight / 2),
          child: navBar,
        ),
      ),
    );
  }

  Widget _navigationIcon(
    dynamic icon, {
    Color? color,
    double size = 22,
  }) {
    if (icon is String) {
      return Icon(CupertinoIcons.circle, size: size, color: color);
    }
    if (icon is IconData) {
      return Icon(icon, size: size, color: color);
    }
    if (icon is Widget) {
      return icon;
    }
    return Icon(Icons.circle, size: size, color: color);
  }
}
