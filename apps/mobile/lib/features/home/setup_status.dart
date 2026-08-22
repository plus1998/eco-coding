import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/storage/credential_store.dart';
import '../../core/providers/app_locale_provider.dart';
import '../../core/locale/app_error_localizations.dart';
import '../../core/utils/center_server_auth.dart';
import '../../core/utils/device_display.dart';
import '../../core/models/eco_types.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_session.dart';
import '../../l10n/generated/app_localizations.dart';

enum SetupStepState { pending, inProgress, done, error }

/// Active bindings for the current mobile device only (not other phones on the account).
List<DeviceBinding> activeBindingsForMobile(
  List<DeviceBinding>? bindings,
  String? mobileDeviceId,
) {
  if (bindings == null) return const [];
  if (mobileDeviceId == null || mobileDeviceId.isEmpty) return const [];
  return bindings
      .where(
        (binding) =>
            binding.isActive && binding.mobileDeviceId == mobileDeviceId,
      )
      .toList();
}

class SetupStep {
  const SetupStep({
    required this.id,
    required this.title,
    required this.state,
    this.subtitle,
    this.hint,
  });

  final String id;
  final String title;
  final SetupStepState state;
  final String? subtitle;
  final String? hint;
}

class SetupOverview {
  const SetupOverview({
    required this.steps,
    required this.readyForThreads,
    this.selectedDesktopId,
    this.bindingsReloading = false,
    this.isBootstrapping = false,
    // Optional for hot-reload compatibility; actual value comes from [setupComplete].
    bool? setupComplete,
  });

  final List<SetupStep> steps;
  final bool readyForThreads;
  final String? selectedDesktopId;
  final bool bindingsReloading;

  /// Logged in and has at least one active PC binding.
  bool get hasActiveBinding {
    if (steps.length < 5) return false;
    return steps[1].state == SetupStepState.done &&
        steps[3].state == SetupStepState.done;
  }

  /// Show bound PC list on the connect screen (independent of online status).
  bool get showPcPicker => hasActiveBinding || bindingsReloading;

  /// Stable gate: logged in, device registered, bound to a PC, and a bound PC is selected.
  bool get setupComplete {
    if (selectedDesktopId == null || selectedDesktopId!.isEmpty) return false;
    if (steps.length < 5) return false;
    return steps[1].state == SetupStepState.done &&
        steps[3].state == SetupStepState.done &&
        steps[4].state == SetupStepState.done;
  }

  /// Entering the app only needs a valid local setup. The selected PC may be
  /// temporarily offline while the session screen loads its cached content.
  bool get canEnterApp => setupComplete;

  /// True while cold-start session restore is still in flight — avoid flashing
  /// the scan-first screen before we know whether bindings exist.
  final bool isBootstrapping;
}

