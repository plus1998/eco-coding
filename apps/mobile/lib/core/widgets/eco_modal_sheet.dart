import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';

/// Shows a modal bottom sheet above the shell tab bar.
///
/// [MainShell] paints [AdaptiveNavBar] in a top-level [Stack], while branch
/// navigators sit underneath. Without [useRootNavigator], sheets render below
/// the tab bar and are dismissed when switching tabs.
Future<T?> showEcoModalBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  Color? backgroundColor,
  double? elevation,
  ShapeBorder? shape,
  Clip? clipBehavior,
  BoxConstraints? constraints,
  Color? barrierColor,
  bool isScrollControlled = false,
  bool isDismissible = true,
  bool enableDrag = true,
  bool? showDragHandle,
  bool useSafeArea = false,
  RouteSettings? routeSettings,
  AnimationController? transitionAnimationController,
  Offset? anchorPoint,
}) {
  final eco = ecoColors(context);
  return showModalBottomSheet<T>(
    context: context,
    useRootNavigator: true,
    builder: builder,
    backgroundColor: backgroundColor ?? eco.bgElevated,
    elevation: elevation ?? 0,
    shape: shape ??
        const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
        ),
    clipBehavior: clipBehavior ?? Clip.antiAlias,
    constraints: constraints,
    barrierColor: barrierColor ?? eco.bgOverlay,
    isScrollControlled: isScrollControlled,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    showDragHandle: showDragHandle,
    useSafeArea: useSafeArea,
    routeSettings: routeSettings,
    transitionAnimationController: transitionAnimationController,
    anchorPoint: anchorPoint,
  );
}
