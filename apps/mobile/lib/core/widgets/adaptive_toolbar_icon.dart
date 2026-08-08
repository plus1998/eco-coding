import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/eco_adaptive_icons.dart';
import '../theme/eco_theme.dart';
import 'allow_native_platform_view.dart';
import 'eco_android_glass.dart';

/// Default outer touch target for toolbar glass buttons.
const adaptiveToolbarTouchSize = 44.0;

/// Compact toolbar chips — session header and shell app-bar actions.
const sessionToolbarButtonSize = 40.0;
const sessionToolbarButtonGap = 8.0;

/// SF Symbol point size relative to the native square glass button.
///
/// SF Symbols are optically dense; 0.38 matches iOS liquid-glass chrome.
const adaptiveToolbarIconScale = 0.38;

/// Lucide / Material [Icon] size relative to the same glass button extent.
///
/// Glyphs sit smaller in the em box than SF Symbols, so they need more
/// relative size to read as balanced inside the circle (esp. Android glass).
const adaptiveToolbarFlutterIconScale = 0.5;

class AdaptiveToolbarIcon extends StatelessWidget {
  const AdaptiveToolbarIcon({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.size = adaptiveToolbarTouchSize,
    this.iconSize,
    this.visualOnly = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;

  /// Minimum tap target (width and height).
  final double size;

  /// SF Symbol / icon point size.
  /// Defaults to [adaptiveToolbarIconScale] (SF) or [adaptiveToolbarFlutterIconScale]
  /// (Flutter [Icon]) × native extent.
  final double? iconSize;

  /// Renders the toolbar chrome without an inner button.
  ///
  /// Use when a parent (e.g. [AdaptivePopupMenuButton]) owns the tap target —
  /// nested Material buttons otherwise consume touches on Android.
  final bool visualOnly;

  @override
  Widget build(BuildContext context) {
    // Rebuild when the shell ↔ root-detail stack changes so native glass
    // returns after pop/theme and disappears under session/settings detail.
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      return ListenableBuilder(
        listenable: router.routerDelegate,
        builder: (context, _) => _buildBody(context),
      );
    }
    return _buildBody(context);
  }

  Widget _buildBody(BuildContext context) {
    final eco = ecoColors(context);
    final enabled = visualOnly || onPressed != null;
    final color = enabled
        ? eco.textHeading
        : eco.textHeading.withValues(alpha: 0.38);
    final buttonSize = _resolveButtonSize(size);
    final nativeExtent = _nativeExtent(buttonSize);
    final style = PlatformInfo.isIOS
        ? AdaptiveButtonStyle.glass
        : AdaptiveButtonStyle.gray;
    final allowNative = allowNativePlatformView(context);
    final useNativeGlass =
        PlatformInfo.isIOS26OrHigher() && allowNative;
    final sfSymbol = ecoIconSfSymbol(icon);
    final usesSfSymbol = useNativeGlass && sfSymbol != null && !visualOnly;
    final resolvedIconSize = iconSize ??
        nativeExtent *
            (usesSfSymbol
                ? adaptiveToolbarIconScale
                : adaptiveToolbarFlutterIconScale);
    // Remount UiKitView after brightness changes so liquid glass tracks theme.
    final brightness = Theme.of(context).brightness;

    if (visualOnly) {
      final chip = useNativeGlass
          ? AdaptiveButton.child(
              key: ValueKey('toolbar-visual-$brightness'),
              onPressed: null,
              style: AdaptiveButtonStyle.glass,
              size: buttonSize,
              enabled: enabled,
              useSmoothRectangleBorder: false,
              child: Icon(icon, size: resolvedIconSize, color: color),
            )
          : PlatformInfo.isIOS26OrHigher() && !allowNative
              ? _coveredShellPlaceholder(nativeExtent)
              : _flutterGlassIconChip(
                  nativeExtent: nativeExtent,
                  icon: icon,
                  iconSize: resolvedIconSize,
                  color: color,
                );
      final wrapped = SizedBox(
        width: size,
        height: size,
        child: Center(
          child: SizedBox.square(
            dimension: nativeExtent,
            child: Center(child: chip),
          ),
        ),
      );
      if (tooltip == null) return wrapped;
      return Tooltip(message: tooltip!, child: wrapped);
    }

    final Widget button;
    if (usesSfSymbol) {
      button = AdaptiveButton.sfSymbol(
        key: ValueKey('toolbar-sf-$brightness-$sfSymbol'),
        onPressed: onPressed,
        sfSymbol: SFSymbol(sfSymbol!, size: resolvedIconSize, color: color),
        style: style,
        size: buttonSize,
        enabled: enabled,
        useSmoothRectangleBorder: false,
      );
    } else if (useNativeGlass) {
      button = AdaptiveButton.child(
        key: ValueKey('toolbar-child-$brightness'),
        onPressed: onPressed,
        style: style,
        size: buttonSize,
        enabled: enabled,
        useSmoothRectangleBorder: false,
        child: Icon(icon, size: resolvedIconSize, color: color),
      );
    } else if (PlatformInfo.isIOS26OrHigher() && !allowNative) {
      // Covered shell: no translucent Flutter glass — that still "bleeds" light
      // through the session title during interactive pop.
      button = _coveredShellPlaceholder(nativeExtent);
    } else if (PlatformInfo.isAndroid) {
      button = _flutterGlassIconChip(
        nativeExtent: nativeExtent,
        icon: icon,
        iconSize: resolvedIconSize,
        color: color,
        onPressed: onPressed,
      );
    } else {
      button = AdaptiveButton.child(
        onPressed: onPressed,
        style: style,
        size: buttonSize,
        enabled: enabled,
        useSmoothRectangleBorder: false,
        child: Icon(icon, size: resolvedIconSize, color: color),
      );
    }

    // Keep the native glass control square so it is not stretched in a wide slot.
    final glassControl = SizedBox(
      width: nativeExtent,
      height: nativeExtent,
      child: Center(child: button),
    );

    final wrapped = SizedBox(
      width: size,
      height: size,
      child: Center(child: glassControl),
    );

    if (tooltip == null) return wrapped;
    return Tooltip(message: tooltip!, child: wrapped);
  }
}

/// Layout-only stub while shell is under a root detail route.
Widget _coveredShellPlaceholder(double nativeExtent) {
  return SizedBox.square(dimension: nativeExtent);
}

AdaptiveButtonSize _resolveButtonSize(double targetSize) {
  if (targetSize < 34) return AdaptiveButtonSize.small;
  if (targetSize < 43) return AdaptiveButtonSize.medium;
  return AdaptiveButtonSize.large;
}

double _nativeExtent(AdaptiveButtonSize size) {
  return switch (size) {
    AdaptiveButtonSize.small => 28,
    AdaptiveButtonSize.medium => 36,
    AdaptiveButtonSize.large => 44,
  };
}

Widget _flutterGlassIconChip({
  required double nativeExtent,
  required IconData icon,
  required double iconSize,
  required Color color,
  VoidCallback? onPressed,
}) {
  final radius = BorderRadius.circular(nativeExtent / 2);
  final iconWidget = Icon(icon, size: iconSize, color: color);

  final centered = SizedBox(
    width: nativeExtent,
    height: nativeExtent,
    child: Center(child: iconWidget),
  );

  return EcoAndroidGlassSurface(
    width: nativeExtent,
    height: nativeExtent,
    borderRadius: radius,
    child: onPressed == null
        ? centered
        : Material(
            type: MaterialType.transparency,
            child: InkWell(
              onTap: onPressed,
              customBorder: const CircleBorder(),
              child: centered,
            ),
          ),
  );
}
