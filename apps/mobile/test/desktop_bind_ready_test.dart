import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/providers/desktop_bind_ready.dart';
import 'package:eco_mobile/core/utils/center_server_auth.dart';
import 'package:flutter_test/flutter_test.dart';

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
