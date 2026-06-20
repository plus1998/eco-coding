import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/providers/app_providers.dart';
import 'core/providers/app_session.dart';
import 'core/theme/eco_theme.dart';
import 'features/home/home_screen.dart';
import 'features/home/setup_status.dart';
import 'features/settings/settings_screen.dart';
import 'features/threads/new_thread_screen.dart';
import 'features/threads/thread_session_screen.dart';
import 'features/threads/threads_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

class _RouterRefreshNotifier extends ChangeNotifier {
  _RouterRefreshNotifier(this._ref) {
    _ref.listen(setupOverviewProvider, (previous, next) {
      if (previous?.setupComplete != next.setupComplete) {
        notifyListeners();
      }
    });
    _ref.listen(selectedDesktopIdProvider, (previous, next) {
      if (previous != next) {
        notifyListeners();
      }
    });
  }

  final Ref _ref;
}

final _routerRefreshProvider = Provider<_RouterRefreshNotifier>((ref) {
  final notifier = _RouterRefreshNotifier(ref);
  ref.onDispose(notifier.dispose);
  return notifier;
});

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(_routerRefreshProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final overview = ref.read(setupOverviewProvider);
      final location = state.matchedLocation;

      if (location == '/') {
        return overview.setupComplete ? '/threads' : '/connect';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/connect',
        builder: (context, state) => const HomeScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return MainShell(navigationShell: navigationShell);
        },
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/threads',
                builder: (context, state) => const ThreadsScreen(),
                routes: [
                  GoRoute(
                    path: 'new',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => const NewThreadScreen(),
                  ),
                  GoRoute(
                    path: ':threadId',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => ThreadSessionScreen(
                      threadId: state.pathParameters['threadId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: EcoColors.borderSidebar)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: navigationShell.goBranch,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.chat_bubble_outline),
              selectedIcon: Icon(Icons.chat_bubble),
              label: '会话',
            ),
            NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings),
              label: '设置',
            ),
          ],
        ),
      ),
    );
  }
}

class EcoApp extends ConsumerWidget {
  const EcoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(appSessionProvider);
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'Eco',
      theme: buildEcoTheme(),
      routerConfig: router,
    );
  }
}
