import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/preferences/thinking_display_preferences.dart';
import '../../core/providers/thinking_display_provider.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/eco_grouped_list.dart';
import 'settings_disclosure_row.dart';

class SettingsThinkingContentPage extends ConsumerWidget {
  const SettingsThinkingContentPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final selected = ref.watch(thinkingDisplayModeProvider);
    final options = [
      (
        mode: ThinkingDisplayMode.ephemeral,
        title: l10n.settingsThinkingContentEphemeral,
        subtitle: l10n.settingsThinkingContentEphemeralHint,
        icon: EcoIcons.sparkles,
      ),
      (
        mode: ThinkingDisplayMode.collapsed,
        title: l10n.settingsThinkingContentCollapsed,
        subtitle: l10n.settingsThinkingContentCollapsedHint,
        icon: EcoIcons.expandDown,
      ),
      (
        mode: ThinkingDisplayMode.expanded,
        title: l10n.settingsThinkingContentExpanded,
        subtitle: l10n.settingsThinkingContentExpandedHint,
        icon: EcoIcons.expandUp,
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsThinkingContent)),
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
                    subtitle: options[i].subtitle,
                    icon: options[i].icon,
                    selected: selected == options[i].mode,
                    onTap: () {
                      ref
                          .read(thinkingDisplayModeProvider.notifier)
                          .setMode(options[i].mode);
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
