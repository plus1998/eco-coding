import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/locale/app_localizations_ext.dart';
import 'core/models/eco_types.dart';
import 'core/providers/app_locale_provider.dart';
import 'core/providers/app_providers.dart';
import 'core/providers/app_session.dart';
import 'core/providers/app_theme_provider.dart';
import 'core/theme/eco_icons.dart';
import 'core/theme/eco_theme.dart';
import 'core/widgets/adaptive_nav_bar.dart';
import 'core/widgets/app_theme_media_query.dart';
import 'features/home/home_screen.dart';
import 'features/home/setup_status.dart';
import 'features/settings/settings_context_window_page.dart';
import 'features/settings/settings_default_mode_page.dart';
import 'features/settings/settings_language_page.dart';
import 'features/settings/settings_models_page.dart';
import 'features/settings/settings_orchestration_page.dart';
import 'features/settings/settings_screen.dart';
import 'features/settings/settings_theme_page.dart';
import 'features/threads/new_thread_screen.dart';
import 'features/threads/thread_session_screen.dart';
import 'features/threads/threads_screen.dart';
import 'l10n/generated/app_localizations.dart';

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
                routes: [
                  GoRoute(
                    path: 'theme',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => const SettingsThemePage(),
                  ),
                  GoRoute(
                    path: 'language',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => const SettingsLanguagePage(),
                  ),
                  GoRoute(
                    path: 'default-mode',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) =>
                        const SettingsDefaultModePage(),
                  ),
                  GoRoute(
                    path: 'context-window',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) =>
                        const SettingsContextWindowPage(),
                  ),
                  GoRoute(
                    path: 'orchestration',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) =>
                        const SettingsOrchestrationPage(),
                  ),
                  GoRoute(
                    path: 'models',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => const SettingsModelsPage(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

class MainShell extends ConsumerWidget {
  const MainShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eco = ecoColors(context);

    return ColoredBox(
      color: eco.bgMain,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Stack(
          fit: StackFit.expand,
          children: [
            navigationShell,
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: AdaptiveNavBar(
                selectedIndex: navigationShell.currentIndex,
                onDestinationSelected: navigationShell.goBranch,
                destinations: [
                  AdaptiveNavDestination(
                    icon: EcoIcons.sessions,
                    label: context.l10n.navSessions,
                  ),
                  AdaptiveNavDestination(
                    icon: EcoIcons.settings,
                    label: context.l10n.navSettings,
                  ),
                ],
              ),
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
    final localePreference = ref.watch(appLocalePreferenceProvider);
    return MaterialApp.router(
      onGenerateTitle: (context) => context.l10n.appTitle,
      locale: localePreference.locale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildEcoLightTheme(),
      darkTheme: buildEcoDarkTheme(),
      themeMode: themePreference.themeMode,
      scaffoldMessengerKey: _scaffoldMessengerKey,
      routerConfig: router,
      builder: (context, child) => AppThemeMediaQuery(
        child: _ConnectionStatusNotice(child: child ?? const SizedBox.shrink()),
      ),
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

    final l10n = context.l10n;
    final message = switch (status.state) {
      EcoConnectionState.connecting =>
        previous == EcoConnectionState.error ||
                previous == EcoConnectionState.disconnected
            ? l10n.connectionReconnecting
            : null,
      EcoConnectionState.connected =>
        previous == EcoConnectionState.connected
            ? null
            : l10n.connectionConnected,
      EcoConnectionState.error =>
        previous == EcoConnectionState.connected ||
                previous == EcoConnectionState.connecting
            ? l10n.connectionLostReconnecting
            : null,
      EcoConnectionState.disconnected =>
        previous == EcoConnectionState.connected
            ? l10n.connectionLiveChannelDisconnected
            : null,
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
