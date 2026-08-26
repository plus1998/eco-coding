import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/bash_review_ui.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../threads/thread_providers.dart';
import 'settings_disclosure_row.dart';
import 'settings_workflow_persistence.dart';

class SettingsDefaultBashReviewPage extends ConsumerStatefulWidget {
  const SettingsDefaultBashReviewPage({super.key});

  @override
  ConsumerState<SettingsDefaultBashReviewPage> createState() =>
      _SettingsDefaultBashReviewPageState();
}

class _SettingsDefaultBashReviewPageState
    extends ConsumerState<SettingsDefaultBashReviewPage> {
  String? _mode;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final workflow = await ref.read(workflowSettingsProvider.future);
    if (!mounted) return;
    setState(
      () => _mode = normalizeBashReviewMode(workflow?.defaultBashReviewMode),
    );
  }

  IconData _iconForMode(String mode) {
    return switch (mode) {
      'auto' => EcoIcons.shieldAuto,
      'allow_all' => EcoIcons.shieldAllowAll,
      _ => EcoIcons.shieldManual,
    };
  }

  Future<bool> _confirmFullAccessIfNeeded(String mode) async {
    if (mode != 'allow_all' || _mode == 'allow_all') {
      return true;
    }
    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.bashReviewAllowAll),
        content: Text(l10n.bashReviewAllowAllConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.commonCancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.bashReviewAllowAll),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final options = bashReviewUiOptions(l10n);
    final selected = _mode;
    final desktopConnected = ref.watch(desktopRpcProvider) != null;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsDefaultBashReviewMode)),
      body: selected == null
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : ListView(
              padding: EdgeInsets.only(
                bottom: MediaQuery.paddingOf(context).bottom + 24,
              ),
              children: [
                EcoGroupedSection(
                  caption: desktopConnected
                      ? l10n.settingsDefaultBashReviewModeCaption
                      : l10n.settingsConnectPcFirst,
                  topSpacing: 28,
                  child: Column(
                    children: [
                      for (var i = 0; i < options.length; i++) ...[
                        if (i > 0) const EcoGroupedDivider(indent: 52),
                        SettingsRadioOption(
                          title: options[i].title,
                          subtitle: options[i].description,
                          icon: _iconForMode(options[i].value),
                          selected: selected == options[i].value,
                          enabled: desktopConnected,
                          onTap: () async {
                            final next = options[i].value;
                            if (next == selected) return;
                            if (!await _confirmFullAccessIfNeeded(next)) {
                              return;
                            }
                            if (!mounted) return;
                            setState(() => _mode = next);
                            await saveSettingsDefaultBashReviewMode(
                              ref,
                              context: context,
                              nextMode: next,
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
