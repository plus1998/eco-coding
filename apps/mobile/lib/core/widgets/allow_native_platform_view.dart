import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// Whether iOS Liquid Glass `UiKitView` chrome may be shown for this [context].
///
/// Platform views sit outside Flutter's transform/clip stack and punch through
/// covering routes (especially during iOS interactive pop). Shell chrome lives
/// under a nested Navigator that stays "current" while root detail routes are
/// open, so we key off the full GoRouter location rather than [Navigator.canPop]
/// (which can stick / mis-rebuild after theme changes).
bool allowNativePlatformView(BuildContext context) {
  final navigator = Navigator.maybeOf(context);
  final rootNavigator = Navigator.maybeOf(context, rootNavigator: true);
  final onRootNavigator = navigator != null &&
      rootNavigator != null &&
      identical(navigator, rootNavigator);

  // Session / settings detail pushed on the root stack: keep native while current.
  if (onRootNavigator) {
    final route = ModalRoute.of(context);
    return route?.isCurrent ?? true;
  }

  // Nested shell (list, settings home, tab chrome): hide while a root detail
  // covers the shell. Match paths that use parentNavigatorKey: root.
  return !isShellCoveredByRootDetail(context);
}

/// True when the app location is a root-level detail over the main shell.
bool isShellCoveredByRootDetail(BuildContext context) {
  final router = GoRouter.maybeOf(context);
  if (router == null) return false;
  return isShellCoveredLocation(router.state.uri.path);
}

/// Pure path check (also used by unit tests).
bool isShellCoveredLocation(String path) {
  if (path == '/threads/new') return true;
  if (path.startsWith('/threads/')) {
    final rest = path.substring('/threads/'.length);
    // Single segment: thread id (not empty nested leftovers).
    if (rest.isNotEmpty && !rest.contains('/')) return true;
  }
  if (path.startsWith('/settings/')) return true;
  return false;
}
