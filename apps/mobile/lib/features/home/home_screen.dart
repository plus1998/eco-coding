import 'dart:async';

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/eco_types.dart';
import '../../core/network/eco_center_client.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_session.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/center_server_auth.dart';
import '../../core/utils/device_display.dart';
import '../../core/widgets/adaptive_glass_action_button.dart';
import '../../core/widgets/adaptive_toolbar_icon.dart';
import '../../core/widgets/eco_android_glass.dart';
import '../pairing/pairing_scan_screen.dart';
import 'setup_status.dart';
import 'setup_wizard.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _serverUrlController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _pairCodeController = TextEditingController();
  bool _isRegister = false;
  bool _busy = false;
  bool _refreshing = false;
  bool _showManualSetup = false;
  SetupWizardStep? _wizardStep;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await ref.read(appSessionProvider.future);
    final client = ref.read(ecoCenterClientProvider);
    final creds = client.credentials;
    _serverUrlController.text = creds.serverUrl;
    _emailController.text = creds.userEmail ?? '';
    if (mounted) {
      final overview = ref.read(setupOverviewProvider);
      setState(() => _wizardStep ??= resolveSetupWizardStep(overview));
    }
  }

  Future<void> _refreshStatus() async {
    setState(() => _refreshing = true);
    try {
      await refreshAppSession(ref);
      ref.invalidate(credentialsProvider);
      ref.invalidate(bindingsProvider);
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _handleAccountUnusable(CenterServerAuthRecovery recovery) async {
    final client = ref.read(ecoCenterClientProvider);
    await client.clearSession();
    ref.invalidate(credentialsProvider);
    ref.invalidate(bindingsProvider);
    ref.invalidate(desktopPresenceProvider);
    ref.read(selectedDesktopIdProvider.notifier).state = null;
    if (!mounted) return;
    setState(() {
      _wizardStep = SetupWizardStep.server;
      _showManualSetup = true;
    });
    _showSnack(centerServerAuthRecoveryMessage(recovery));
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _pairCodeController.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (error) {
      if (mounted) _showSnack(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _goToStep(SetupWizardStep step) {
    setState(() => _wizardStep = step);
  }

  void _goNext(SetupOverview overview) {
    final current = _wizardStep ?? resolveSetupWizardStep(overview);
    final nextIndex = current.index + 1;
    if (nextIndex < SetupWizardStep.values.length) {
      _goToStep(SetupWizardStep.values[nextIndex]);
    }
  }

  void _goBack() {
    final current = _wizardStep;
    if (current == null || current.index == 0) return;
    _goToStep(SetupWizardStep.values[current.index - 1]);
  }

  void _maybeAutoAdvance(SetupOverview overview, SetupWizardStep completed) {
    if (!_showManualSetup) return;
    final current = _wizardStep ?? resolveSetupWizardStep(overview);
    if (current == completed && isSetupWizardStepDone(completed, overview)) {
      final nextIndex = completed.index + 1;
      if (nextIndex < SetupWizardStep.values.length) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _goToStep(SetupWizardStep.values[nextIndex]);
        });
      }
    }
  }

  Future<void> _openScanner() async {
    final payload = await Navigator.of(context).push<PairingQrPayload>(
      MaterialPageRoute(builder: (_) => const PairingScanScreen()),
    );
    if (payload == null || !mounted) return;
    await _handleScanResult(payload);
  }

  Future<void> _handleScanResult(PairingQrPayload payload) async {
    if (payload.canQuickJoin) {
      await _run(() async {
        final client = ref.read(ecoCenterClientProvider);
        final result = await client.quickJoinFromQr(payload);
        final creds = client.credentials;
        _serverUrlController.text = creds.serverUrl;
        _emailController.text = creds.userEmail ?? '';
        ref.read(serverReachableProvider.notifier).state = true;
        ref.invalidate(credentialsProvider);
        final selected = await _selectDesktop(result.desktopDeviceId);
        setState(() => _showManualSetup = false);
        if (selected.online) {
          _showSnack(
            result.alreadyBound
                ? '已打开 ${selected.name}'
                : '已绑定 ${selected.name}',
          );
          if (mounted) context.go('/threads');
        } else {
          _showSnack('${selected.name} 已选择，但当前离线');
        }
      });
      return;
    }

    _pairCodeController.text = payload.code;
    setState(() {
      _showManualSetup = true;
      _wizardStep = SetupWizardStep.bindPc;
    });
    _showSnack('旧版二维码，请完成登录后绑定');
  }

  Future<_SelectedDesktopResult> _selectDesktop(String desktopId) async {
    final client = ref.read(ecoCenterClientProvider);
    ref.read(selectedDesktopIdProvider.notifier).state = desktopId;
    await client.setSelectedDesktop(desktopId);
    if (client.status.state != EcoConnectionState.connected) {
      await client.connect();
    }
    ref.invalidate(bindingsProvider);
    ref.invalidate(desktopPresenceProvider);
    await ref.read(desktopPresenceProvider.notifier).refresh(force: true);
    final presence = ref.read(desktopPresenceProvider).valueOrNull ?? [];
    final device = presence.where((entry) => entry.id == desktopId).firstOrNull;
    return _SelectedDesktopResult(
      name: formatDesktopLabel(device, desktopId),
      online: device?.online ?? false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final overview = ref.watch(setupOverviewProvider);
    final currentStep = _wizardStep ?? resolveSetupWizardStep(overview);
    final actionBusy = _busy || _refreshing;

    ref.listen<SetupOverview>(setupOverviewProvider, (previous, next) {
      if (previous == null) return;
      for (final step in SetupWizardStep.values) {
        if (!isSetupWizardStepDone(step, previous) &&
            isSetupWizardStepDone(step, next)) {
          _maybeAutoAdvance(next, step);
        }
      }
    });

    ref.listen(connectionStatusProvider, (previous, next) {
      next.whenData((status) {
        if (status.state != EcoConnectionState.error) {
          return;
        }
        final recovery =
            status.authRecovery ??
            classifyCenterServerAuthError(status.lastError);
        if (!shouldStopCenterServerReconnect(recovery)) {
          return;
        }
        if (recovery == CenterServerAuthRecovery.relogin) {
          setState(() => _wizardStep = SetupWizardStep.login);
          _showSnack(centerServerAuthRecoveryMessage(recovery));
          return;
        }
        if (recovery == CenterServerAuthRecovery.accountUnusable) {
          unawaited(_handleAccountUnusable(recovery));
          return;
        }
        if (recovery == CenterServerAuthRecovery.deviceInactive) {
          setState(() {
            _wizardStep = SetupWizardStep.login;
            _showManualSetup = true;
          });
          _showSnack(centerServerAuthRecoveryMessage(recovery));
        }
      });
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('连接 PC'),
        leading: Navigator.canPop(context)
            ? IconButton(
                icon: const Icon(EcoIcons.back),
                onPressed: actionBusy ? null : () => context.pop(),
              )
            : _showManualSetup && !overview.setupComplete
            ? IconButton(
                icon: const Icon(EcoIcons.qrScan),
                tooltip: '返回扫码',
                onPressed: actionBusy
                    ? null
                    : () => setState(() => _showManualSetup = false),
              )
            : null,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _refreshing
                ? _GlassRefreshSpinner()
                : AdaptiveToolbarIcon(
                    icon: EcoIcons.refresh,
                    tooltip: '刷新状态',
                    onPressed: actionBusy ? null : _refreshStatus,
                    size: sessionToolbarButtonSize,
                  ),
          ),
        ],
      ),
      body: overview.showPcPicker
          ? _ReadyConnectionView(
              overview: overview,
              busy: actionBusy,
              onScan: _openScanner,
              onEnterApp: () => context.go('/threads'),
              onSelectPc: (desktopId, name, online) async {
                ref.read(selectedDesktopIdProvider.notifier).state = desktopId;
                await ref
                    .read(ecoCenterClientProvider)
                    .setSelectedDesktop(desktopId);
                if (online) {
                  _showSnack('已选择 $name');
                } else {
                  _showSnack('$name 当前离线，请确认 Desktop 已连接 Server');
                }
              },
            )
          : _showManualSetup
          ? SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SetupWizardProgress(
                    current: currentStep,
                    overview: overview,
                    onStepTap: _goToStep,
                  ),
                  const SizedBox(height: 28),
                  _ConnectStepHeader(step: currentStep, overview: overview),
                  const SizedBox(height: 20),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: _buildStepContent(
                      key: ValueKey(currentStep),
                      step: currentStep,
                      overview: overview,
                      actionBusy: actionBusy,
                    ),
                  ),
                  const SizedBox(height: 24),
                  _WizardNavBar(
                    showBack: currentStep.index > 0,
                    showNext:
                        isSetupWizardStepDone(currentStep, overview) &&
                        currentStep != SetupWizardStep.selectPc,
                    showEnterApp: overview.setupComplete,
                    busy: actionBusy,
                    onBack: _goBack,
                    onNext: () => _goNext(overview),
                    onEnterApp: () => context.go('/threads'),
                    inline: true,
                  ),
                ],
              ),
            )
          : _ScanFirstView(
              busy: actionBusy,
              onScan: _openScanner,
              onManualSetup: () => setState(() {
                _showManualSetup = true;
                _wizardStep ??= resolveSetupWizardStep(overview);
              }),
            ),
    );
  }

  Widget _buildStepContent({
    required Key key,
    required SetupWizardStep step,
    required SetupOverview overview,
    required bool actionBusy,
  }) {
    return switch (step) {
      SetupWizardStep.server => KeyedSubtree(
        key: key,
        child: _ServerStep(
          controller: _serverUrlController,
          overview: overview,
          busy: actionBusy,
          onTest: () => _run(() async {
            final client = ref.read(ecoCenterClientProvider);
            final ok = await client.testConnection(_serverUrlController.text);
            ref.read(serverReachableProvider.notifier).state = ok;
            if (ok) {
              await client.setServerUrl(_serverUrlController.text);
              ref.invalidate(credentialsProvider);
              _showSnack('服务器可达');
            } else {
              _showSnack('无法访问服务器，请检查地址与网络');
            }
          }),
        ),
      ),
      SetupWizardStep.login => KeyedSubtree(
        key: key,
        child: _LoginStep(
          overview: overview,
          emailController: _emailController,
          passwordController: _passwordController,
          isRegister: _isRegister,
          busy: actionBusy,
          onToggleRegister: actionBusy
              ? null
              : (value) => setState(() => _isRegister = value),
          onSubmit: () => _run(() async {
            final client = ref.read(ecoCenterClientProvider);
            if (_serverUrlController.text.trim().isEmpty) {
              throw Exception('请先完成服务器配置');
            }
            await client.setServerUrl(_serverUrlController.text);
            if (_isRegister) {
              await client.register(
                email: _emailController.text,
                password: _passwordController.text,
              );
            } else {
              await client.login(
                email: _emailController.text,
                password: _passwordController.text,
              );
            }
            await client.ensureMobileDevice();
            await client.connect();
            ref.invalidate(credentialsProvider);
            ref.invalidate(bindingsProvider);
            ref.invalidate(desktopPresenceProvider);
            _showSnack('登录成功，WebSocket 已连接');
          }),
          onReconnect: () => _run(() async {
            await ref.read(ecoCenterClientProvider).connect();
            _showSnack('已尝试重新连接 WebSocket');
          }),
        ),
      ),
      SetupWizardStep.bindPc => KeyedSubtree(
        key: key,
        child: _BindPcStep(
          pairCodeController: _pairCodeController,
          overview: overview,
          busy: actionBusy,
          onScan: () async {
            final payload = await Navigator.of(context).push<PairingQrPayload>(
              MaterialPageRoute(builder: (_) => const PairingScanScreen()),
            );
            if (payload != null) {
              await _handleScanResult(payload);
            }
          },
          onBind: () => _run(() async {
            final client = ref.read(ecoCenterClientProvider);
            final binding = await client.claimPairing(_pairCodeController.text);
            _pairCodeController.clear();
            final selected = await _selectDesktop(binding.desktopDeviceId);
            if (selected.online) {
              _showSnack('已绑定 ${selected.name}');
              if (mounted) context.go('/threads');
            } else {
              _showSnack('${selected.name} 已绑定，但当前离线');
            }
          }),
        ),
      ),
      SetupWizardStep.selectPc => KeyedSubtree(
        key: key,
        child: _SelectPcStep(
          overview: overview,
          busy: actionBusy,
          onSelect: (desktopId, name, online) async {
            ref.read(selectedDesktopIdProvider.notifier).state = desktopId;
            await ref
                .read(ecoCenterClientProvider)
                .setSelectedDesktop(desktopId);
            if (online) {
              _showSnack('已选择 $name');
            } else {
              _showSnack('$name 当前离线');
            }
          },
        ),
      ),
    };
  }
}