final setupOverviewProvider = Provider<SetupOverview>((ref) {
  final localePreference = ref.watch(appLocalePreferenceProvider);
  final locale = localePreference.locale ?? PlatformDispatcher.instance.locale;
  final l10n = lookupAppLocalizations(locale);
  final sessionAsync = ref.watch(appSessionProvider);
  final credentialsAsync = ref.watch(credentialsProvider);
  final persistedCredentials = ref.read(ecoCenterClientProvider).credentials;
  final credentials = credentialsAsync.valueOrNull ?? persistedCredentials;
  final bindingsAsync = ref.watch(bindingsProvider);
  final bindings = bindingsAsync.valueOrNull;
  final connection = ref.watch(connectionStatusProvider).valueOrNull;
  final presenceAsync = ref.watch(desktopPresenceProvider);
  final presence = presenceAsync.valueOrNull;
  final serverReachable = ref.watch(serverReachableProvider);
  final selectedDesktopId = ref.watch(selectedDesktopIdProvider);
  final effectiveSelectedDesktopId =
      selectedDesktopId ?? credentials.selectedDesktopId;

  final hasServerUrl = credentials.hasProjectConfig;
  final loggedIn = credentials.isProvisioned;
  final deviceRegistered = credentials.hasDeviceCredentials;
  final wsState = connection?.state ?? EcoConnectionState.disconnected;
  final wsError = connection?.lastError;

  final activeBindings = activeBindingsForMobile(
    bindings,
    credentials.deviceId,
  );
  final hasBinding = activeBindings.isNotEmpty;
  final bindingsReloading =
      bindingsAsync.isLoading &&
      bindings == null &&
      loggedIn &&
      deviceRegistered;

  String? selectedName;
  bool? selectedOnline;
  if (effectiveSelectedDesktopId != null) {
    selectedName = shortenDeviceId(effectiveSelectedDesktopId);
    if (presence != null) {
      for (final device in presence) {
        if (device.id == effectiveSelectedDesktopId) {
          selectedName = formatDesktopLabel(device, effectiveSelectedDesktopId);
          selectedOnline = device.online;
          break;
        }
      }
    }
  }

  SetupStepState serverStepState() {
    if (!hasServerUrl) return SetupStepState.pending;
    if (serverReachable == true) return SetupStepState.done;
    if (serverReachable == false) return SetupStepState.error;
    return SetupStepState.pending;
  }

  SetupStepState loginStepState() {
    if (!hasServerUrl) return SetupStepState.pending;
    if (loggedIn && deviceRegistered) return SetupStepState.done;
    if (loggedIn) return SetupStepState.inProgress;
    return SetupStepState.pending;
  }

  SetupStepState wsStepState() {
    if (!loggedIn || !deviceRegistered) return SetupStepState.pending;
    final session = ref.watch(appSessionProvider);
    if (session.isLoading) return SetupStepState.inProgress;
    switch (wsState) {
      case EcoConnectionState.connected:
        return SetupStepState.done;
      case EcoConnectionState.connecting:
        return SetupStepState.inProgress;
      case EcoConnectionState.error:
        return SetupStepState.error;
      case EcoConnectionState.disconnected:
        return SetupStepState.inProgress;
    }
  }

  SetupStepState bindStepState() {
    if (!loggedIn || !deviceRegistered) return SetupStepState.pending;
    if (hasBinding) return SetupStepState.done;
    if (bindingsReloading) return SetupStepState.inProgress;
    return SetupStepState.pending;
  }

  SetupStepState selectStepState() {
    if (!hasBinding && !bindingsReloading) {
      return effectiveSelectedDesktopId == null
          ? SetupStepState.pending
          : SetupStepState.inProgress;
    }
    if (effectiveSelectedDesktopId == null) {
      return SetupStepState.inProgress;
    }
    if (!activeBindings.any(
      (binding) => binding.desktopDeviceId == effectiveSelectedDesktopId,
    )) {
      return bindingsReloading
          ? SetupStepState.inProgress
          : SetupStepState.pending;
    }
    return SetupStepState.done;
  }

  final steps = [
    SetupStep(
      id: 'server',
      title: l10n.setupStatusServerReachable,
      state: serverStepState(),
      subtitle: hasServerUrl ? credentials.serverUrl : null,
      hint: serverReachable == false ? l10n.setupStatusServerHelp : null,
    ),
    SetupStep(
      id: 'login',
      title: l10n.setupStatusAccountDevice,
      state: loginStepState(),
      subtitle: loggedIn ? credentials.userEmail : null,
      hint: loggedIn && !deviceRegistered
          ? l10n.setupStatusRegisteringDevice
          : null,
    ),
    SetupStep(
      id: 'websocket',
      title: l10n.setupStatusLiveChannel,
      state: wsStepState(),
      subtitle: wsState == EcoConnectionState.connected
          ? l10n.setupStatusCenterConnected
          : wsState == EcoConnectionState.connecting ||
                wsState == EcoConnectionState.disconnected
          ? l10n.setupStatusConnecting
          : null,
      hint: wsStepState() == SetupStepState.error
          ? _websocketErrorHint(connection?.authRecovery, wsError, l10n)
          : null,
    ),
    SetupStep(
      id: 'bind',
      title: l10n.setupStatusPairPc,
      state: bindStepState(),
      subtitle: hasBinding
          ? l10n.setupStatusBoundCount(activeBindings.length)
          : null,
      hint: !hasBinding && !bindingsReloading ? l10n.setupStatusPairHint : null,
    ),
    SetupStep(
      id: 'select',
      title: l10n.setupStatusSelectControlledPc,
      state: selectStepState(),
      subtitle: effectiveSelectedDesktopId != null
          ? selectedOnline == null
                ? l10n.setupStatusCheckingDevice(
                    selectedName ?? effectiveSelectedDesktopId,
                  )
                : selectedOnline == true
                ? l10n.setupStatusDeviceOnline(
                    selectedName ?? effectiveSelectedDesktopId,
                  )
                : l10n.setupStatusDeviceOffline(
                    selectedName ?? effectiveSelectedDesktopId,
                  )
          : null,
      hint: effectiveSelectedDesktopId != null && selectedOnline == false
          ? l10n.setupStatusDesktopOfflineHelp
          : null,
    ),
  ];

  final gateComplete =
      loggedIn &&
      deviceRegistered &&
      effectiveSelectedDesktopId != null &&
      effectiveSelectedDesktopId.isNotEmpty;

  final readyForThreads =
      gateComplete &&
      wsState == EcoConnectionState.connected &&
      selectedOnline == true;

  return SetupOverview(
    steps: steps,
    readyForThreads: readyForThreads,
    selectedDesktopId: effectiveSelectedDesktopId,
    bindingsReloading: bindingsReloading,
    isBootstrapping: isConnectBootstrapping(
      sessionAsync: sessionAsync,
      credentialsAsync: credentialsAsync,
      bindingsAsync: bindingsAsync,
      loggedIn: loggedIn,
      deviceRegistered: deviceRegistered,
    ),
  );
});

