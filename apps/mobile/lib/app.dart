import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/models/eco_types.dart';
import 'core/providers/app_providers.dart';
import 'core/providers/app_session.dart';
import 'core/providers/app_theme_provider.dart';
import 'core/theme/eco_icons.dart';
import 'core/theme/eco_theme.dart';
import 'features/home/home_screen.dart';
import 'features/home/setup_status.dart';
import 'features/settings/settings_screen.dart';
import 'features/threads/new_thread_screen.dart';
import 'features/threads/thread_session_screen.dart';
import 'features/threads/threads_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

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
    final colors = ecoColors(context);
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: colors.borderSidebar)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: navigationShell.goBranch,
          destinations: const [
            NavigationDestination(
              icon: Icon(EcoIcons.sessions),
              selectedIcon: Icon(EcoIcons.sessionsSelected),
              label: '会话',
            ),
            NavigationDestination(
              icon: Icon(EcoIcons.settings),
              selectedIcon: Icon(EcoIcons.settings),
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
    final themePreference = ref.watch(appThemePreferenceProvider);
    return MaterialApp.router(
      title: 'Eco',
      theme: buildEcoLightTheme(),
      darkTheme: buildEcoDarkTheme(),
      themeMode: themePreference.themeMode,
      scaffoldMessengerKey: _scaffoldMessengerKey,
      routerConfig: router,
      builder: (context, child) =>
          _ConnectionStatusNotice(child: child ?? const SizedBox.shrink()),
    );
  }
}

class _ConnectionStatusNotice extends ConsumerStatefulWidget {
  const _ConnectionStatusNotice({required this.child});

  final Widget child;

  @override
  ConsumerState<_ConnectionStatusNotice> createState() =>
      _ConnectionStatusNoticeState();
}

class _ConnectionStatusNoticeState
    extends ConsumerState<_ConnectionStatusNotice> {
  EcoConnectionState? _lastState;

  @override
  Widget build(BuildContext context) {
    ref.listen(connectionStatusProvider, (_, next) {
      next.whenData(_handleStatus);
    });
    return widget.child;
  }

  void _handleStatus(CenterServerConnectionStatus status) {
    final previous = _lastState;
    if (previous == status.state && status.state != EcoConnectionState.error) {
      return;
    }
    _lastState = status.state;
    if (previous == null || !mounted) {
      return;
    }

    final message = switch (status.state) {
      EcoConnectionState.connecting =>
        previous == EcoConnectionState.error ||
                previous == EcoConnectionState.disconnected
            ? '正在重连 Center Server…'
            : null,
      EcoConnectionState.connected =>
        previous == EcoConnectionState.connected ? null : '连接成功',
      EcoConnectionState.error =>
        previous == EcoConnectionState.connected ||
                previous == EcoConnectionState.connecting
            ? '连接断开，正在重连…'
            : null,
      EcoConnectionState.disconnected =>
        previous == EcoConnectionState.connected ? '实时通道已断开' : null,
    };
    if (message == null) {
      return;
    }

    final messenger = _scaffoldMessengerKey.currentState;
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(milliseconds: 1500),
        ),
      );
  }
}
