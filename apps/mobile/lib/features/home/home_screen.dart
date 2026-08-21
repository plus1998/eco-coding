import 'dart:async';

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/locale/app_error_localizations.dart';
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
import '../../core/widgets/eco_grouped_list.dart';
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
  final _anonKeyController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _pairCodeController = TextEditingController();
  bool _isRegister = false;
  bool _busy = false;
  bool _refreshing = false;
  bool _showManualSetup = false;
  SetupWizardStep? _wizardStep;
  /// Set after scanning a full QR while logged out; completed automatically after login.
  PairingQrPayload? _pendingPairingQr;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await ref.read(appSessionProvider.future);
    final client = ref.read(ecoCenterClientProvider);
    final creds = client.credentials;
    _serverUrlController.text = creds.supabaseUrl;
    _anonKeyController.text = '';
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
    _showSnack(localizedCenterServerRecovery(recovery, context.l10n));
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _anonKeyController.dispose();
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
      if (mounted) _showSnack(localizedAppError(error, context.l10n));
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
    final projectUrl = payload.projectUrl?.trim();
    if (projectUrl != null && projectUrl.isNotEmpty) {
      final client = ref.read(ecoCenterClientProvider);
      final anonFromQr = payload.anonKey?.trim();
      final anon =
          (anonFromQr != null && anonFromQr.isNotEmpty)
              ? anonFromQr
              : (client.credentials.anonKey?.trim() ?? '');
      if (anon.isNotEmpty) {
        await client.setProjectConfig(
          supabaseUrl: projectUrl,
          anonKey: anon,
        );
        _serverUrlController.text = client.credentials.supabaseUrl;
        ref.invalidate(credentialsProvider);
      } else {
        await client.setServerUrl(projectUrl);
        _serverUrlController.text = client.credentials.supabaseUrl;
        ref.invalidate(credentialsProvider);
      }
    }

    if (payload.canQuickJoin) {
      await _run(() async {
        final client = ref.read(ecoCenterClientProvider);
        if (!client.credentials.hasUserSession) {
          _pendingPairingQr = payload;
          _pairCodeController.text = payload.code;
          setState(() {
            _showManualSetup = true;
            // QR already carried project URL + anon — only need the same account as Desktop.
            _wizardStep = SetupWizardStep.login;
          });
          _showSnack(context.l10n.setupScanNeedsLogin);
          return;
        }
        await _completeQuickPair(payload);
      });
      return;
    }

    _pendingPairingQr = null;
    _pairCodeController.text = payload.code;
    setState(() {
      _showManualSetup = true;
      _wizardStep = SetupWizardStep.bindPc;
    });
    _showSnack(context.l10n.setupLegacyQr);
  }

  Future<void> _completeQuickPair(PairingQrPayload payload) async {
    final client = ref.read(ecoCenterClientProvider);
    final result = await client.quickJoinFromQr(payload);
    _pendingPairingQr = null;
    final creds = client.credentials;
    _serverUrlController.text = creds.supabaseUrl;
    _emailController.text = creds.userEmail ?? '';
    ref.read(serverReachableProvider.notifier).state = true;
    ref.invalidate(credentialsProvider);
    final selected = await _selectDesktop(result.desktopDeviceId);
    setState(() => _showManualSetup = false);
    if (selected.online) {
      _showSnack(
        result.alreadyBound
            ? context.l10n.setupOpenedDevice(selected.name)
            : context.l10n.setupBoundDevice(selected.name),
      );
      if (mounted) context.go('/threads');
    } else {
      _showSnack(context.l10n.setupSelectedDeviceOffline(selected.name));
    }
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
          _showSnack(localizedCenterServerRecovery(recovery, context.l10n));
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
          _showSnack(localizedCenterServerRecovery(recovery, context.l10n));
        }
      });
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.setupConnectPc),
        leadingWidth: 64,
        leading: Navigator.canPop(context)
            ? Padding(
                padding: const EdgeInsets.only(left: 12),
                child: AdaptiveToolbarIcon(
                  icon: EcoIcons.back,
                  tooltip: context.l10n.commonBack,
                  size: sessionToolbarButtonSize,
                  onPressed: actionBusy ? null : () => context.pop(),
                ),
              )
            : _showManualSetup && !overview.setupComplete
            ? Padding(
                padding: const EdgeInsets.only(left: 12),
                child: AdaptiveToolbarIcon(
                  icon: EcoIcons.qrScan,
                  tooltip: context.l10n.commonBack,
                  size: sessionToolbarButtonSize,
                  onPressed: actionBusy
                      ? null
                      : () => setState(() => _showManualSetup = false),
                ),
              )
            : null,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _refreshing
                ? _GlassRefreshSpinner()
                : AdaptiveToolbarIcon(
                    icon: EcoIcons.refresh,
                    tooltip: context.l10n.commonRefresh,
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
                  _showSnack(context.l10n.setupSelectedDevice(name));
                } else {
                  _showSnack(context.l10n.setupDeviceOfflineServerHelp(name));
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
          urlController: _serverUrlController,
          anonKeyController: _anonKeyController,
          overview: overview,
          busy: actionBusy,
          onTest: () => _run(() async {
            final client = ref.read(ecoCenterClientProvider);
            final anonInput = _anonKeyController.text.trim();
            final anon =
                anonInput.isNotEmpty
                    ? anonInput
                    : (client.credentials.anonKey?.trim() ?? '');
            if (anon.isEmpty) {
              throw EcoCenterException.app(EcoCenterErrorKind.anonKeyRequired);
            }
            final ok = await client.testConnection(
              _serverUrlController.text,
              anonKey: anon,
            );
            ref.read(serverReachableProvider.notifier).state = ok;
            if (ok) {
              await client.setProjectConfig(
                supabaseUrl: _serverUrlController.text,
                anonKey: anon,
              );
              _anonKeyController.clear();
              ref.invalidate(credentialsProvider);
              _showSnack(context.l10n.setupServerReachable);
            } else {
              _showSnack(context.l10n.setupServerUnreachable);
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
              throw Exception(context.l10n.setupServerRequired);
            }
            final anonInput = _anonKeyController.text.trim();
            final anon =
                anonInput.isNotEmpty
                    ? anonInput
                    : (client.credentials.anonKey?.trim() ?? '');
            if (anon.isEmpty) {
              throw EcoCenterException.app(EcoCenterErrorKind.anonKeyRequired);
            }
            await client.setProjectConfig(
              supabaseUrl: _serverUrlController.text,
              anonKey: anon,
            );
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

            final pending = _pendingPairingQr;
            if (pending != null && pending.canQuickJoin) {
              await _completeQuickPair(pending);
              return;
            }
            _showSnack(context.l10n.setupLoginSuccess);
          }),
          onReconnect: () => _run(() async {
            await ref.read(ecoCenterClientProvider).connect();
            _showSnack(context.l10n.setupReconnectAttempted);
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
              _showSnack(context.l10n.setupBoundDevice(selected.name));
              if (mounted) context.go('/threads');
            } else {
              _showSnack(context.l10n.setupBoundDeviceOffline(selected.name));
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
              _showSnack(context.l10n.setupSelectedDevice(name));
            } else {
              _showSnack(context.l10n.setupSelectedDeviceOffline(name));
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
          step.title(context.l10n),
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
        if (!done) ...[
          const SizedBox(height: 6),
          Text(
            step.subtitle(context.l10n),
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
            child: Text(context.l10n.setupPrevious),
          ),
        const Spacer(),
        if (showNext)
          OutlinedButton(
            onPressed: busy ? null : onNext,
            child: Text(context.l10n.setupNext),
          ),
        if (showEnterApp && onEnterApp != null) ...[
          if (showNext) const SizedBox(width: 8),
          FilledButton(
            onPressed: busy ? null : onEnterApp,
            child: Text(context.l10n.setupEnterApp),
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

class _ServerStep extends ConsumerWidget {
  const _ServerStep({
    required this.urlController,
    required this.anonKeyController,
    required this.overview,
    required this.busy,
    required this.onTest,
  });

  final TextEditingController urlController;
  final TextEditingController anonKeyController;
  final SetupOverview overview;
  final bool busy;
  final VoidCallback onTest;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final serverStep = overview.steps[0];
    final hasSavedAnon =
        ref.watch(credentialsProvider).valueOrNull?.anonKey?.trim().isNotEmpty ==
        true;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: urlController,
          decoration: InputDecoration(
            labelText: context.l10n.setupSupabaseUrlLabel,
            hintText: context.l10n.setupSupabaseUrlHint,
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
        const SizedBox(height: 12),
        TextField(
          controller: anonKeyController,
          decoration: InputDecoration(
            labelText: context.l10n.setupAnonKeyLabel,
            hintText: hasSavedAnon
                ? context.l10n.setupAnonKeyKeep
                : context.l10n.setupAnonKeyHint,
          ),
          obscureText: true,
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
            serverStep.state == SetupStepState.done
                ? context.l10n.setupRetestConnection
                : context.l10n.setupTestConnection,
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
              wsStep.hint ?? context.l10n.setupConnectionError,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: ecoColors(context).statusDenyText,
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: busy ? null : onReconnect,
              child: Text(context.l10n.setupRetryConnection),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (overview.steps[0].state != SetupStepState.done)
          _StepBlockedHint(text: context.l10n.setupCompleteServerFirst)
        else ...[
          SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text(context.l10n.setupLogin)),
              ButtonSegment(
                value: true,
                label: Text(context.l10n.setupRegister),
              ),
            ],
            selected: {isRegister},
            onSelectionChanged: onToggleRegister == null
                ? null
                : (value) => onToggleRegister!(value.first),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: emailController,
            decoration: InputDecoration(labelText: context.l10n.setupEmail),
            keyboardType: TextInputType.emailAddress,
            enabled: !busy,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: passwordController,
            decoration: InputDecoration(labelText: context.l10n.setupPassword),
            obscureText: true,
            enabled: !busy,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : onSubmit,
            child: Text(
              isRegister
                  ? context.l10n.setupRegisterAndLogin
                  : context.l10n.setupLogin,
            ),
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
        email: bindStep.subtitle ?? context.l10n.setupBoundPcFallback,
        connected: true,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (overview.steps[1].state != SetupStepState.done)
          _StepBlockedHint(text: context.l10n.setupCompleteLoginFirst)
        else ...[
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: pairCodeController,
                  decoration: InputDecoration(
                    labelText: context.l10n.setupPairingCode,
                    hintText: context.l10n.setupPairingCodeHint,
                  ),
                  textCapitalization: TextCapitalization.characters,
                  enabled: !busy,
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                onPressed: busy ? null : onScan,
                icon: const Icon(EcoIcons.qrScan),
                tooltip: context.l10n.setupScan,
              ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : onBind,
            child: Text(context.l10n.setupBind),
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
    this.embedded = false,
  });

  final SetupOverview overview;
  final bool busy;
  final Future<void> Function(String desktopId, String name, bool online)
  onSelect;
  final bool compact;

  /// When true, skip outer [EcoGroupedSurface] (parent already provides one).
  final bool embedded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bindingsAsync = ref.watch(bindingsProvider);
    final presenceAsync = ref.watch(desktopPresenceProvider);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);

    if (overview.steps[3].state != SetupStepState.done) {
      return _StepBlockedHint(text: context.l10n.setupBindPcFirst);
    }

    return bindingsAsync.when(
      data: (bindings) {
        final active = bindings.where((b) => b.isActive).toList();
        if (active.isEmpty) {
          return _StepBlockedHint(text: context.l10n.setupNoBoundDevices);
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

        final list = Column(
          children: [
            for (var i = 0; i < uniqueBindings.length; i++) ...[
              if (i > 0) const EcoGroupedDivider(indent: 52),
              Builder(
                builder: (context) {
                  final binding = uniqueBindings[i];
                  final desktopId = binding.desktopDeviceId;
                  final stableOnline = ref.watch(
                    stableDesktopOnlineProvider(desktopId),
                  );
                  final online = presenceLoading
                      ? stableOnline
                      : stableOnline ?? onlineIds.contains(desktopId);
                  final device = presence
                      .where((d) => d.id == desktopId)
                      .firstOrNull;
                  final name = formatDesktopLabel(device, desktopId);
                  final detail = formatDeviceDetail(device);
                  final selected = selectedDesktop == desktopId;
                  return _PcDeviceTile(
                    name: name,
                    detail: detail,
                    online: online,
                    selected: selected,
                    dense: compact,
                    onTap: busy
                        ? null
                        : () => onSelect(desktopId, name, online ?? false),
                  );
                },
              ),
            ],
          ],
        );

        if (embedded) return list;

        return EcoGroupedSurface(margin: EdgeInsets.zero, child: list);
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
    this.dense = false,
    this.onTap,
  });

  final String name;
  final String? detail;
  final bool? online;
  final bool selected;
  final bool dense;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: onTap,
      highlighted: selected,
      padding: EdgeInsets.fromLTRB(16, dense ? 10 : 12, 14, dense ? 10 : 12),
      child: Row(
        children: [
          Icon(
            EcoIcons.desktop,
            size: 22,
            color: selected ? eco.accent : eco.textSecondary,
          ),
          const SizedBox(width: 14),
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: switch (online) {
                null => eco.textMuted.withValues(alpha: 0.45),
                true => eco.online,
                false => eco.offline,
              },
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    fontSize: 17,
                  ),
                ),
                if (detail != null)
                  Text(
                    detail!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                  ),
              ],
            ),
          ),
          if (selected)
            Icon(EcoIcons.check, size: 18, color: eco.accent),
        ],
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
    final eco = ecoColors(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: eco.cardSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            connected ? EcoIcons.checkCircle : EcoIcons.user,
            size: 20,
            color: connected ? eco.success : eco.textSecondary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              email,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.bodyLarge?.copyWith(fontSize: 17),
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
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Spacer(flex: 2),
            Center(
              child: Icon(
                EcoIcons.qrScan,
                size: 56,
                color: ecoColors(context).accent,
              ),
            ),
            const SizedBox(height: 28),
            Text(
              context.l10n.setupScanPcCode,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 10),
            Text(
              context.l10n.setupScanPcCodeHint,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: ecoColors(context).textMuted,
                fontSize: 16,
              ),
            ),
            const Spacer(flex: 3),
            AdaptiveGlassActionButton(
              label: context.l10n.setupScan,
              icon: EcoIcons.qrScan,
              onPressed: busy ? null : onScan,
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: busy ? null : onManualSetup,
              child: Text(context.l10n.setupManualConfiguration),
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
    final eco = ecoColors(context);
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
      selectedName ??= formatDesktopLabel(null, selectedDesktop);
    }

    final statusLabel = switch (selectedOnline) {
      true => context.l10n.commonOnline,
      false => context.l10n.commonOffline,
      null =>
        selectedName == null
            ? context.l10n.commonNotSelected
            : context.l10n.commonChecking,
    };
    final statusColor = switch (selectedOnline) {
      true => eco.online,
      false => eco.offline,
      null => eco.textMuted.withValues(alpha: 0.55),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(0, 8, 0, 24),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        context.l10n.setupSelectPc,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        context.l10n.setupSelectPcHint,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: eco.textMuted,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
                if (selectedName != null)
                  EcoGroupedSection(
                    label: context.l10n.setupCurrent,
                    topSpacing: 28,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                      child: Row(
                        children: [
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: eco.composerPillBg,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: SizedBox(
                              width: 48,
                              height: 48,
                              child: Icon(
                                EcoIcons.desktop,
                                size: 24,
                                color: eco.accent,
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  selectedName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w600),
                                ),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    Container(
                                      width: 8,
                                      height: 8,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: statusColor,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      statusLabel,
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall
                                          ?.copyWith(color: eco.textMuted),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                EcoGroupedSection(
                  label: context.l10n.setupBound,
                  topSpacing: selectedName == null ? 28 : 20,
                  footer: overview.canEnterApp
                      ? null
                      : context.l10n.setupSelectOnlinePcFirst,
                  child: _SelectPcStep(
                    overview: overview,
                    busy: busy,
                    compact: true,
                    embedded: true,
                    onSelect: onSelectPc,
                  ),
                ),
              ],
            ),
          ),
        ),
        _ReadyConnectionActions(
          busy: busy,
          canEnterApp: overview.canEnterApp,
          onEnterApp: onEnterApp,
          onBindNewPc: onScan,
        ),
      ],
    );
  }
}

class _ReadyConnectionActions extends StatelessWidget {
  const _ReadyConnectionActions({
    required this.busy,
    required this.canEnterApp,
    required this.onEnterApp,
    required this.onBindNewPc,
  });

  final bool busy;
  final bool canEnterApp;
  final VoidCallback onEnterApp;
  final VoidCallback onBindNewPc;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return DecoratedBox(
      decoration: BoxDecoration(color: eco.bgMain),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              AdaptiveGlassActionButton(
                label: context.l10n.setupEnterApp,
                icon: EcoIcons.goForward,
                onPressed: busy || !canEnterApp ? null : onEnterApp,
                height: 54,
                expand: false,
              ),
              const SizedBox(height: 4),
              TextButton.icon(
                onPressed: busy ? null : onBindNewPc,
                icon: Icon(EcoIcons.qrScan, size: 18, color: eco.accent),
                label: Text(
                  context.l10n.setupBindNewPc,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w400,
                    letterSpacing: -0.2,
                    color: eco.accent,
                  ),
                ),
              ),
            ],
          ),
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
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: ecoColors(context).textMuted),
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
