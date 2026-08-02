import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/session_mode.dart';
import '../../core/constants/session_mode_ui.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../threads/thread_providers.dart';
import 'settings_disclosure_row.dart';
import 'settings_workflow_persistence.dart';

class SettingsDefaultModePage extends ConsumerStatefulWidget {
  const SettingsDefaultModePage({super.key});

  @override
  ConsumerState<SettingsDefaultModePage> createState() =>
      _SettingsDefaultModePageState();
}

class _SettingsDefaultModePageState
    extends ConsumerState<SettingsDefaultModePage> {
  SessionMode? _sessionMode;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final workflow = await ref.read(workflowSettingsProvider.future);
    if (!mounted) return;
    setState(() => _sessionMode = workflow?.sessionMode ?? 'agent');
  }

  IconData _iconForMode(SessionMode mode) {
    return switch (mode) {
      'plan' => EcoIcons.planMode,
      'ask' => EcoIcons.askMode,
      _ => EcoIcons.agentMode,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final modeOptions = sessionModeUiOptions(l10n);
    final selected = _sessionMode;
    final desktopConnected = ref.watch(desktopRpcProvider) != null;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsDefaultMode)),
      body: selected == null
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : ListView(
              padding: EdgeInsets.only(
                bottom: MediaQuery.paddingOf(context).bottom + 24,
              ),
              children: [
                EcoGroupedSection(
                  caption: desktopConnected
                      ? l10n.settingsDefaultModeCaption
                      : l10n.settingsConnectPcFirst,
                  topSpacing: 28,
                  child: Column(
                    children: [
                      for (var i = 0; i < modeOptions.length; i++) ...[
                        if (i > 0) const EcoGroupedDivider(indent: 52),
                        SettingsRadioOption(
                          title: modeOptions[i].title,
                          subtitle: modeOptions[i].description,
                          icon: _iconForMode(modeOptions[i].value),
                          selected: selected == modeOptions[i].value,
                          enabled: desktopConnected,
                          onTap: () async {
                            setState(() => _sessionMode = modeOptions[i].value);
                            await saveSettingsSessionMode(
                              ref,
                              context: context,
                              nextMode: modeOptions[i].value,
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
