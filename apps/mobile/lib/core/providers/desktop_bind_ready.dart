import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/eco_types.dart';
import '../utils/center_server_auth.dart';
import 'app_providers.dart';

/// Wait until the Realtime bind channel is actually ready for Desktop RPCs.
///
/// List screens used to call [DesktopRpc] as soon as a PC id was selected,
/// often while status was still `connecting` — that surfaces as "can't load
/// sessions / device list", even though entering a session later recovers via
/// `recoverProjection`. Session UI is stable because it retries on connect;
/// lists did not wait.
Future<bool> ensureDesktopBindReady(
  Ref ref, {
  Duration timeout = const Duration(seconds: 12),
}) async {
  final client = ref.read(ecoCenterClientProvider);
  final deadline = DateTime.now().add(timeout);

  while (DateTime.now().isBefore(deadline)) {
    final state =
        ref.read(connectionStatusProvider).valueOrNull?.state ??
        EcoConnectionState.disconnected;
    if (state == EcoConnectionState.connected &&
        client.hasActiveBindingChannel) {
      return true;
    }

    // PC picker (Presence-only): do not promote to bind/RPC. Switching the
    // selected desktop would otherwise rebuild shell providers under /connect
    // and flash the global "Connecting…" banner.
    if (client.isPresenceOnlyMode) {
      return false;
    }

    // Don't spin forever on auth / missing-binding failures.
    if (state == EcoConnectionState.error) {
      final recovery =
          ref.read(connectionStatusProvider).valueOrNull?.authRecovery;
      if (recovery == CenterServerAuthRecovery.relogin ||
          recovery == CenterServerAuthRecovery.deviceInactive ||
          recovery == CenterServerAuthRecovery.accountUnusable) {
        return false;
      }
    }

    if (state != EcoConnectionState.connecting) {
      try {
        await client.connect();
      } catch (_) {}
      if (client.hasActiveBindingChannel &&
          (ref.read(connectionStatusProvider).valueOrNull?.state ==
              EcoConnectionState.connected)) {
        return true;
      }
    }

    await Future<void>.delayed(const Duration(milliseconds: 250));
  }

  return client.hasActiveBindingChannel &&
      ref.read(connectionStatusProvider).valueOrNull?.state ==
          EcoConnectionState.connected;
}

Future<T> withDesktopRpcRetry<T>(
  Future<T> Function() action, {
  int attempts = 3,
}) async {
  Object? lastError;
  for (var attempt = 0; attempt < attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1) break;
    }
    await Future<void>.delayed(Duration(milliseconds: 400 * (attempt + 1)));
  }
  throw lastError ?? StateError('Desktop RPC failed.');
}
