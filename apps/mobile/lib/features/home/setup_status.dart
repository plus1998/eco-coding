import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart';
import '../../core/providers/app_providers.dart';

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
  const SetupOverview({required this.steps, required this.readyForThreads});

  final List<SetupStep> steps;
  final bool readyForThreads;
}

final serverReachableProvider = StateProvider<bool?>((ref) => null);

final setupOverviewProvider = Provider<SetupOverview>((ref) {
  final credentials = ref.watch(credentialsProvider).valueOrNull;
  final connection = ref.watch(connectionStatusProvider).valueOrNull;
  final bindings = ref.watch(bindingsProvider).valueOrNull;
  final presence = ref.watch(desktopPresenceProvider).valueOrNull;
  final serverReachable = ref.watch(serverReachableProvider);
  final selectedDesktopId = ref.watch(selectedDesktopIdProvider);

  final hasServerUrl = (credentials?.serverUrl ?? '').trim().isNotEmpty;
  final loggedIn = credentials?.isProvisioned ?? false;
  final deviceRegistered = credentials?.hasDeviceCredentials ?? false;
  final wsState = connection?.state ?? EcoConnectionState.disconnected;
  final wsError = connection?.lastError;

  final activeBindings =
      bindings?.where((binding) => binding.isActive).toList() ?? [];
  final hasBinding = activeBindings.isNotEmpty;

  String? selectedName;
  bool selectedOnline = false;
  if (selectedDesktopId != null && presence != null) {
    for (final device in presence) {
      if (device.id == selectedDesktopId) {
        selectedName = device.name;
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
    switch (wsState) {
      case EcoConnectionState.connected:
        return SetupStepState.done;
      case EcoConnectionState.connecting:
        return SetupStepState.inProgress;
      case EcoConnectionState.error:
        return SetupStepState.error;
      case EcoConnectionState.disconnected:
        return SetupStepState.pending;
    }
  }

  SetupStepState bindStepState() {
    if (!loggedIn || !deviceRegistered) return SetupStepState.pending;
    if (hasBinding) return SetupStepState.done;
    return SetupStepState.pending;
  }

  SetupStepState selectStepState() {
    if (!hasBinding) return SetupStepState.pending;
    if (selectedDesktopId != null) {
      return selectedOnline ? SetupStepState.done : SetupStepState.error;
    }
    return SetupStepState.inProgress;
  }

  final steps = [
    SetupStep(
      id: 'server',
      title: '服务器可达',
      state: serverStepState(),
      subtitle: hasServerUrl ? credentials!.serverUrl : null,
      hint: serverReachable == false
          ? '请检查地址、Wi‑Fi 与 Server 是否监听 0.0.0.0'
          : null,
    ),
    SetupStep(
      id: 'login',
      title: '账号与手机设备',
      state: loginStepState(),
      subtitle: loggedIn ? credentials!.userEmail : null,
      hint: loggedIn && !deviceRegistered ? '正在注册本机设备…' : null,
    ),
    SetupStep(
      id: 'websocket',
      title: '实时通道 (WebSocket)',
      state: wsStepState(),
      subtitle: wsState == EcoConnectionState.connected
          ? '已连接 Center Server'
          : null,
      hint: wsStepState() == SetupStepState.error
          ? (wsError ?? 'WebSocket 未连接，请重新登录或下拉刷新')
          : null,
    ),
    SetupStep(
      id: 'bind',
      title: '绑定 PC',
      state: bindStepState(),
      subtitle: hasBinding ? '已绑定 ${activeBindings.length} 台' : null,
      hint: !hasBinding ? '在 Desktop 生成配对码后扫码或手输' : null,
    ),
    SetupStep(
      id: 'select',
      title: '选择操控的 PC',
      state: selectStepState(),
      subtitle: selectedDesktopId != null
          ? '${selectedName ?? selectedDesktopId}${selectedOnline ? ' · 在线' : ' · 离线'}'
          : null,
      hint: selectedDesktopId != null && !selectedOnline
          ? 'Desktop 需在线且已连接同一 Server'
          : null,
    ),
  ];

  final readyForThreads = steps.every(
    (step) => step.state == SetupStepState.done,
  );

  return SetupOverview(steps: steps, readyForThreads: readyForThreads);
});