class _SelectedDesktopResult {
  const _SelectedDesktopResult({required this.name, required this.online});

  final String name;
  final bool online;
}

class _ConnectStepHeader extends StatelessWidget {
  const _ConnectStepHeader({required this.step, required this.overview});

  final SetupWizardStep step;
  final SetupOverview overview;

  @override
  Widget build(BuildContext context) {
    final done = isSetupWizardStepDone(step, overview);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          step.title,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
        if (!done) ...[
          const SizedBox(height: 6),
          Text(
            step.subtitle,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: ecoColors(context).textMuted,
              height: 1.4,
            ),
          ),
        ],
      ],
    );
  }
}

class _WizardNavBar extends StatelessWidget {
  const _WizardNavBar({
    required this.showBack,
    required this.showNext,
    required this.busy,
    required this.onBack,
    required this.onNext,
    this.showEnterApp = false,
    this.onEnterApp,
    this.inline = false,
  });

  final bool showBack;
  final bool showNext;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final bool showEnterApp;
  final VoidCallback? onEnterApp;
  final bool inline;

  @override
  Widget build(BuildContext context) {
    if (!showBack && !showNext && !showEnterApp) {
      return const SizedBox.shrink();
    }

    final buttons = Row(
      children: [
        if (showBack)
          OutlinedButton(
            onPressed: busy ? null : onBack,
            child: const Text('上一步'),
          ),
        const Spacer(),
        if (showNext)
          OutlinedButton(
            onPressed: busy ? null : onNext,
            child: const Text('下一步'),
          ),
        if (showEnterApp && onEnterApp != null) ...[
          if (showNext) const SizedBox(width: 8),
          FilledButton(
            onPressed: busy ? null : onEnterApp,
            child: const Text('进入应用'),
          ),
        ],
      ],
    );

    if (inline) {
      return buttons;
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: ecoColors(context).borderSidebar),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: buttons,
        ),
      ),
    );
  }
}

