import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_theme_provider.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/app_theme_preference.dart';
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
                  data: (creds) {
                    final signedIn =
                        creds.hasUserSession || creds.isProvisioned;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Card(
                          child: ListTile(
                            title: Text(creds.userEmail ?? '未登录'),
                            subtitle: Text(
                              creds.userDisplayName ??
                                  creds.deviceName ??
                                  (signedIn ? '' : '请先完成 PC 连接'),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '外观',
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '与 PC 端使用相同的主题偏好键 eco.app-theme',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                                const SizedBox(height: 8),
                                SegmentedButton<AppThemePreference>(
                                  segments: AppThemePreference.values
                                      .map(
                                        (preference) => ButtonSegment(
                                          value: preference,
                                          label: Text(preference.label),
                                        ),
                                      )
                                      .toList(),
                                  selected: {ref.watch(appThemePreferenceProvider)},
                                  onSelectionChanged: (selection) {
                                    ref
                                        .read(appThemePreferenceProvider.notifier)
                                        .setPreference(selection.first);
                                  },
                                ),
                              ],
                            ),
                          ),
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
                                WorkflowSettingsSnapshot(
                                  planModeEnabled: value,
                                ),
                              );
                              ref.invalidate(workflowSettingsProvider);
                            } catch (error) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(error.toString())),
                                );
                              }
                            }
                          },
                        ),
                        if (signedIn) ...[
                          const Divider(height: 32),
                          ListTile(
                            title: const Text('切换 PC'),
                            subtitle: const Text('选择或绑定其他 Desktop 设备'),
                            leading: const Icon(EcoIcons.desktop),
                            onTap: () => context.push('/connect'),
                          ),
                          ListTile(
                            title: const Text('退出登录'),
                            leading: const Icon(EcoIcons.logout),
                            onTap: () async {
                              final client = ref.read(ecoCenterClientProvider);
                              final notice = await client.clearSession();
                              ref.invalidate(credentialsProvider);
                              ref.invalidate(bindingsProvider);
                              ref.invalidate(desktopPresenceProvider);
                              ref.read(selectedDesktopIdProvider.notifier).state =
                                  null;
                              if (context.mounted) {
                                context.go('/connect');
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(notice ?? '已退出登录')),
                                );
                              }
                            },
                          ),
                        ],
                      ],
                    );
                  },
                  loading: () => const LinearProgressIndicator(),
                  error: (error, _) => Text(error.toString()),
                ),
              ],
            ),
    );
  }
}
