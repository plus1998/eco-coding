import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/eco_types.dart';
import '../network/eco_center_client.dart';
import '../storage/credential_store.dart';

final credentialStoreProvider = Provider<CredentialStore>((ref) {
  return CredentialStore();
});

final ecoCenterClientProvider = Provider<EcoCenterClient>((ref) {
  final store = ref.watch(credentialStoreProvider);
  final client = EcoCenterClient(store: store);
  ref.onDispose(() {
    client.dispose();
  });
  return client;
});

final credentialsProvider = FutureProvider<AppCredentials>((ref) async {
  final client = ref.watch(ecoCenterClientProvider);
  await client.initialize();
  return client.credentials;
});

final connectionStatusProvider = StreamProvider<CenterServerConnectionStatus>((ref) {
  final client = ref.watch(ecoCenterClientProvider);
  return () async* {
    yield client.status;
    yield* client.connectionStatus;
  }();
});

final ecoEventsProvider = StreamProvider<EcoEventEnvelope>((ref) {
  final client = ref.watch(ecoCenterClientProvider);
  return client.events;
});

final selectedDesktopIdProvider = StateProvider<String?>((ref) => null);

final serverReachableProvider = StateProvider<bool?>((ref) => null);

final bindingsProvider = FutureProvider<List<DeviceBinding>>((ref) async {
  final client = ref.watch(ecoCenterClientProvider);
  await client.initialize();
  if (!client.credentials.hasDeviceCredentials) return [];
  return client.listBindings();
});

final desktopPresenceProvider =
    AsyncNotifierProvider<DesktopPresenceNotifier, List<PublicDevice>>(
  DesktopPresenceNotifier.new,
);

class DesktopPresenceNotifier extends AsyncNotifier<List<PublicDevice>> {
  Timer? _pollTimer;
  Timer? _connectRefreshTimer;

  @override
  Future<List<PublicDevice>> build() async {
    final client = ref.watch(ecoCenterClientProvider);
    ref.onDispose(() {
      _pollTimer?.cancel();
      _pollTimer = null;
      _connectRefreshTimer?.cancel();
      _connectRefreshTimer = null;
    });

    ref.listen(connectionStatusProvider, (previous, next) {
      next.whenData((status) {
        if (status.state != EcoConnectionState.connected) {
          return;
        }
        final wasConnected =
            previous?.valueOrNull?.state == EcoConnectionState.connected;
        if (wasConnected) {
          return;
        }
        _connectRefreshTimer?.cancel();
        _connectRefreshTimer = Timer(const Duration(milliseconds: 600), () {
          unawaited(refresh(force: true));
        });
      });
    });

    await client.initialize();
    if (!client.credentials.hasDeviceCredentials) {
      return [];
    }

    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(refresh());
    });

    return _fetchPresenceWithRetry(client);
  }

  Future<void> refresh({bool force = false}) async {
    final client = ref.read(ecoCenterClientProvider);
    await client.initialize();
    if (!client.credentials.hasDeviceCredentials) {
      state = const AsyncData([]);
      return;
    }

    final previous = state.valueOrNull;
    if (!force && previous != null && state.isLoading) {
      return;
    }

    final next = await AsyncValue.guard(() => _fetchPresenceWithRetry(client));
    if (next.hasError) {
      if (previous != null && previous.isNotEmpty) {
        return;
      }
      state = next;
      return;
    }
    state = next;
  }

  Future<List<PublicDevice>> _fetchPresenceWithRetry(
    EcoCenterClient client,
  ) async {
    Object? lastError;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        return await client.listPresence();
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await Future<void>.delayed(
            Duration(milliseconds: 400 * (attempt + 1)),
          );
        }
      }
    }
    throw lastError ?? StateError('Failed to load desktop presence.');
  }
}

/// Debounced online status for a desktop — avoids UI flicker during presence polls.
final stableDesktopOnlineProvider =
    NotifierProvider.family<StableDesktopOnlineNotifier, bool?, String>(
  StableDesktopOnlineNotifier.new,
);

class StableDesktopOnlineNotifier extends FamilyNotifier<bool?, String> {
  Timer? _offlineTimer;

  @override
  bool? build(String desktopId) {
    ref.onDispose(() {
      _offlineTimer?.cancel();
      _offlineTimer = null;
    });

    ref.listen(desktopPresenceProvider, (_, next) {
      next.when(
        data: (devices) {
          final device =
              devices.where((entry) => entry.id == desktopId).firstOrNull;
          if (device == null) return;
          if (device.online) {
            _offlineTimer?.cancel();
            _offlineTimer = null;
            state = true;
            return;
          }
          if (state == true) {
            _offlineTimer ??= Timer(const Duration(seconds: 2), () {
              state = false;
            });
            return;
          }
          state = false;
        },
        loading: () {},
        error: (_, _) {},
      );
    });

    final presence = ref.watch(desktopPresenceProvider).valueOrNull;
    if (presence == null) return state;
    final device = presence.where((entry) => entry.id == desktopId).firstOrNull;
    return device?.online ?? state;
  }
}
