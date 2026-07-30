import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
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
    final bashReviewOptions = [
      (value: 'always', label: context.l10n.bashReviewAlways),
      (value: 'auto', label: context.l10n.bashReviewAuto),
      (value: 'allow_all', label: context.l10n.bashReviewAllowAll),
    ];

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 12, 0, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 5,
                decoration: BoxDecoration(
                  color: eco.textMuted.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(2.5),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Center(
                child: Text(
                  context.l10n.composerSettings,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.25,
                  ),
                ),
              ),
            ),
            EcoGroupedSection(
              label: context.l10n.composerPlanMode,
              topSpacing: 20,
              child: EcoSheetSwitchTile(
                title: context.l10n.composerPlanMode,
                value: runtimeConfig.sessionMode == 'plan',
                onChanged: (value) => _update(
                  ref,
                  runtimeConfig.copyWith(sessionMode: value ? 'plan' : 'agent'),
                ),
              ),
            ),
            EcoGroupedSection(
              label: context.l10n.composerBashReview,
              topSpacing: 20,
              child: Column(
                children: [
                  for (var i = 0; i < bashReviewOptions.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 16),
                    EcoSheetOptionTile(
                      title: bashReviewOptions[i].label,
                      selected:
                          runtimeConfig.bashReviewMode ==
                          bashReviewOptions[i].value,
                      onTap: () {
                        final option = bashReviewOptions[i];
                        if (option.value == 'auto' &&
                            runtimeConfig.auxiliaryModel == null) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                context
                                    .l10n
                                    .auxiliaryModelRequiredForAutoReview,
                              ),
                            ),
                          );
                          return;
                        }
                        _update(
                          ref,
                          runtimeConfig.copyWith(bashReviewMode: option.value),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
            modelSettings.when(
              data: (ModelSettingsSnapshot? settings) {
                if (settings == null || settings.mainAgentConfigs.isEmpty) {
                  return const SizedBox.shrink();
                }
                return EcoGroupedSection(
                  label: context.l10n.composerOrchestrationSelection,
                  topSpacing: 20,
                  child: OrchestrationCompositionSelectors(
                    settings: settings,
                    runtimeConfig: runtimeConfig,
                    threadId: threadId,
                    canEdit: true,
                    onChanged: onChanged,
                    workspacePath: '',
                    mcpServers: mcpServers,
                    rememberedMcp: workflow?.mcpServersEnabled,
                  ),
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: LinearProgressIndicator(minHeight: 2),
              ),
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
