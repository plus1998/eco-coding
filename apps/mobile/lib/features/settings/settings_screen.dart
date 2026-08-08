import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants/session_mode_ui.dart';
import '../../core/locale/app_locale_preference.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/locale/app_error_localizations.dart';
import '../../core/models/thread_models.dart';
import '../../core/providers/app_locale_provider.dart';
import '../../core/providers/app_providers.dart';
import '../../core/providers/app_theme_provider.dart';
import '../../core/theme/app_theme_preference.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/model_id.dart';
import '../../core/widgets/adaptive_nav_bar.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/shell_toolbar_actions.dart';
import '../threads/thread_providers.dart';
import '../threads/thread_session_app_bar.dart';
import 'settings_disclosure_row.dart';
import 'settings_labels.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final credentials = ref.watch(credentialsProvider);
    final l10n = context.l10n;
    final themePreference = ref.watch(appThemePreferenceProvider);
    final localePreference = ref.watch(appLocalePreferenceProvider);
    final workflow = ref.watch(workflowSettingsProvider).valueOrNull;
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;

    final themeValue = switch (themePreference) {
      AppThemePreference.system => l10n.settingsThemeSystem,
      AppThemePreference.dark => l10n.settingsThemeDark,
      AppThemePreference.light => l10n.settingsThemeLight,
    };
    final languageValue = switch (localePreference) {
      AppLocalePreference.system => l10n.settingsLanguageSystem,
      AppLocalePreference.zhCN => l10n.settingsLanguageChinese,
      AppLocalePreference.enUS => l10n.settingsLanguageEnglish,
    };
    final sessionMode = workflow?.sessionMode ?? 'agent';
    final modeValue = sessionModeUi(sessionMode, l10n).title;
    final contextLimit =
        workflow?.contextWindowLimitTokens ?? defaultContextWindowLimitTokens;
    final contextValue = contextWindowLimitLabel(contextLimit);

    final selection = workflow?.defaultOrchestrationSelection;
    final mainAgentId = selection?.mainAgentConfigId.trim() ?? '';
    final mainAgentName = modelSettings?.mainAgentConfigs
        .where((config) => config.id == mainAgentId)
        .map((config) => config.name)
        .firstOrNull;
    final orchestrationValue = (mainAgentName == null || mainAgentName.isEmpty)
        ? l10n.commonNotConfigured
        : mainAgentName;

    final auxiliaryModel = workflow?.defaultAuxiliaryModel;
    final modelsValue = auxiliaryModel == null
        ? l10n.commonNotConfigured
        : shortenModelId(auxiliaryModel.modelId);

    final frostCanvas = ecoColors(context).bgMain;

    return Scaffold(
      backgroundColor: Colors.transparent,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        forceMaterialTransparency: true,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        title: Text(l10n.settingsTitle),
        actions: const [ShellToolbarActions()],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          credentials.when(
            data: (creds) {
              final signedIn = creds.hasUserSession || creds.isProvisioned;
              return ListView(
                // Explicit padding replaces MediaQuery insets — restore AppBar clearance.
                padding: EdgeInsets.only(
                  top: sessionAppBarChromeHeight(context) + 50,
                  bottom: adaptiveNavOverlayInset(context) + 24,
                ),
                children: [
                  _AccountHeader(
                    email: creds.userEmail ?? l10n.settingsNotSignedIn,
                    subtitle:
                        creds.userDisplayName ??
                        creds.deviceName ??
                        (signedIn ? null : l10n.settingsConnectPcFirst),
                    signedIn: signedIn,
                  ),
                  EcoGroupedSection(
                    label: l10n.settingsAppearance,
                    topSpacing: 28,
                    child: Column(
                      children: [
                        SettingsDisclosureRow(
                          title: l10n.settingsTheme,
                          value: themeValue,
                          onTap: () => context.push('/settings/theme'),
                        ),
                        const EcoGroupedDivider(),
                        SettingsDisclosureRow(
                          title: l10n.settingsLanguage,
                          value: languageValue,
                          onTap: () => context.push('/settings/language'),
                        ),
                      ],
                    ),
                  ),
                  EcoGroupedSection(
                    label: l10n.settingsSessionDefaults,
                    topSpacing: 28,
                    child: Column(
                      children: [
                        SettingsDisclosureRow(
                          title: l10n.settingsDefaultMode,
                          value: modeValue,
                          onTap: () => context.push('/settings/default-mode'),
                        ),
                        const EcoGroupedDivider(),
                        SettingsDisclosureRow(
                          title: l10n.settingsContextWindow,
                          value: contextValue,
                          onTap: () => context.push('/settings/context-window'),
                        ),
                        const EcoGroupedDivider(),
                        SettingsDisclosureRow(
                          title: l10n.composerOrchestration,
                          value: orchestrationValue,
                          onTap: () => context.push('/settings/orchestration'),
                        ),
                        const EcoGroupedDivider(),
                        SettingsDisclosureRow(
                          title: l10n.settingsModels,
                          value: modelsValue,
                          onTap: () => context.push('/settings/models'),
                        ),
                      ],
                    ),
                  ),
                  if (signedIn)
                    EcoGroupedSection(
                      label: l10n.settingsAccount,
                      topSpacing: 28,
                      child: Column(
                        children: [
                          SettingsDisclosureRow(
                            icon: EcoIcons.desktop,
                            title: l10n.settingsSwitchPc,
                            subtitle: l10n.settingsSwitchPcSubtitle,
                            onTap: () => context.push('/connect'),
                          ),
                          const EcoGroupedDivider(indent: 52),
                          SettingsDisclosureRow(
                            icon: EcoIcons.logout,
                            title: l10n.settingsSignOut,
                            destructive: true,
                            onTap: () async {
                              final client = ref.read(ecoCenterClientProvider);
                              final notice = await client.clearSession();
                              ref.invalidate(credentialsProvider);
                              ref.invalidate(bindingsProvider);
                              ref.invalidate(desktopPresenceProvider);
                              ref
                                      .read(selectedDesktopIdProvider.notifier)
                                      .state =
                                  null;
                              if (context.mounted) {
                                context.go('/connect');
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      notice == null
                                          ? l10n.settingsSignedOut
                                          : localizedEcoCenterNotice(
                                              notice,
                                              l10n,
                                            ),
                                    ),
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
            loading: () => const SafeArea(
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            ),
            error: (error, _) => SafeArea(
              child: Center(child: Text(error.toString())),
            ),
          ),
          SessionTopFrostOverlay(canvasColor: frostCanvas),
        ],
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
    if (source.isEmpty || !signedIn) return '?';
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
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                  ),
                ] else if (!signedIn) ...[
                  const SizedBox(height: 4),
                  Text(
                    context.l10n.settingsConnectPcFirst,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
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
