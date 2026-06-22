import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../threads/thread_providers.dart';

Future<void> showComposerSettingsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) {
  return showModalBottomSheet<void>(
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
            Text('Composer 设置', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Plan Mode'),
              value: runtimeConfig.planModeEnabled,
              onChanged: (value) => _update(
                ref,
                runtimeConfig.copyWith(planModeEnabled: value),
              ),
            ),
            const SizedBox(height: 8),
            DropdownMenu<String>(
              initialSelection: runtimeConfig.bashReviewMode,
              label: const Text('Bash Review'),
              expandedInsets: EdgeInsets.zero,
              dropdownMenuEntries: const [
                DropdownMenuEntry(value: 'always', label: 'Always'),
                DropdownMenuEntry(value: 'auto', label: 'Auto'),
                DropdownMenuEntry(value: 'allow_all', label: 'Allow all'),
              ],
              onSelected: (value) {
                if (value == null) return;
                _update(ref, runtimeConfig.copyWith(bashReviewMode: value));
              },
            ),
            const SizedBox(height: 12),
            modelSettings.when(
              data: (ModelSettingsSnapshot? settings) {
                final profiles = settings?.orchestrationProfiles ?? [];
                if (profiles.isEmpty) return const SizedBox.shrink();
                return DropdownMenu<String>(
                  initialSelection: runtimeConfig.agentProfileId ??
                      runtimeConfig.routeProfileId,
                  label: const Text('Agent Profile'),
                  expandedInsets: EdgeInsets.zero,
                  dropdownMenuEntries: profiles
                      .map(
                        (profile) => DropdownMenuEntry(
                          value: profile.id,
                          label: profile.name,
                        ),
                      )
                      .toList(),
                  onSelected: (value) {
                    if (value == null) return;
                    _update(
                      ref,
                      ThreadRuntimeConfig(
                        routeProfileId: value,
                        agentProfileId: value,
                        subagentEnabled: runtimeConfig.subagentEnabled,
                        planModeEnabled: runtimeConfig.planModeEnabled,
                        bashReviewMode: runtimeConfig.bashReviewMode,
                      ),
                    );
                  },
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
    ref.read(desktopRpcProvider)?.updateRuntimeConfig(
          threadId: threadId,
          runtimeConfig: config,
        );
  }
}

extension on ThreadRuntimeConfig {
  ThreadRuntimeConfig copyWith({
    String? routeProfileId,
    String? agentProfileId,
    Map<String, bool>? subagentEnabled,
    bool? planModeEnabled,
    String? bashReviewMode,
  }) {
    return ThreadRuntimeConfig(
      routeProfileId: routeProfileId ?? this.routeProfileId,
      agentProfileId: agentProfileId ?? this.agentProfileId,
      subagentEnabled: subagentEnabled ?? this.subagentEnabled,
      planModeEnabled: planModeEnabled ?? this.planModeEnabled,
      bashReviewMode: bashReviewMode ?? this.bashReviewMode,
    );
  }
}
