import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/providers/app_theme_provider.dart';
import '../../core/theme/app_theme_preference.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/eco_grouped_list.dart';
import 'settings_disclosure_row.dart';

class SettingsThemePage extends ConsumerWidget {
  const SettingsThemePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final selected = ref.watch(appThemePreferenceProvider);
    final options = [
      (
        preference: AppThemePreference.system,
        title: l10n.settingsThemeSystem,
        icon: EcoIcons.themeSystem,
      ),
      (
        preference: AppThemePreference.dark,
        title: l10n.settingsThemeDark,
        icon: EcoIcons.themeDark,
      ),
      (
        preference: AppThemePreference.light,
        title: l10n.settingsThemeLight,
        icon: EcoIcons.themeLight,
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTheme)),
      body: ListView(
        padding: EdgeInsets.only(
          bottom: MediaQuery.paddingOf(context).bottom + 24,
        ),
        children: [
          EcoGroupedSection(
            topSpacing: 28,
            child: Column(
              children: [
                for (var i = 0; i < options.length; i++) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  SettingsRadioOption(
                    title: options[i].title,
                    icon: options[i].icon,
                    selected: selected == options[i].preference,
                    onTap: () {
                      ref
                          .read(appThemePreferenceProvider.notifier)
                          .setPreference(options[i].preference);
                    },
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
