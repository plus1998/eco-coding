import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../composer/composer_controls.dart';
import '../threads/thread_providers.dart';

Future<void> showComposerSettingsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) {
  return showEcoModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => _ComposerSettingsSheet(
      runtimeConfig: runtimeConfig,
      threadId: threadId,
      onChanged: onChanged,
    ),
  );
}

class _ComposerSettingsSheet extends ConsumerWidget {
  const _ComposerSettingsSheet({
    required this.runtimeConfig,
    required this.threadId,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelSettings = ref.watch(modelSettingsProvider);
    final workflow = ref.watch(workflowSettingsProvider).valueOrNull;
    final mcpServers =
        ref.watch(mcpSettingsProvider).valueOrNull?.servers ?? const [];
    final eco = ecoColors(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: eco.borderSubtle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              context.l10n.composerSettings,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(context.l10n.composerPlanMode),
              value: runtimeConfig.sessionMode == 'plan',
              onChanged: (value) => _update(
                ref,
                runtimeConfig.copyWith(sessionMode: value ? 'plan' : 'agent'),
              ),
            ),
            const SizedBox(height: 8),
            DropdownMenu<String>(
              initialSelection: runtimeConfig.bashReviewMode,
              label: Text(context.l10n.composerBashReview),
              expandedInsets: EdgeInsets.zero,
              dropdownMenuEntries: [
                DropdownMenuEntry(
                  value: 'always',
                  label: context.l10n.bashReviewAlways,
                ),
                DropdownMenuEntry(
                  value: 'auto',
                  label: context.l10n.bashReviewAuto,
                ),
                DropdownMenuEntry(
                  value: 'allow_all',
                  label: context.l10n.bashReviewAllowAll,
                ),
              ],
              onSelected: (value) {
                if (value == null) return;
                _update(ref, runtimeConfig.copyWith(bashReviewMode: value));
              },
            ),
            const SizedBox(height: 12),
            modelSettings.when(
              data: (ModelSettingsSnapshot? settings) {
                if (settings == null || settings.mainAgentConfigs.isEmpty) {
                  return const SizedBox.shrink();
                }
                return OrchestrationCompositionSelectors(
                  settings: settings,
                  runtimeConfig: runtimeConfig,
                  threadId: threadId,
                  canEdit: true,
                  onChanged: onChanged,
                  mcpServers: mcpServers,
                  rememberedMcp: workflow?.mcpServersEnabled,
                );
              },
              loading: () => const LinearProgressIndicator(),
              error: (_, _) => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }

  void _update(WidgetRef ref, ThreadRuntimeConfigInput config) {
    onChanged(config);
    ref
        .read(desktopRpcProvider)
        ?.updateRuntimeConfig(threadId: threadId, runtimeConfig: config);
  }
}
