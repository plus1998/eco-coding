import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/center_server_auth.dart';
import '../../core/utils/device_display.dart';
import '../../core/models/eco_types.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_session.dart';

enum SetupStepState { pending, inProgress, done, error }

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
    // Optional for hot-reload compatibility; actual value comes from [setupComplete].
    bool? setupComplete,
  });

  final List<SetupStep> steps;
  final bool readyForThreads;
  final String? selectedDesktopId;

  /// Stable gate: logged in, device registered, bound to a PC, and selected PC is visible.
  bool get setupComplete {
    if (selectedDesktopId == null || selectedDesktopId!.isEmpty) return false;
    if (steps.length < 5) return false;
    return steps[1].state == SetupStepState.done &&
        steps[3].state == SetupStepState.done &&
        steps[4].state == SetupStepState.done;
  }
}

final setupOverviewProvider = Provider<SetupOverview>((ref) {
  ref.watch(appSessionProvider);
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

  final hasServerUrl = credentials.serverUrl.trim().isNotEmpty;
  final loggedIn = credentials.isProvisioned;
  final deviceRegistered = credentials.hasDeviceCredentials;
  final wsState = connection?.state ?? EcoConnectionState.disconnected;
  final wsError = connection?.lastError;

  final activeBindings =
      bindings?.where((binding) => binding.isActive).toList() ?? [];
  final hasBinding = activeBindings.isNotEmpty;
  final bindingsReloading =
      bindingsAsync.isLoading && bindings == null && loggedIn && deviceRegistered;

  String? selectedName;
  bool selectedOnline = false;
  if (effectiveSelectedDesktopId != null && presence != null) {
    for (final device in presence) {
      if (device.id == effectiveSelectedDesktopId) {
        selectedName = formatDesktopLabel(device, effectiveSelectedDesktopId);
        selectedOnline = device.online;
        break;
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
    if (effectiveSelectedDesktopId == null) {
      if (!hasBinding && !bindingsReloading) return SetupStepState.pending;
      return SetupStepState.inProgress;
    }
    if (!activeBindings.any((binding) => binding.desktopDeviceId == effectiveSelectedDesktopId)) {
      return bindingsReloading ? SetupStepState.inProgress : SetupStepState.pending;
    }
    if (presenceAsync.isLoading && presence == null) {
      return SetupStepState.inProgress;
    }
    if (presence == null) return SetupStepState.inProgress;
    final matched =
        presence.where((device) => device.id == effectiveSelectedDesktopId);
    if (matched.isEmpty) return SetupStepState.inProgress;
    return SetupStepState.done;
  }

  final steps = [
    SetupStep(
      id: 'server',
      title: '服务器可达',
      state: serverStepState(),
      subtitle: hasServerUrl ? credentials.serverUrl : null,
      hint: serverReachable == false
          ? '请检查地址、Wi‑Fi 与 Server 是否监听 0.0.0.0'
          : null,
    ),
    SetupStep(
      id: 'login',
      title: '账号与手机设备',
      state: loginStepState(),
      subtitle: loggedIn ? credentials.userEmail : null,
      hint: loggedIn && !deviceRegistered ? '正在注册本机设备…' : null,
    ),
    SetupStep(
      id: 'websocket',
      title: '实时通道 (WebSocket)',
      state: wsStepState(),
      subtitle: wsState == EcoConnectionState.connected
          ? '已连接 Center Server'
          : wsState == EcoConnectionState.connecting ||
                  wsState == EcoConnectionState.disconnected
              ? '正在连接…'
              : null,
      hint: wsStepState() == SetupStepState.error
          ? _websocketErrorHint(connection?.authRecovery, wsError)
          : null,
    ),
    SetupStep(
      id: 'bind',
      title: '绑定 PC',
      state: bindStepState(),
      subtitle: hasBinding ? '已绑定 ${activeBindings.length} 台' : null,
      hint: !hasBinding && !bindingsReloading
          ? '在 Desktop 生成配对码后扫码或手输'
          : null,
    ),
    SetupStep(
      id: 'select',
      title: '选择操控的 PC',
      state: selectStepState(),
      subtitle: effectiveSelectedDesktopId != null
          ? presenceAsync.isLoading && presence == null
              ? '${selectedName ?? effectiveSelectedDesktopId} · 检测中…'
              : '${selectedName ?? effectiveSelectedDesktopId}${selectedOnline ? ' · 在线' : ' · 离线'}'
          : null,
      hint: effectiveSelectedDesktopId != null &&
              presence != null &&
              !presenceAsync.isLoading &&
              !selectedOnline
          ? 'Desktop 当前离线，请确认 Desktop 已连接同一 Server'
          : null,
    ),
  ];

  final gateComplete = loggedIn &&
      deviceRegistered &&
      effectiveSelectedDesktopId != null &&
      effectiveSelectedDesktopId.isNotEmpty;

  final readyForThreads = gateComplete &&
      wsState == EcoConnectionState.connected &&
      selectedOnline;

  return SetupOverview(
    steps: steps,
    readyForThreads: readyForThreads,
    selectedDesktopId: effectiveSelectedDesktopId,
  );
});

String? _websocketErrorHint(CenterServerAuthRecovery? authRecovery, String? wsError) {
  final recovery = authRecovery ?? classifyCenterServerAuthError(wsError);
  if (recovery != CenterServerAuthRecovery.unknown) {
    return centerServerAuthRecoveryMessage(recovery);
  }
  return wsError ?? 'WebSocket 未连接，请重新登录或下拉刷新';
}
