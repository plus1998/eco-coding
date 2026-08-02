import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_locale_preference.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/providers/app_locale_provider.dart';
import '../../core/widgets/eco_grouped_list.dart';
import 'settings_disclosure_row.dart';

class SettingsLanguagePage extends ConsumerWidget {
  const SettingsLanguagePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final selected = ref.watch(appLocalePreferenceProvider);
    final options = [
      (
        preference: AppLocalePreference.system,
        title: l10n.settingsLanguageSystem,
      ),
      (
        preference: AppLocalePreference.zhCN,
        title: l10n.settingsLanguageChinese,
      ),
      (
        preference: AppLocalePreference.enUS,
        title: l10n.settingsLanguageEnglish,
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsLanguage)),
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
                  if (i > 0) const EcoGroupedDivider(),
                  SettingsRadioOption(
                    title: options[i].title,
                    selected: selected == options[i].preference,
                    onTap: () {
                      ref
                          .read(appLocalePreferenceProvider.notifier)
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
