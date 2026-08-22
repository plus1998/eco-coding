import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/providers/app_providers.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/home/setup_status.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('SetupOverview.setupComplete', () {
    test('requires login, active binding, and selected bound desktop', () {
      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.pending,
          select: SetupStepState.done,
        ).setupComplete,
        isFalse,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.done,
          select: SetupStepState.pending,
        ).setupComplete,
        isFalse,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.done,
          select: SetupStepState.done,
        ).setupComplete,
        isTrue,
      );
    });
  });

  group('SetupOverview.showPcPicker', () {
    test('is true once logged in with an active binding', () {
      expect(
        _overview(
          selectedDesktopId: null,
          login: SetupStepState.done,
          bind: SetupStepState.done,
          select: SetupStepState.pending,
        ).showPcPicker,
        isTrue,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.pending,
          select: SetupStepState.pending,
        ).showPcPicker,
        isFalse,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.inProgress,
          select: SetupStepState.pending,
          bindingsReloading: true,
        ).showPcPicker,
        isTrue,
      );
    });
  });

  group('isPcBindingListLoading', () {
    test('is true before the first bindings payload arrives', () {
      expect(isPcBindingListLoading(const AsyncLoading()), isTrue);
    });

    test('is true while refreshing an empty binding list', () {
      expect(
        isPcBindingListLoading(const AsyncLoading<List<DeviceBinding>>().copyWithPrevious(const AsyncData([]))),
        isTrue,
      );
    });

    test('is false once active bindings are available', () {
      expect(
        isPcBindingListLoading(
          AsyncData([
            DeviceBinding(
              id: 'bind_1',
              userId: 'usr_1',
              mobileDeviceId: 'dev_mobile',
              desktopDeviceId: 'dev_desktop',
              capabilities: const ['rpc'],
              createdAt: '2026-01-01T00:00:00.000Z',
            ),
          ]),
        ),
        isFalse,
      );
    });
  });

  group('SetupOverview.canEnterApp', () {
    test('does not require the selected PC to be online', () {
      final overview = _overview(
        selectedDesktopId: 'dev_desktop',
        login: SetupStepState.done,
        bind: SetupStepState.done,
        select: SetupStepState.done,
      );

      expect(overview.readyForThreads, isFalse);
      expect(overview.canEnterApp, isTrue);
    });
  });

  group('isConnectBootstrapping', () {
    test('is true while session or credentials are loading on cold start', () {
      expect(
        isConnectBootstrapping(
          sessionAsync: const AsyncLoading(),
          credentialsAsync: const AsyncData(AppCredentials(supabaseUrl: '')),
          bindingsAsync: const AsyncData([]),
          loggedIn: false,
          deviceRegistered: false,
        ),
        isTrue,
      );

      expect(
        isConnectBootstrapping(
          sessionAsync: const AsyncData(null),
          credentialsAsync: const AsyncLoading(),
          bindingsAsync: const AsyncData([]),
          loggedIn: false,
          deviceRegistered: false,
        ),
        isTrue,
      );
    });

    test('waits for bindings when user is provisioned', () {
      expect(
        isConnectBootstrapping(
          sessionAsync: const AsyncData(null),
          credentialsAsync: const AsyncData(AppCredentials(supabaseUrl: 'https://x.supabase.co')),
          bindingsAsync: const AsyncLoading(),
          loggedIn: true,
          deviceRegistered: true,
        ),
        isTrue,
      );

      expect(
        isConnectBootstrapping(
          sessionAsync: const AsyncData(null),
          credentialsAsync: const AsyncData(AppCredentials(supabaseUrl: 'https://x.supabase.co')),
          bindingsAsync: const AsyncData([]),
          loggedIn: true,
          deviceRegistered: true,
        ),
        isFalse,
      );
    });

    test('is false for new users once session and credentials are ready', () {
      expect(
        isConnectBootstrapping(
          sessionAsync: const AsyncData(null),
          credentialsAsync: const AsyncData(AppCredentials(supabaseUrl: '')),
          bindingsAsync: const AsyncData([]),
          loggedIn: false,
          deviceRegistered: false,
        ),
        isFalse,
      );
    });
  });

  group('applyPresenceDeviceEvent', () {
    test('updates matching device online state', () {
      final devices = [
        const PublicDevice(
          id: 'dev_desktop',
          userId: 'usr_1',
          kind: 'desktop',
          name: 'Desktop',
          createdAt: '2026-01-01T00:00:00.000Z',
          online: true,
        ),
      ];

      final next = applyPresenceDeviceEvent(
        devices,
        const EcoEventEnvelope(
          id: 'evt_1',
          kind: presenceDeviceEventKind,
          source: 'center-server',
          occurredAt: '2026-01-01T00:00:01.000Z',
          payload: {
            'type': 'device.offline',
            'deviceId': 'dev_desktop',
            'deviceKind': 'desktop',
            'online': false,
            'lastSeenAt': '2026-01-01T00:00:01.000Z',
          },
        ),
      );

      expect(next.single.online, isFalse);
      expect(next.single.lastSeenAt, '2026-01-01T00:00:01.000Z');
    });

    test('ignores unrelated events', () {
      final devices = [
        const PublicDevice(
          id: 'dev_desktop',
          userId: 'usr_1',
          kind: 'desktop',
          name: 'Desktop',
          createdAt: '2026-01-01T00:00:00.000Z',
          online: true,
        ),
      ];

      final next = applyPresenceDeviceEvent(
        devices,
        const EcoEventEnvelope(
          id: 'evt_1',
          kind: 'thread.lifecycle',
          source: 'desktop',
          occurredAt: '2026-01-01T00:00:01.000Z',
          payload: {'type': 'thread.started'},
        ),
      );

      expect(identical(next, devices), isTrue);
    });
  });
}

SetupOverview _overview({
  required String? selectedDesktopId,
  required SetupStepState login,
  required SetupStepState bind,
  required SetupStepState select,
  bool bindingsReloading = false,
}) {
  return SetupOverview(
    selectedDesktopId: selectedDesktopId,
    readyForThreads: false,
    bindingsReloading: bindingsReloading,
    steps: [
      const SetupStep(
        id: 'server',
        title: 'server',
        state: SetupStepState.done,
      ),
      SetupStep(id: 'login', title: 'login', state: login),
      const SetupStep(
        id: 'websocket',
        title: 'websocket',
        state: SetupStepState.done,
      ),
      SetupStep(id: 'bind', title: 'bind', state: bind),
      SetupStep(id: 'select', title: 'select', state: select),
    ],
  );
}
