import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart' show EcoConnectionState;
import '../../core/providers/app_providers.dart';
import '../pairing/pairing_scan_screen.dart';

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
  String? _message;

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
    if (mounted) setState(() {});
    if (creds.hasDeviceCredentials && creds.serverUrl.isNotEmpty) {
      await _ensureConnected();
    }
  }

  Future<void> _ensureConnected() async {
    final client = ref.read(ecoCenterClientProvider);
    if (client.status.state != EcoConnectionState.connected) {
      try {
        await client.connect();
      } catch (_) {}
    }
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
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await action();
    } catch (error) {
      setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bindingsAsync = ref.watch(bindingsProvider);
    final presenceAsync = ref.watch(presenceProvider);
    final connection = ref.watch(connectionStatusProvider);
    final selectedDesktop = ref.watch(selectedDesktopIdProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('PC 连接')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _serverUrlController,
            decoration: const InputDecoration(
              labelText: 'Center Server URL',
              hintText: 'http://192.168.1.10:3128',
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              FilledButton.tonal(
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          final ok = await ref
                              .read(ecoCenterClientProvider)
                              .testConnection(_serverUrlController.text);
                          setState(() => _message = ok ? '连接成功' : '无法连接');
                          if (ok) {
                            await ref
                                .read(ecoCenterClientProvider)
                                .setServerUrl(_serverUrlController.text);
                          }
                        }),
                child: const Text('测试连接'),
              ),
              const SizedBox(width: 8),
              connection.when(
                data: (status) => Chip(
                  label: Text(_connectionLabel(status.state)),
                ),
                loading: () => const Chip(label: Text('连接中…')),
                error: (_, __) => const Chip(label: Text('未连接')),
              ),
            ],
          ),
          const Divider(height: 32),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('登录')),
              ButtonSegment(value: true, label: Text('注册')),
            ],
            selected: {_isRegister},
            onSelectionChanged: (value) =>
                setState(() => _isRegister = value.first),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _emailController,
            decoration: const InputDecoration(labelText: '邮箱'),
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _passwordController,
            decoration: const InputDecoration(labelText: '密码'),
            obscureText: true,
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy
                ? null
                : () => _run(() async {
                      final client = ref.read(ecoCenterClientProvider);
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
                      ref.invalidate(bindingsProvider);
                      ref.invalidate(presenceProvider);
                      setState(() => _message = '账号已登录，设备已注册');
                    }),
            child: Text(_isRegister ? '注册并登录' : '登录'),
          ),
          const Divider(height: 32),
          const Text('绑定 PC', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
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
                ),
              ),
              IconButton(
                onPressed: () async {
                  final code = await Navigator.of(context).push<String>(
                    MaterialPageRoute(builder: (_) => const PairingScanScreen()),
                  );
                  if (code != null) {
                    _pairCodeController.text = code;
                  }
                },
                icon: const Icon(Icons.qr_code_scanner),
              ),
            ],
          ),
          FilledButton.tonal(
            onPressed: _busy
                ? null
                : () => _run(() async {
                      final client = ref.read(ecoCenterClientProvider);
                      await client.claimPairing(_pairCodeController.text);
                      ref.invalidate(bindingsProvider);
                      ref.invalidate(presenceProvider);
                      setState(() => _message = '配对成功');
                    }),
            child: const Text('绑定 PC'),
          ),
          const Divider(height: 32),
          const Text('已绑定 PC', style: TextStyle(fontWeight: FontWeight.bold)),
          bindingsAsync.when(
            data: (bindings) {
              final active = bindings.where((b) => b.isActive).toList();
              if (active.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('暂无绑定，请在 Desktop 生成配对码'),
                );
              }
              final presence = presenceAsync.valueOrNull ?? [];
              final onlineIds = presence.where((d) => d.online).map((d) => d.id).toSet();
              return Column(
                children: active.map((binding) {
                  final online = onlineIds.contains(binding.desktopDeviceId);
                  final device = presence
                      .where((d) => d.id == binding.desktopDeviceId)
                      .firstOrNull;
                  final name = device?.name ?? binding.desktopDeviceId;
                  return RadioListTile<String>(
                    value: binding.desktopDeviceId,
                    groupValue: selectedDesktop,
                    onChanged: (value) async {
                      ref.read(selectedDesktopIdProvider.notifier).state = value;
                      await ref.read(ecoCenterClientProvider).setSelectedDesktop(value);
                    },
                    title: Text(name),
                    subtitle: Text(online ? '在线' : '离线'),
                    secondary: Icon(
                      online ? Icons.circle : Icons.circle_outlined,
                      color: online ? Colors.green : Colors.grey,
                      size: 12,
                    ),
                  );
                }).toList(),
              );
            },
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => Text(error.toString()),
          ),
          if (_message != null) ...[
            const SizedBox(height: 16),
            Text(_message!, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
          ],
        ],
      ),
    );
  }

  String _connectionLabel(EcoConnectionState state) {
    switch (state) {
      case EcoConnectionState.connected:
        return '已连接';
      case EcoConnectionState.connecting:
        return '连接中';
      case EcoConnectionState.error:
        return '连接错误';
      case EcoConnectionState.disconnected:
        return '未连接';
    }
  }
}
