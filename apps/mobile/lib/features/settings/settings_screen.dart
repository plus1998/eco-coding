import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../threads/thread_providers.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _planModeEnabled = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final workflow = await ref.read(workflowSettingsProvider.future);
    if (mounted) {
      setState(() {
        _planModeEnabled = workflow?.planModeEnabled ?? false;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final credentials = ref.watch(credentialsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                credentials.when(
                  data: (creds) => Card(
                    child: ListTile(
                      title: Text(creds.userEmail ?? '未登录'),
                      subtitle: Text(creds.userDisplayName ?? creds.deviceName ?? ''),
                    ),
                  ),
                  loading: () => const LinearProgressIndicator(),
                  error: (error, _) => Text(error.toString()),
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  title: const Text('全局 Plan Mode'),
                  subtitle: const Text('workflow-settings:save'),
                  value: _planModeEnabled,
                  onChanged: (value) async {
                    setState(() => _planModeEnabled = value);
                    final rpc = ref.read(desktopRpcProvider);
                    if (rpc == null) return;
                    try {
                      await rpc.saveWorkflowSettings(
                        WorkflowSettingsSnapshot(planModeEnabled: value),
                      );
                      ref.invalidate(workflowSettingsProvider);
                    } catch (error) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(error.toString())),
                        );
                      }
                    }
                  },
                ),
                const Divider(height: 32),
                ListTile(
                  title: const Text('退出登录'),
                  leading: const Icon(Icons.logout),
                  onTap: () async {
                    final client = ref.read(ecoCenterClientProvider);
                    client.disconnect();
                    await ref.read(credentialStoreProvider).clearSession();
                    ref.invalidate(credentialsProvider);
                    ref.invalidate(bindingsProvider);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('已退出登录')),
                      );
                    }
                  },
                ),
              ],
            ),
    );
  }
}
