import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/providers/desktop_bind_ready.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/core/utils/center_server_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _CenterClient extends EcoCenterClient {
  _CenterClient({required this.bound}) : super(store: CredentialStore());

  final bool bound;
  int connectCalls = 0;

  @override
  CenterServerConnectionStatus get status =>
      const CenterServerConnectionStatus(state: EcoConnectionState.connected);

  @override
  bool get hasActiveBindingChannel => bound;

  /// The gate nudges the client to connect while it waits; keep that a no-op so
  /// the test never touches the network or leaves reconnect timers behind.
  @override
  Future<void> connect() async {
    connectCalls++;
  }
}

/// [ensureDesktopBindReady] takes the `Ref` of whatever provider waits on it.
Future<bool> _bindReady(
  ProviderContainer container, {
  Duration timeout = const Duration(seconds: 12),
}) {
  final ref = container.read(Provider<Ref>((ref) => ref));
  return ensureDesktopBindReady(ref, timeout: timeout);
}

void main() {
  group('isDesktopBindPending', () {
    test('false when bind is already connected', () {
      expect(
        isDesktopBindPending(
          hasPendingDesktop: true,
          hasActiveBindingChannel: true,
          connectionState: EcoConnectionState.connected,
        ),
        isFalse,
      );
    });

    test('true while connecting or disconnected with a selected PC', () {
      expect(
        isDesktopBindPending(
          hasPendingDesktop: true,
          hasActiveBindingChannel: false,
          connectionState: EcoConnectionState.connecting,
        ),
        isTrue,
      );
      expect(
        isDesktopBindPending(
          hasPendingDesktop: true,
          hasActiveBindingChannel: false,
          connectionState: EcoConnectionState.disconnected,
        ),
        isTrue,
      );
    });

    test('false on terminal auth errors so UI can recover', () {
      expect(
        isDesktopBindPending(
          hasPendingDesktop: true,
          hasActiveBindingChannel: false,
          connectionState: EcoConnectionState.error,
          authRecovery: CenterServerAuthRecovery.relogin,
        ),
        isFalse,
      );
    });

    test('false when no desktop is selected', () {
      expect(
        isDesktopBindPending(
          hasPendingDesktop: false,
          hasActiveBindingChannel: false,
          connectionState: EcoConnectionState.disconnected,
        ),
        isFalse,
      );
    });
  });

  group('ensureDesktopBindReady', () {
    test('passes once the center client has a live bind channel', () async {
      final container = ProviderContainer(
        overrides: [
          ecoCenterClientProvider.overrideWithValue(
            _CenterClient(bound: true),
          ),
          connectionStatusProvider.overrideWith(
            (ref) => Stream.value(
              const CenterServerConnectionStatus(
                state: EcoConnectionState.connected,
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      expect(await _bindReady(container), isTrue);
    });

    test('stays pending while the bind channel is missing', () async {
      final client = _CenterClient(bound: false);
      final container = ProviderContainer(
        overrides: [
          ecoCenterClientProvider.overrideWithValue(client),
          connectionStatusProvider.overrideWith(
            (ref) => Stream.value(
              const CenterServerConnectionStatus(
                state: EcoConnectionState.connected,
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      expect(
        await _bindReady(container, timeout: const Duration(milliseconds: 60)),
        isFalse,
      );
      expect(client.connectCalls, greaterThan(0));
    });

    test('override answers without touching the center client', () async {
      final container = ProviderContainer(
        overrides: [
          // Deliberately unbound: the override must be what decides.
          ecoCenterClientProvider.overrideWithValue(
            _CenterClient(bound: false),
          ),
          desktopBindReadyOverrideProvider.overrideWithValue(true),
        ],
      );
      expect(await _bindReady(container), isTrue);

      final forcedFalse = ProviderContainer(
        overrides: [
          ecoCenterClientProvider.overrideWithValue(
            _CenterClient(bound: true),
          ),
          desktopBindReadyOverrideProvider.overrideWithValue(false),
        ],
      );
      expect(await _bindReady(forcedFalse), isFalse);

      container.dispose();
      forcedFalse.dispose();
    });
  });

  group('isTransientDesktopBindError', () {
    test('recognizes realtime bind failures', () {
      expect(
        isTransientDesktopBindError(
          EcoCenterException.app(EcoCenterErrorKind.websocketDisconnected),
        ),
        isTrue,
      );
      expect(
        isTransientDesktopBindError(
          EcoCenterException.app(EcoCenterErrorKind.bindingRequired),
        ),
        isTrue,
      );
      expect(
        isTransientDesktopBindError(
          EcoCenterException.app(EcoCenterErrorKind.rpcTimeout),
        ),
        isFalse,
      );
    });
  });
}