/// True on cold start until session/credentials/bindings are ready to choose UI.
bool isConnectBootstrapping({
  required AsyncValue<void> sessionAsync,
  required AsyncValue<AppCredentials> credentialsAsync,
  required AsyncValue<List<DeviceBinding>> bindingsAsync,
  required bool loggedIn,
  required bool deviceRegistered,
}) {
  if (sessionAsync.isLoading && !sessionAsync.hasValue) return true;
  if (credentialsAsync.isLoading && !credentialsAsync.hasValue) return true;
  if (loggedIn &&
      deviceRegistered &&
      !bindingsAsync.hasValue &&
      !bindingsAsync.hasError) {
    return true;
  }
  return false;
}

/// True while the bound-PC list has no rows yet and bindings are still in flight.
bool isPcBindingListLoading(
  AsyncValue<List<DeviceBinding>> bindingsAsync, {
  String? mobileDeviceId,
}) {
  if (bindingsAsync.hasError) return false;
  final active = activeBindingsForMobile(
    bindingsAsync.valueOrNull,
    mobileDeviceId,
  );
  if (active.isNotEmpty) return false;
  return !bindingsAsync.hasValue ||
      bindingsAsync.isLoading ||
      bindingsAsync.isRefreshing;
}

String? _websocketErrorHint(
  CenterServerAuthRecovery? authRecovery,
  String? wsError,
  AppLocalizations l10n,
) {
  final ecoError = localizedEcoCenterMessageKey(wsError, l10n);
  if (ecoError != null) return ecoError;
  final recovery = authRecovery ?? classifyCenterServerAuthError(wsError);
  if (recovery != CenterServerAuthRecovery.unknown) {
    return localizedCenterServerRecovery(recovery, l10n);
  }
  return wsError ?? l10n.setupStatusWebSocketDisconnected;
}