class _ServerStep extends StatelessWidget {
  const _ServerStep({
    required this.controller,
    required this.overview,
    required this.busy,
    required this.onTest,
  });

  final TextEditingController controller;
  final SetupOverview overview;
  final bool busy;
  final VoidCallback onTest;

  @override
  Widget build(BuildContext context) {
    final serverStep = overview.steps[0];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: controller,
          decoration: InputDecoration(
            labelText: 'Center Server',
            hintText: 'http://192.168.1.10:3128',
            suffixIcon: serverStep.state == SetupStepState.done
                ? Icon(
                    EcoIcons.checkCircle,
                    color: ecoColors(context).statusAllowText,
                  )
                : null,
          ),
          keyboardType: TextInputType.url,
          enabled: !busy,
        ),
        if (serverStep.hint != null) ...[
          const SizedBox(height: 8),
          Text(
            serverStep.hint!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: ecoColors(context).statusDenyText,
            ),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy ? null : onTest,
          child: Text(
            serverStep.state == SetupStepState.done ? '重新测试' : '测试连接',
          ),
        ),
      ],
    );
  }
}

class _LoginStep extends ConsumerWidget {
  const _LoginStep({
    required this.overview,
    required this.emailController,
    required this.passwordController,
    required this.isRegister,
    required this.busy,
    required this.onToggleRegister,
    required this.onSubmit,
    required this.onReconnect,
  });

