import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../threads/thread_providers.dart';
import 'settings_disclosure_row.dart';
import 'settings_labels.dart';
import 'settings_workflow_persistence.dart';

class SettingsContextWindowPage extends ConsumerStatefulWidget {
  const SettingsContextWindowPage({super.key});

  @override
  ConsumerState<SettingsContextWindowPage> createState() =>
      _SettingsContextWindowPageState();
}

class _SettingsContextWindowPageState
    extends ConsumerState<SettingsContextWindowPage> {
  int? _contextWindowLimitTokens;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final workflow = await ref.read(workflowSettingsProvider.future);
    if (!mounted) return;
    setState(() {
      _contextWindowLimitTokens =
          workflow?.contextWindowLimitTokens ?? defaultContextWindowLimitTokens;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final selected = _contextWindowLimitTokens;
    final desktopConnected = ref.watch(desktopRpcProvider) != null;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsContextWindow)),
      body: selected == null
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : ListView(
              padding: EdgeInsets.only(
                bottom: MediaQuery.paddingOf(context).bottom + 24,
              ),
              children: [
                EcoGroupedSection(
                  caption: desktopConnected
                      ? l10n.settingsContextWindowCaption
                      : l10n.settingsConnectPcFirst,
                  topSpacing: 28,
                  child: Column(
                    children: [
                      for (
                        var i = 0;
                        i < contextWindowLimitPresets.length;
                        i++
                      ) ...[
                        if (i > 0) const EcoGroupedDivider(indent: 52),
                        SettingsRadioOption(
                          title: contextWindowLimitLabel(
                            contextWindowLimitPresets[i],
                          ),
                          subtitle: l10n.settingsContextWindowTokens(
                            contextWindowLimitPresets[i],
                          ),
                          icon: EcoIcons.contextMemory,
                          selected: selected == contextWindowLimitPresets[i],
                          enabled: desktopConnected,
                          onTap: () async {
                            final previous = selected;
                            await saveSettingsContextWindowLimit(
                              ref,
                              context: context,
                              nextLimit: contextWindowLimitPresets[i],
                              previousLimit: previous,
                              onOptimistic: (value) {
                                setState(
                                  () => _contextWindowLimitTokens = value,
                                );
                              },
                              onRevert: (value) {
                                setState(
                                  () => _contextWindowLimitTokens = value,
                                );
                              },
                            );
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
