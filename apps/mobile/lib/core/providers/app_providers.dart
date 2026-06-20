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

  @override
  Future<List<PublicDevice>> build() async {
    ref.watch(connectionStatusProvider);
    final client = ref.watch(ecoCenterClientProvider);
    ref.onDispose(() {
      _pollTimer?.cancel();
      _pollTimer = null;
    });

    await client.initialize();
    if (!client.credentials.hasDeviceCredentials) {
      return [];
    }

    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(refresh());
    });

    return _fetchPresence(client);
  }

  Future<void> refresh() async {
    final client = ref.read(ecoCenterClientProvider);
    await client.initialize();
    if (!client.credentials.hasDeviceCredentials) {
      state = const AsyncData([]);
      return;
    }
    state = await AsyncValue.guard(() => _fetchPresence(client));
  }

  Future<List<PublicDevice>> _fetchPresence(EcoCenterClient client) async {
    try {
      return await client.listPresence();
    } catch (_) {
      return [];
    }
  }
}