  final SetupOverview overview;
  final TextEditingController emailController;
  final TextEditingController passwordController;
  final bool isRegister;
  final bool busy;
  final ValueChanged<bool>? onToggleRegister;
  final VoidCallback onSubmit;
  final VoidCallback onReconnect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final credentials = ref.watch(credentialsProvider).valueOrNull;
    final loggedIn = credentials?.isProvisioned ?? false;
    final wsStep = overview.steps[2];

    if (loggedIn) {
      final wsNeedsAttention = wsStep.state == SetupStepState.error;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _AccountStatusRow(
            email: credentials!.userEmail!,
            connected: wsStep.state == SetupStepState.done,
          ),
          if (wsNeedsAttention) ...[
            const SizedBox(height: 12),
            Text(
              wsStep.hint ?? '连接异常',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: ecoColors(context).statusDenyText,
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: busy ? null : onReconnect,
              child: const Text('重试连接'),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (overview.steps[0].state != SetupStepState.done)
          const _StepBlockedHint(text: '请先完成服务器配置')
        else ...[
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('登录')),
              ButtonSegment(value: true, label: Text('注册')),
            ],
            selected: {isRegister},
            onSelectionChanged: onToggleRegister == null
                ? null
                : (value) => onToggleRegister!(value.first),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: emailController,
            decoration: const InputDecoration(labelText: '邮箱'),
            keyboardType: TextInputType.emailAddress,
            enabled: !busy,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: passwordController,
            decoration: const InputDecoration(labelText: '密码'),
            obscureText: true,
            enabled: !busy,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : onSubmit,
            child: Text(isRegister ? '注册并登录' : '登录'),
          ),
        ],
      ],
    );
  }
}

