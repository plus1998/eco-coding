import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants/session_mode.dart';
import '../../core/constants/session_mode_ui.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_theme_provider.dart';
import '../../core/theme/app_theme_preference.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/adaptive_nav_bar.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/shell_toolbar_actions.dart';
import '../threads/thread_providers.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  SessionMode _sessionMode = 'agent';
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
        _sessionMode = workflow?.sessionMode ?? 'agent';
        _loading = false;
      });
    }
  }

  Future<void> _saveSessionMode(SessionMode nextMode) async {
    setState(() => _sessionMode = nextMode);
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    try {
      final workflow = await ref.read(workflowSettingsProvider.future);
      await rpc.saveWorkflowSettings(
        WorkflowSettingsSnapshot(
          sessionMode: nextMode,
          mcpServersEnabled: workflow?.mcpServersEnabled,
        ),
      );
      ref.invalidate(workflowSettingsProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final credentials = ref.watch(credentialsProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('设置'),
        actions: const [
          ShellToolbarActions(),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : credentials.when(
              data: (creds) {
                final signedIn =
                    creds.hasUserSession || creds.isProvisioned;
                return ListView(
                  padding: EdgeInsets.only(
                    bottom: adaptiveNavOverlayInset(context) + 24,
                  ),
                  children: [
                    const SizedBox(height: 8),
                    _AccountHeader(
                      email: creds.userEmail ?? '未登录',
                      subtitle: creds.userDisplayName ??
                          creds.deviceName ??
                          (signedIn ? null : '请先完成 PC 连接'),
                      signedIn: signedIn,
                    ),
                    EcoGroupedSection(
                      label: '外观',
                      topSpacing: 28,
                      child: _ThemePreferenceSelector(
                        selected: ref.watch(appThemePreferenceProvider),
                        onChanged: (preference) {
                          ref
                              .read(appThemePreferenceProvider.notifier)
                              .setPreference(preference);
                        },
                      ),
                    ),
                    EcoGroupedSection(
                      label: '默认模式',
                      caption: '新建会话时的 Composer 模式',
                      topSpacing: 28,
                      child: Column(
                        children: [
                          for (var i = 0;
                              i < sessionModeUiOptions.length;
                              i++) ...[
                            if (i > 0) const EcoGroupedDivider(indent: 52),
                            _SessionModeOption(
                              option: sessionModeUiOptions[i],
                              selected: _sessionMode ==
                                  sessionModeUiOptions[i].value,
                              onTap: () => _saveSessionMode(
                                sessionModeUiOptions[i].value,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (signedIn)
                      EcoGroupedSection(
                        label: '账户',
                        topSpacing: 28,
                        child: Column(
                          children: [
                            _SettingsActionRow(
                              icon: EcoIcons.desktop,
                              title: '切换 PC',
                              subtitle: '选择或绑定其他 Desktop 设备',
                              onTap: () => context.push('/connect'),
                            ),
                            const EcoGroupedDivider(indent: 52),
                            _SettingsActionRow(
                              icon: EcoIcons.logout,
                              title: '退出登录',
                              destructive: true,
                              onTap: () async {
                                final client =
                                    ref.read(ecoCenterClientProvider);
                                final notice = await client.clearSession();
                                ref.invalidate(credentialsProvider);
                                ref.invalidate(bindingsProvider);
                                ref.invalidate(desktopPresenceProvider);
                                ref
                                    .read(selectedDesktopIdProvider.notifier)
                                    .state = null;
                                if (context.mounted) {
                                  context.go('/connect');
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(notice ?? '已退出登录'),
                                    ),
                                  );
                                }
                              },
                            ),
                          ],
                        ),
                      ),
                  ],
                );
              },
              loading: () => const Center(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              error: (error, _) => Center(child: Text(error.toString())),
            ),
    );
  }
}

class _AccountHeader extends StatelessWidget {
  const _AccountHeader({
    required this.email,
    this.subtitle,
    required this.signedIn,
  });

  final String email;
  final String? subtitle;
  final bool signedIn;

  String _initials() {
    final source = (subtitle?.trim().isNotEmpty == true ? subtitle! : email)
        .trim();
    if (source.isEmpty || source == '未登录') return '?';
    final parts = source.split(RegExp(r'\s+'));
    if (parts.length >= 2) {
      return '${parts.first[0]}${parts[1][0]}'.toUpperCase();
    }
    return source[0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: eco.composerPillBg,
            ),
            child: SizedBox(
              width: 64,
              height: 64,
              child: Center(
                child: Text(
                  _initials(),
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w500,
                        color: eco.textSecondary,
                        letterSpacing: -0.3,
                      ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                        ),
                  ),
                ] else if (!signedIn) ...[
                  const SizedBox(height: 4),
                  Text(
                    '请先完成 PC 连接',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                        ),
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

class _ThemePreferenceSelector extends StatelessWidget {
  const _ThemePreferenceSelector({
    required this.selected,
    required this.onChanged,
  });

  final AppThemePreference selected;
  final ValueChanged<AppThemePreference> onChanged;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.all(4),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: eco.composerPillBg,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Row(
            children: [
              for (final preference in AppThemePreference.values)
                Expanded(
                  child: _ThemeSegment(
                    label: preference.label,
                    selected: selected == preference,
                    onTap: () => onChanged(preference),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThemeSegment extends StatelessWidget {
  const _ThemeSegment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(vertical: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: selected ? eco.cardSurface : Colors.transparent,
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: eco.shadowScrim.withValues(alpha: 0.08),
                    blurRadius: 8,
                    offset: const Offset(0, 1),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                color: selected ? eco.textPrimary : eco.textMuted,
                letterSpacing: -0.1,
              ),
        ),
      ),
    );
  }
}

class _SessionModeOption extends StatelessWidget {
  const _SessionModeOption({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final SessionModeUiOption option;
  final bool selected;
  final VoidCallback onTap;

  IconData _iconForMode(SessionMode mode) {
    return switch (mode) {
      'plan' => EcoIcons.planMode,
      'ask' => EcoIcons.askMode,
      _ => EcoIcons.agentMode,
    };
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: onTap,
      highlighted: selected,
      padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
      child: Row(
        children: [
          Icon(
            _iconForMode(option.value),
            size: 22,
            color: selected ? eco.accent : eco.textMuted,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  option.title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                        fontSize: 17,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  option.description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted,
                        fontSize: 13,
                      ),
                ),
              ],
            ),
          ),
          if (selected) ...[
            const SizedBox(width: 8),
            Icon(EcoIcons.check, size: 18, color: eco.accent),
          ],
        ],
      ),
    );
  }
}

class _SettingsActionRow extends StatelessWidget {
  const _SettingsActionRow({
    required this.icon,
    required this.title,
    this.subtitle,
    this.destructive = false,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool destructive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final color = destructive ? eco.danger : eco.textPrimary;

    return EcoGroupedTile(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(
        children: [
          Icon(
            icon,
            size: 22,
            color: destructive ? eco.danger : eco.accent,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: color,
                        fontSize: 17,
                      ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                        ),
                  ),
                ],
              ],
            ),
          ),
          if (!destructive)
            Icon(
              EcoIcons.chevronRight,
              size: 18,
              color: eco.textMuted.withValues(alpha: 0.45),
            ),
        ],
      ),
    );
  }
}
