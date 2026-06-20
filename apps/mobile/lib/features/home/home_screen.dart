import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/eco_types.dart' show EcoConnectionState;
import '../../core/network/eco_center_client.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_theme.dart';
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
    final client = ref.read(ecoCenterClientProvider);
    await client.initialize();
    final creds = client.credentials;
    _serverUrlController.text = creds.serverUrl;
    _emailController.text = creds.userEmail ?? '';
    if (creds.selectedDesktopId != null) {
      ref.read(selectedDesktopIdProvider.notifier).state =
          creds.selectedDesktopId;
    }
    if (creds.serverUrl.trim().isNotEmpty) {
      final ok = await client.testConnection(creds.serverUrl);
      ref.read(serverReachableProvider.notifier).state = ok;
    }
    if (creds.hasDeviceCredentials && creds.serverUrl.isNotEmpty) {
      await _ensureConnected(silent: true);
    }
    ref.invalidate(credentialsProvider);
    ref.invalidate(bindingsProvider);
    ref.invalidate(presenceProvider);
    if (mounted) {
      final overview = ref.read(setupOverviewProvider);
      setState(() => _wizardStep ??= resolveSetupWizardStep(overview));
    }
  }

  Future<void> _ensureConnected({bool silent = false}) async {
    final client = ref.read(ecoCenterClientProvider);
    if (client.status.state == EcoConnectionState.connected) return;
    try {
      await client.connect();
    } catch (error) {
      if (!silent && mounted) {
        _showSnack(error.toString());
      }
    }
  }

  Future<void> _refreshStatus() async {
    setState(() => _refreshing = true);
    try {
      final client = ref.read(ecoCenterClientProvider);
      await client.initialize();
      if (_serverUrlController.text.trim().isNotEmpty) {
        final ok = await client.testConnection(_serverUrlController.text);
        ref.read(serverReachableProvider.notifier).state = ok;
      }
      if (client.credentials.hasDeviceCredentials) {
        await _ensureConnected(silent: true);
        ref.invalidate(bindingsProvider);
        ref.invalidate(presenceProvider);
      }
      ref.invalidate(credentialsProvider);
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
        await client.quickJoinFromQr(payload);
        final creds = client.credentials;
        _serverUrlController.text = creds.serverUrl;
        _emailController.text = creds.userEmail ?? '';
        ref.read(selectedDesktopIdProvider.notifier).state =
            creds.selectedDesktopId;
        ref.read(serverReachableProvider.notifier).state = true;
        ref.invalidate(credentialsProvider);
        ref.invalidate(bindingsProvider);
        ref.invalidate(presenceProvider);
        setState(() => _showManualSetup = false);
        _showSnack('已连接 PC');
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('连接 PC'),
        leading: Navigator.canPop(context)
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: actionBusy ? null : () => context.pop(),
              )
            : _showManualSetup && !overview.readyForThreads
                ? IconButton(
                    icon: const Icon(Icons.qr_code_scanner),
                    tooltip: '返回扫码',
                    onPressed: actionBusy
                        ? null
                        : () => setState(() => _showManualSetup = false),
                  )
                : null,
        actions: [
          IconButton(
            onPressed: actionBusy ? null : _refreshStatus,
            icon: _refreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
            tooltip: '刷新状态',
          ),
        ],
      ),
      body: overview.readyForThreads
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
                        showNext: isSetupWizardStepDone(
                              currentStep,
                              overview,
                            ) &&
                            currentStep != SetupWizardStep.selectPc,
                        showEnterApp: overview.readyForThreads,
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
              ref.invalidate(presenceProvider);
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
                _pairCodeController.text = payload.code;
              }
            },
            onBind: () => _run(() async {
              final client = ref.read(ecoCenterClientProvider);
              await client.claimPairing(_pairCodeController.text);
              ref.invalidate(bindingsProvider);
              ref.invalidate(presenceProvider);
              _pairCodeController.clear();
              _showSnack('绑定成功');
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

class _ConnectStepHeader extends StatelessWidget {
  const _ConnectStepHeader({
    required this.step,
    required this.overview,
  });

  final SetupWizardStep step;
  final SetupOverview overview;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final done = isSetupWizardStepDone(step, overview);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          step.title,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
                letterSpacing: -0.3,
              ),
        ),
        if (!done) ...[
          const SizedBox(height: 6),
          Text(
            step.subtitle,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: eco.textMuted,
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
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: EcoColors.borderSidebar)),
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
                ? Icon(Icons.check_circle_outline, color: ecoThemeExtras(context).statusAllowText)
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
                  color: ecoThemeExtras(context).statusDenyText,
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
                    color: ecoThemeExtras(context).statusDenyText,
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
                icon: const Icon(Icons.qr_code_scanner_outlined),
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
    final presenceAsync = ref.watch(presenceProvider);
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

        final presence = presenceAsync.valueOrNull ?? [];
        final onlineIds =
            presence.where((d) => d.online).map((d) => d.id).toSet();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: active.map((binding) {
            final desktopId = binding.desktopDeviceId;
            final online = onlineIds.contains(desktopId);
            final device =
                presence.where((d) => d.id == desktopId).firstOrNull;
            final name = device?.name ?? desktopId;
            final selected = selectedDesktop == desktopId;
            return Padding(
              padding: EdgeInsets.only(bottom: compact ? 6 : 8),
              child: _PcDeviceTile(
                name: name,
                online: online,
                selected: selected,
                onTap: busy ? null : () => onSelect(desktopId, name, online),
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
    required this.online,
    required this.selected,
    this.onTap,
  });

  final String name;
  final bool online;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Material(
      color: selected ? eco.accentSoft : eco.cardSurface,
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
                  ? EcoColors.accent.withValues(alpha: 0.45)
                  : eco.cardBorder,
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.desktop_windows_outlined,
                size: 20,
                color: selected ? EcoColors.accentText : eco.textSecondary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
                      ),
                ),
              ),
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: online ? eco.online : eco.offline,
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 10),
                Icon(Icons.check, size: 18, color: EcoColors.accentText),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AccountStatusRow extends StatelessWidget {
  const _AccountStatusRow({
    required this.email,
    required this.connected,
  });

  final String email;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: EcoColors.bgElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            connected ? Icons.check_circle_outline : Icons.person_outline,
            size: 18,
            color: connected ? eco.statusAllowText : eco.textSecondary,
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
    final eco = ecoThemeExtras(context);
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
                  color: EcoColors.accentSoft,
                  border: Border.all(
                    color: EcoColors.accent.withValues(alpha: 0.25),
                  ),
                ),
                child: const Icon(
                  Icons.qr_code_scanner_outlined,
                  size: 32,
                  color: EcoColors.accentText,
                ),
              ),
            ),
            const SizedBox(height: 28),
            Text(
              '扫描 PC 端配对码',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                  ),
            ),
            const SizedBox(height: 10),
            Text(
              '在 Desktop「连接」页生成二维码',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: eco.textMuted,
                  ),
            ),
            const Spacer(flex: 3),
            FilledButton(
              onPressed: busy ? null : onScan,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
              child: const Text('扫一扫'),
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
    final eco = ecoThemeExtras(context);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);
    final presence = ref.watch(presenceProvider).valueOrNull ?? [];
    String? selectedName;
    var selectedOnline = false;
    if (selectedDesktop != null) {
      for (final device in presence) {
        if (device.id == selectedDesktop) {
          selectedName = device.name;
          selectedOnline = device.online;
          break;
        }
      }
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
                      color: selectedOnline ? eco.online : eco.offline,
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
            FilledButton(
              onPressed: busy ? null : onEnterApp,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: const Text('进入应用'),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: busy ? null : onScan,
              icon: const Icon(Icons.qr_code_scanner_outlined, size: 18),
              label: const Text('绑定新 PC'),
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
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: eco.textMuted,
            ),
      ),
    );
  }
}
