import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
        title: const Text('PC 连接'),
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
            )
          : _showManualSetup
              ? Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SetupWizardProgress(
                              current: currentStep,
                              overview: overview,
                              onStepTap: _goToStep,
                            ),
                            const SizedBox(height: 24),
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 200),
                              child: _buildStepContent(
                                key: ValueKey(currentStep),
                                step: currentStep,
                                overview: overview,
                                actionBusy: actionBusy,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    _WizardNavBar(
                      showBack: currentStep.index > 0,
                      showNext: isSetupWizardStepDone(currentStep, overview) &&
                          currentStep != SetupWizardStep.selectPc,
                      busy: actionBusy,
                      onBack: _goBack,
                      onNext: () => _goNext(overview),
                    ),
                  ],
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

class _WizardNavBar extends StatelessWidget {
  const _WizardNavBar({
    required this.showBack,
    required this.showNext,
    required this.busy,
    required this.onBack,
    required this.onNext,
  });

  final bool showBack;
  final bool showNext;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    if (!showBack && !showNext) return const SizedBox.shrink();

    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: EcoColors.borderSidebar)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Row(
            children: [
              if (showBack)
                OutlinedButton(
                  onPressed: busy ? null : onBack,
                  child: const Text('上一步'),
                ),
              const Spacer(),
              if (showNext)
                FilledButton(
                  onPressed: busy ? null : onNext,
                  child: const Text('下一步'),
                ),
            ],
          ),
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
    final eco = ecoThemeExtras(context);
    final serverStep = overview.steps[0];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Center Server URL',
            hintText: 'http://192.168.31.124:3128',
          ),
          keyboardType: TextInputType.url,
          enabled: !busy,
        ),
        if (serverStep.hint != null) ...[
          const SizedBox(height: 8),
          Text(
            serverStep.hint!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.statusDenyText,
                ),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy ? null : onTest,
          child: const Text('测试服务器可达性'),
        ),
        if (serverStep.state == SetupStepState.done) ...[
          const SizedBox(height: 16),
          _StepDoneBanner(
            icon: Icons.dns_outlined,
            text: '已连接 ${serverStep.subtitle ?? ''}',
          ),
        ],
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
    final loginStep = overview.steps[1];
    final wsStep = overview.steps[2];

    if (loggedIn) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _StepDoneBanner(
            icon: Icons.verified_user_outlined,
            text: credentials!.userEmail!,
            subtitle: credentials.hasDeviceCredentials
                ? '手机设备已注册 · ${credentials.deviceId}'
                : '手机设备未注册',
          ),
          if (wsStep.hint != null) ...[
            const SizedBox(height: 12),
            Text(
              wsStep.hint!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: wsStep.state == SetupStepState.error
                        ? ecoThemeExtras(context).statusDenyText
                        : ecoThemeExtras(context).textSecondary,
                  ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: busy ? null : onReconnect,
              icon: const Icon(Icons.sync),
              label: const Text('重新连接 WebSocket'),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (loginStep.state == SetupStepState.pending &&
            overview.steps[0].state != SetupStepState.done)
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
    final eco = ecoThemeExtras(context);

    if (bindStep.state == SetupStepState.done) {
      return _StepDoneBanner(
        icon: Icons.link,
        text: bindStep.subtitle ?? '已绑定 PC',
        subtitle: '可在下一步选择要操控的设备',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (overview.steps[1].state != SetupStepState.done)
          const _StepBlockedHint(text: '请先完成登录')
        else ...[
          Text(
            '在 Desktop「连接」页生成配对码，然后扫码或手动输入。',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: eco.textSecondary,
                ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: pairCodeController,
                  decoration: const InputDecoration(
                    labelText: '配对码',
                    hintText: '8 位字母数字',
                  ),
                  textCapitalization: TextCapitalization.characters,
                  enabled: !busy,
                ),
              ),
              IconButton(
                onPressed: busy ? null : onScan,
                icon: const Icon(Icons.qr_code_scanner),
                tooltip: '扫码',
              ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : onBind,
            child: const Text('绑定 PC'),
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
  });

  final SetupOverview overview;
  final bool busy;
  final Future<void> Function(String desktopId, String name, bool online)
      onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eco = ecoThemeExtras(context);
    final bindingsAsync = ref.watch(bindingsProvider);
    final presenceAsync = ref.watch(presenceProvider);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);
    final selectStep = overview.steps[4];

    if (overview.steps[3].state != SetupStepState.done) {
      return const _StepBlockedHint(text: '请先绑定 PC');
    }

    return bindingsAsync.when(
      data: (bindings) {
        final active = bindings.where((b) => b.isActive).toList();
        if (active.isEmpty) {
          return const _StepBlockedHint(text: '暂无绑定。请在 Desktop「连接」页生成配对码。');
        }

        final presence = presenceAsync.valueOrNull ?? [];
        final onlineIds =
            presence.where((d) => d.online).map((d) => d.id).toSet();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (selectStep.state == SetupStepState.done &&
                selectStep.subtitle != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _StepDoneBanner(
                  icon: Icons.computer,
                  text: selectStep.subtitle!,
                ),
              ),
            ...active.map((binding) {
              final desktopId = binding.desktopDeviceId;
              final online = onlineIds.contains(desktopId);
              final device =
                  presence.where((d) => d.id == desktopId).firstOrNull;
              final name = device?.name ?? desktopId;
              final selected = selectedDesktop == desktopId;
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                color: selected ? eco.accentSoft : eco.cardSurface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: BorderSide(
                    color: selected ? EcoColors.accent : eco.cardBorder,
                  ),
                ),
                child: ListTile(
                  leading: Icon(
                    online ? Icons.computer : Icons.computer_outlined,
                    color: online ? eco.online : eco.offline,
                  ),
                  title: Text(name),
                  subtitle: Text(
                    online ? '在线 · 可远程操控' : '离线 · 需 Desktop 连接 Server',
                    style: TextStyle(
                      color: online ? eco.statusAllowText : eco.textMuted,
                    ),
                  ),
                  trailing: selected
                      ? Icon(Icons.check_circle, color: EcoColors.accentText)
                      : null,
                  onTap: busy ? null : () => onSelect(desktopId, name, online),
                ),
              );
            }),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Text(error.toString()),
    );
  }
}