class _BindPcStep extends StatelessWidget {
  const _BindPcStep({
    required this.pairCodeController,
    required this.overview,
    required this.busy,
    required this.onScan,
    required this.onBind,
  });

  final TextEditingController pairCodeController;
  final SetupOverview overview;
  final bool busy;
  final VoidCallback onScan;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final bindStep = overview.steps[3];

    if (bindStep.state == SetupStepState.done) {
      return _AccountStatusRow(
        email: bindStep.subtitle ?? '已绑定 PC',
        connected: true,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (overview.steps[1].state != SetupStepState.done)
          const _StepBlockedHint(text: '请先完成登录')
        else ...[
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: pairCodeController,
                  decoration: const InputDecoration(
                    labelText: '配对码',
                    hintText: '8 位',
                  ),
                  textCapitalization: TextCapitalization.characters,
                  enabled: !busy,
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                onPressed: busy ? null : onScan,
                icon: const Icon(EcoIcons.qrScan),
                tooltip: '扫码',
              ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : onBind,
            child: const Text('绑定'),
          ),
        ],
      ],
    );
  }
}

class _SelectPcStep extends ConsumerWidget {
  const _SelectPcStep({
    required this.overview,
    required this.busy,
    required this.onSelect,
    this.compact = false,
  });

  final SetupOverview overview;
  final bool busy;
  final Future<void> Function(String desktopId, String name, bool online)
  onSelect;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bindingsAsync = ref.watch(bindingsProvider);
    final presenceAsync = ref.watch(desktopPresenceProvider);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);

    if (overview.steps[3].state != SetupStepState.done) {
      return const _StepBlockedHint(text: '请先绑定 PC');
    }

    return bindingsAsync.when(
      data: (bindings) {
        final active = bindings.where((b) => b.isActive).toList();
        if (active.isEmpty) {
          return const _StepBlockedHint(text: '暂无绑定设备');
        }

        final seenDesktopIds = <String>{};
        final uniqueBindings = <DeviceBinding>[];
        for (final binding in active) {
          if (seenDesktopIds.add(binding.desktopDeviceId)) {
            uniqueBindings.add(binding);
          }
        }

        final presence = presenceAsync.valueOrNull ?? [];
        final presenceLoading =
            presenceAsync.isLoading && presenceAsync.valueOrNull == null;
        final onlineIds = presence
            .where((d) => d.online)
            .map((d) => d.id)
            .toSet();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: uniqueBindings.map((binding) {
            final desktopId = binding.desktopDeviceId;
            final stableOnline = ref.watch(
              stableDesktopOnlineProvider(desktopId),
            );
            final online = presenceLoading
                ? stableOnline
                : stableOnline ?? onlineIds.contains(desktopId);
            final device = presence.where((d) => d.id == desktopId).firstOrNull;
            final name = formatDesktopLabel(device, desktopId);
            final detail = formatDeviceDetail(device, desktopId);
            final selected = selectedDesktop == desktopId;
            return Padding(
              padding: EdgeInsets.only(bottom: compact ? 6 : 8),
              child: _PcDeviceTile(
                name: name,
                detail: detail,
                online: online,
                selected: selected,
                onTap: busy
                    ? null
                    : () => onSelect(desktopId, name, online ?? false),
              ),
            );
          }).toList(),
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      error: (error, _) => Text(error.toString()),
    );
  }
}

