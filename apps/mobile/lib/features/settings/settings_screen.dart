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
import '../../core/widgets/shell_toolbar_actions.dart';
import '../threads/thread_providers.dart';

const settingsFontScale = 1.2;

TextStyle? _scaledSettingsTextStyle(TextStyle? style) {
  if (style == null) return null;
  final fontSize = style.fontSize;
  if (fontSize == null) return style;
  return style.copyWith(fontSize: fontSize * settingsFontScale);
}

ThemeData _settingsTheme(BuildContext context) {
  final base = Theme.of(context);
  return base.copyWith(
    textTheme: base.textTheme.apply(fontSizeFactor: settingsFontScale),
    appBarTheme: base.appBarTheme.copyWith(
      titleTextStyle: _scaledSettingsTextStyle(base.appBarTheme.titleTextStyle),
    ),
  );
}

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

    return Theme(
      data: _settingsTheme(context),
      child: Scaffold(
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
                  padding: EdgeInsets.fromLTRB(
                    20,
                    8,
                    20,
                    adaptiveNavOverlayInset(context),
                  ),
                  children: [
                    _AccountHeader(
                      email: creds.userEmail ?? '未登录',
                      subtitle: creds.userDisplayName ??
                          creds.deviceName ??
                          (signedIn ? null : '请先完成 PC 连接'),
                      signedIn: signedIn,
                    ),
                    const SizedBox(height: 32),
                    _SettingsSection(
                      label: '外观',
                      child: _ThemePreferenceSelector(
                        selected: ref.watch(appThemePreferenceProvider),
                        onChanged: (preference) {
                          ref
                              .read(appThemePreferenceProvider.notifier)
                              .setPreference(preference);
                        },
                      ),
                    ),
                    const SizedBox(height: 32),
                    _SettingsSection(
                      label: '默认模式',
                      caption: '新建会话时的 Composer 模式',
                      child: Column(
                        children: [
                          for (var i = 0; i < sessionModeUiOptions.length; i++) ...[
                            if (i > 0) const SizedBox(height: 4),
                            _SessionModeOption(
                              option: sessionModeUiOptions[i],
                              selected:
                                  _sessionMode == sessionModeUiOptions[i].value,
                              onTap: () => _saveSessionMode(
                                sessionModeUiOptions[i].value,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (signedIn) ...[
                      const SizedBox(height: 32),
                      _SettingsSection(
                        label: '账户',
                        child: Column(
                          children: [
                            _SettingsActionRow(
                              icon: EcoIcons.desktop,
                              title: '切换 PC',
                              subtitle: '选择或绑定其他 Desktop 设备',
                              onTap: () => context.push('/connect'),
                            ),
                            _SettingsDivider(),
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
                  ],
                );
              },
              loading: () => const Center(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              error: (error, _) => Center(child: Text(error.toString())),
            ),
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
    return Row(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: eco.composerPillBg,
            border: Border.all(
              color: eco.borderSubtle.withValues(alpha: 0.7),
            ),
          ),
          child: SizedBox(
            width: 48,
            height: 48,
            child: Center(
              child: Text(
                _initials(),
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w500,
                      color: eco.textSecondary,
                      letterSpacing: -0.2,
                    ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                email,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w500,
                      letterSpacing: -0.2,
                    ),
              ),
              if (subtitle != null && subtitle!.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted.withValues(alpha: 0.85),
                      ),
                ),
              ] else if (!signedIn) ...[
                const SizedBox(height: 3),
                Text(
                  '请先完成 PC 连接',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted.withValues(alpha: 0.85),
                      ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsSection extends StatelessWidget {
  const _SettingsSection({
    required this.label,
    this.caption,
    required this.child,
  });

  final String label;
  final String? caption;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: eco.textMuted.withValues(alpha: 0.9),
                letterSpacing: 0.6,
                fontWeight: FontWeight.w500,
              ),
        ),
        if (caption != null) ...[
          const SizedBox(height: 4),
          Text(
            caption!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted.withValues(alpha: 0.75),
                  height: 1.4,
                ),
          ),
        ],
        const SizedBox(height: 12),
        child,
      ],
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
    return Row(
      children: [
        for (var i = 0; i < AppThemePreference.values.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(
            child: _ThemePill(
              label: AppThemePreference.values[i].label,
              selected: selected == AppThemePreference.values[i],
              onTap: () => onChanged(AppThemePreference.values[i]),
            ),
          ),
        ],
      ],
    );
  }
}

class _ThemePill extends StatelessWidget {
  const _ThemePill({
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
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        splashColor: eco.navHover,
        highlightColor: eco.navHover,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(vertical: 10),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            color: selected ? eco.navActive : Colors.transparent,
            border: Border.all(
              color: selected
                  ? eco.borderStrong.withValues(alpha: 0.8)
                  : eco.borderSubtle.withValues(alpha: 0.65),
            ),
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
                  color: selected ? eco.textPrimary : eco.textMuted,
                  letterSpacing: -0.1,
                ),
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
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        splashColor: eco.navHover,
        highlightColor: eco.navHover,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            color: selected ? eco.navActive : Colors.transparent,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Icon(
                _iconForMode(option.value),
                size: 17,
                color: selected
                    ? eco.textSecondary
                    : eco.textMuted.withValues(alpha: 0.75),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      option.title,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight:
                                selected ? FontWeight.w500 : FontWeight.w400,
                            letterSpacing: -0.1,
                          ),
                    ),
                    const SizedBox(height: 2),
                    SizedBox(
                      width: double.infinity,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          option.description,
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                color:
                                    eco.textMuted.withValues(alpha: 0.85),
                                fontSize: 11,
                                height: 1.2,
                                letterSpacing: -0.1,
                              ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 8),
                Icon(
                  EcoIcons.check,
                  size: 16,
                  color: eco.textSecondary,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SettingsDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      color: ecoColors(context).borderSubtle.withValues(alpha: 0.45),
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

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        splashColor: eco.navHover,
        highlightColor: eco.navHover,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              Icon(
                icon,
                size: 18,
                color: destructive
                    ? eco.danger.withValues(alpha: 0.85)
                    : eco.textMuted.withValues(alpha: 0.8),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: color,
                            fontWeight: FontWeight.w400,
                            letterSpacing: -0.1,
                          ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: eco.textMuted.withValues(alpha: 0.85),
                            ),
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                EcoIcons.chevronRight,
                size: 15,
                color: eco.textMuted.withValues(alpha: 0.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
