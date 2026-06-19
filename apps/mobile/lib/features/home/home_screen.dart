import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart' show EcoConnectionState;
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_theme.dart';
import '../pairing/pairing_scan_screen.dart';
import 'setup_status.dart';
import 'setup_status_card.dart';

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
    if (mounted) setState(() {});
    if (creds.hasDeviceCredentials && creds.serverUrl.isNotEmpty) {
      await _ensureConnected(silent: true);
    }
    ref.invalidate(credentialsProvider);
    ref.invalidate(bindingsProvider);
    ref.invalidate(presenceProvider);
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

  @override
  Widget build(BuildContext context) {
    final overview = ref.watch(setupOverviewProvider);
    final eco = ecoThemeExtras(context);
    final bindingsAsync = ref.watch(bindingsProvider);
    final presenceAsync = ref.watch(presenceProvider);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);
    final credentials = ref.watch(credentialsProvider).valueOrNull;
    final loggedIn = credentials?.hasUserSession ?? false;
    final actionBusy = _busy || _refreshing;

    return Scaffold(
      appBar: AppBar(title: const Text('PC 连接')),
      body: RefreshIndicator(
        onRefresh: _refreshStatus,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SetupStatusCard(
              overview: overview,
              onRefresh: () => _refreshStatus(),
              refreshing: _refreshing,
            ),
            const SizedBox(height: 20),
            _SectionHeader(
              number: 1,
              title: '服务器',
              done: overview.steps.first.state == SetupStepState.done,
            ),
            TextField(
              controller: _serverUrlController,
              decoration: const InputDecoration(
                labelText: 'Center Server URL',
                hintText: 'http://192.168.31.124:3128',
              ),
              keyboardType: TextInputType.url,
              enabled: !actionBusy,
            ),
            const SizedBox(height: 8),
            FilledButton.tonal(
              style: ecoTonalButtonStyle(context),
              onPressed: actionBusy
                  ? null
                  : () => _run(() async {
                      final client = ref.read(ecoCenterClientProvider);
                      final ok = await client.testConnection(
                        _serverUrlController.text,
                      );
                      ref.read(serverReachableProvider.notifier).state = ok;
                      if (ok) {
                        await client.setServerUrl(_serverUrlController.text);
                        ref.invalidate(credentialsProvider);
                        _showSnack('服务器可达');
                      } else {
                        _showSnack('无法访问服务器，请检查地址与网络');
                      }
                    }),
              child: const Text('测试服务器可达性'),
            ),
            const SizedBox(height: 24),
            _SectionHeader(
              number: 2,
              title: '登录',
              done: overview.steps[1].state == SetupStepState.done,
            ),
            if (loggedIn)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.verified_user_outlined),
                title: Text(credentials!.userEmail!),
                subtitle: Text(
                  credentials.hasDeviceCredentials
                      ? '手机设备已注册 · ${credentials.deviceId}'
                      : '手机设备未注册',
                ),
              )
            else ...[
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('登录')),
                  ButtonSegment(value: true, label: Text('注册')),
                ],
                selected: {_isRegister},
                onSelectionChanged: actionBusy
                    ? null
                    : (value) => setState(() => _isRegister = value.first),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _emailController,
                decoration: const InputDecoration(labelText: '邮箱'),
                keyboardType: TextInputType.emailAddress,
                enabled: !actionBusy,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: '密码'),
                obscureText: true,
                enabled: !actionBusy,
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: actionBusy
                    ? null
                    : () => _run(() async {
                        final client = ref.read(ecoCenterClientProvider);
                        if (_serverUrlController.text.trim().isEmpty) {
                          throw Exception('请先填写并测试服务器地址');
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
                child: Text(_isRegister ? '注册并登录' : '登录'),
              ),
            ],
            if (loggedIn && credentials!.hasDeviceCredentials) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: actionBusy
                    ? null
                    : () => _run(() async {
                        await ref.read(ecoCenterClientProvider).connect();
                        _showSnack('已尝试重新连接 WebSocket');
                      }),
                icon: const Icon(Icons.sync),
                label: const Text('重新连接 WebSocket'),
              ),
            ],
            const SizedBox(height: 24),
            _SectionHeader(
              number: 3,
              title: '绑定 PC',
              done: overview.steps[3].state == SetupStepState.done,
            ),
            if (!loggedIn)
              const Text('请先完成登录')
            else ...[
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _pairCodeController,
                      decoration: const InputDecoration(
                        labelText: '配对码',
                        hintText: '8 位字母数字',
                      ),
                      textCapitalization: TextCapitalization.characters,
                      enabled: !actionBusy,
                    ),
                  ),
                  IconButton(
                    onPressed: actionBusy
                        ? null
                        : () async {
                            final code = await Navigator.of(context)
                                .push<String>(
                                  MaterialPageRoute(
                                    builder: (_) => const PairingScanScreen(),
                                  ),
                                );
                            if (code != null) {
                              _pairCodeController.text = code;
                            }
                          },
                    icon: const Icon(Icons.qr_code_scanner),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              FilledButton.tonal(
                style: ecoTonalButtonStyle(context),
                onPressed: actionBusy
                    ? null
                    : () => _run(() async {
                        final client = ref.read(ecoCenterClientProvider);
                        await client.claimPairing(_pairCodeController.text);
                        ref.invalidate(bindingsProvider);
                        ref.invalidate(presenceProvider);
                        _pairCodeController.clear();
                        _showSnack('绑定成功');
                      }),
                child: const Text('绑定 PC'),
              ),
            ],
            const SizedBox(height: 24),
            _SectionHeader(
              number: 4,
              title: '选择 PC',
              done: overview.steps[4].state == SetupStepState.done,
            ),
            bindingsAsync.when(
              data: (bindings) {
                final active = bindings.where((b) => b.isActive).toList();
                if (!loggedIn) {
                  return const Text('请先完成登录');
                }
                if (active.isEmpty) {
                  return const Text('暂无绑定。请在 Desktop「连接」页生成配对码。');
                }
                final presence = presenceAsync.valueOrNull ?? [];
                final onlineIds = presence
                    .where((d) => d.online)
                    .map((d) => d.id)
                    .toSet();
                return Column(
                  children: active.map((binding) {
                    final desktopId = binding.desktopDeviceId;
                    final online = onlineIds.contains(desktopId);
                    final device = presence
                        .where((d) => d.id == desktopId)
                        .firstOrNull;
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
                            ? Icon(
                                Icons.check_circle,
                                color: EcoColors.accentText,
                              )
                            : null,
                        onTap: actionBusy
                            ? null
                            : () async {
                                ref
                                        .read(
                                          selectedDesktopIdProvider.notifier,
                                        )
                                        .state =
                                    desktopId;
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
                    );
                  }).toList(),
                );
              },
              loading: () => const LinearProgressIndicator(),
              error: (error, _) => Text(error.toString()),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.number,
    required this.title,
    required this.done,
  });

  final int number;
  final String title;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: done ? eco.statusAllowBg : EcoColors.bgElevated,
            child: Text(
              '$number',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: done ? eco.statusAllowText : eco.textMuted,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }
}
