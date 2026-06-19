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
  return client.connectionStatus;
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

final presenceProvider = FutureProvider<List<PublicDevice>>((ref) async {
  final client = ref.watch(ecoCenterClientProvider);
  await client.initialize();
  if (!client.credentials.hasDeviceCredentials) return [];
  return client.listPresence();
});
