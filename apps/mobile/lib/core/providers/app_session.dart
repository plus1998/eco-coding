import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';

/// Runs once at app start: restore saved desktop selection and refresh the PC list.
/// The picker may start Presence separately; bind/RPC starts in the session screen.
final appSessionProvider = FutureProvider<void>((ref) async {
  final client = ref.read(ecoCenterClientProvider);
  await client.initialize();

  final creds = client.credentials;
  if (creds.selectedDesktopId != null && creds.selectedDesktopId!.isNotEmpty) {
    final current = ref.read(selectedDesktopIdProvider);
    if (current == null || current.isEmpty) {
      ref.read(selectedDesktopIdProvider.notifier).state =
          creds.selectedDesktopId;
    }
  }

  if (creds.hasProjectConfig) {
    final reachable = await client.testConnection(
      creds.supabaseUrl,
      anonKey: creds.anonKey,
    );
    ref.read(serverReachableProvider.notifier).state = reachable;
  }

  if (creds.hasDeviceCredentials && creds.hasProjectConfig) {
    await ref.read(desktopPresenceProvider.notifier).refresh(force: true);
  }
});

Future<void> refreshAppSession(WidgetRef ref) async {
  ref.invalidate(appSessionProvider);
  await ref.read(appSessionProvider.future);
}