class _PcDeviceTile extends StatelessWidget {
  const _PcDeviceTile({
    required this.name,
    this.detail,
    required this.online,
    required this.selected,
    this.onTap,
  });

  final String name;
  final String? detail;
  final bool? online;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? ecoColors(context).accentSoft
          : ecoColors(context).cardSurface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? ecoColors(context).accent.withValues(alpha: 0.45)
                  : ecoColors(context).cardBorder,
            ),
          ),
          child: Row(
            children: [
              Icon(
                EcoIcons.desktop,
                size: 20,
                color: selected
                    ? ecoColors(context).accentText
                    : ecoColors(context).textSecondary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                      ),
                    ),
                    if (detail != null)
                      Text(
                        detail!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: ecoColors(context).textMuted,
                        ),
                      ),
                  ],
                ),
              ),
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: switch (online) {
                    null => ecoColors(
                      context,
                    ).textMuted.withValues(alpha: 0.55),
                    true => ecoColors(context).online,
                    false => ecoColors(context).offline,
                  },
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 10),
                Icon(
                  EcoIcons.check,
                  size: 18,
                  color: ecoColors(context).accentText,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AccountStatusRow extends StatelessWidget {
  const _AccountStatusRow({required this.email, required this.connected});

  final String email;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: ecoColors(context).bgElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ecoColors(context).borderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            connected ? EcoIcons.checkCircle : EcoIcons.user,
            size: 18,
            color: connected
                ? ecoColors(context).statusAllowText
                : ecoColors(context).textSecondary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              email,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

class _ScanFirstView extends StatelessWidget {
  const _ScanFirstView({
    required this.busy,
    required this.onScan,
    required this.onManualSetup,
  });

  final bool busy;
  final VoidCallback onScan;
  final VoidCallback onManualSetup;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Spacer(flex: 2),
            Center(
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: ecoColors(context).accentSoft,
                  border: Border.all(
                    color: ecoColors(context).accent.withValues(alpha: 0.25),
                  ),
                ),
                child: Icon(
                  EcoIcons.qrScan,
                  size: 32,
                  color: ecoColors(context).accentText,
                ),
              ),
            ),
            const SizedBox(height: 28),
            Text(
              '扫描 PC 端配对码',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
                letterSpacing: 0,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              '在 Desktop「连接」页生成二维码',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: ecoColors(context).textMuted,
              ),
            ),
            const Spacer(flex: 3),
            AdaptiveGlassActionButton(
              label: '扫一扫',
              icon: EcoIcons.qrScan,
              onPressed: busy ? null : onScan,
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: busy ? null : onManualSetup,
              child: const Text('手动配置'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadyConnectionView extends ConsumerWidget {
  const _ReadyConnectionView({
    required this.overview,
    required this.busy,
    required this.onScan,
    required this.onEnterApp,
    required this.onSelectPc,
  });

  final SetupOverview overview;
  final bool busy;
  final VoidCallback onScan;
  final VoidCallback onEnterApp;
  final Future<void> Function(String desktopId, String name, bool online)
  onSelectPc;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);
    final stableOnline = selectedDesktop == null
        ? null
        : ref.watch(stableDesktopOnlineProvider(selectedDesktop));
    final presenceAsync = ref.watch(desktopPresenceProvider);
    final presence = presenceAsync.valueOrNull ?? [];
    final presenceLoading =
        presenceAsync.isLoading && presenceAsync.valueOrNull == null;
    String? selectedName;
    bool? selectedOnline = stableOnline;
    if (selectedDesktop != null) {
      for (final device in presence) {
        if (device.id == selectedDesktop) {
          selectedName = formatDesktopLabel(device, selectedDesktop);
          selectedOnline ??= presenceLoading ? null : device.online;
          break;
        }
      }
      selectedOnline ??= presenceLoading ? null : false;
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (selectedName != null) ...[
              Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: switch (selectedOnline) {
                        null => ecoColors(
                          context,
                        ).textMuted.withValues(alpha: 0.55),
                        true => ecoColors(context).online,
                        false => ecoColors(context).offline,
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      selectedName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
            ],
            Expanded(
              child: _SelectPcStep(
                overview: overview,
                busy: busy,
                compact: true,
                onSelect: onSelectPc,
              ),
            ),
            const SizedBox(height: 16),
            AdaptiveGlassActionButton(
              label: '进入应用',
              icon: EcoIcons.goForward,
              onPressed: busy || !overview.readyForThreads ? null : onEnterApp,
            ),
            const SizedBox(height: 8),
            AdaptiveGlassActionButton(
              label: '绑定新 PC',
              icon: EcoIcons.qrScan,
              onPressed: busy ? null : onScan,
              height: 44,
            ),
          ],
        ),
      ),
    );
  }
}

class _StepBlockedHint extends StatelessWidget {
  const _StepBlockedHint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(
        text,
        style: Theme.of(
          context,
        ).textTheme.bodySmall?.copyWith(color: ecoColors(context).textMuted),
      ),
    );
  }
}

class _GlassRefreshSpinner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final spinner = SizedBox(
      width: 20,
      height: 20,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: ecoColors(context).textHeading,
      ),
    );

    const outerSize = sessionToolbarButtonSize; // 40
    if (PlatformInfo.isAndroid) {
      return SizedBox(
        width: outerSize,
        height: outerSize,
        child: Center(
          child: EcoAndroidGlassSurface(
            width: outerSize,
            height: outerSize,
            borderRadius: BorderRadius.circular(outerSize / 2),
            child: Center(child: spinner),
          ),
        ),
      );
    }

    return SizedBox(
      width: outerSize,
      height: outerSize,
      child: Center(
        child: AdaptiveButton.child(
          onPressed: null,
          style: AdaptiveButtonStyle.glass,
          size: AdaptiveButtonSize.medium,
          useSmoothRectangleBorder: false,
          child: SizedBox(
            width: outerSize,
            height: outerSize,
            child: Center(child: spinner),
          ),
        ),
      ),
    );
  }
}