class _StepDoneBanner extends StatelessWidget {
  const _StepDoneBanner({
    required this.icon,
    required this.text,
    this.subtitle,
  });

  final IconData icon;
  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: eco.statusAllowBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: EcoColors.statusAllowBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: eco.statusAllowText, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  text,
                  style: TextStyle(
                    color: eco.statusAllowText,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: TextStyle(color: eco.statusAllowText, fontSize: 13),
                  ),
                ],
              ],
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
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Spacer(),
            Icon(Icons.qr_code_scanner, size: 72, color: EcoColors.accentText),
            const SizedBox(height: 24),
            Text(
              '连接 PC',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            Text(
              '在 PC 端生成配对二维码，点击下方按钮扫码即可自动完成配置与绑定。',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: eco.textMuted,
                  ),
            ),
            const SizedBox(height: 32),
            FilledButton.icon(
              onPressed: busy ? null : onScan,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('扫一扫连接'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
            const Spacer(),
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
  });

  final SetupOverview overview;
  final bool busy;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eco = ecoThemeExtras(context);
    final selectStep = overview.steps[4];
    final credentials = ref.watch(credentialsProvider).valueOrNull;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: eco.statusAllowBg,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: EcoColors.statusAllowBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.check_circle, color: eco.statusAllowText),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '一切就绪，可前往「会话」远程操控 PC',
                        style: TextStyle(
                          color: eco.statusAllowText,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                if (selectStep.subtitle != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    '当前 PC：${selectStep.subtitle}',
                    style: TextStyle(color: eco.statusAllowText, fontSize: 13),
                  ),
                ],
                if (credentials?.serverUrl.isNotEmpty ?? false) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Server：${credentials!.serverUrl}',
                    style: TextStyle(color: eco.statusAllowText, fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: busy ? null : onScan,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('重新扫码 / 换绑 PC'),
          ),
        ],
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: EcoColors.bgElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: eco.textMuted, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: eco.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}
