import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/thread_models.dart';
import '../threads/thread_providers.dart';

class ComposerModeBar extends ConsumerWidget {
  const ComposerModeBar({
    super.key,
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

    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHigh,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                FilterChip(
                  label: const Text('Plan Mode'),
                  selected: runtimeConfig.planModeEnabled,
                  onSelected: (value) => _update(
                    ref,
                    runtimeConfig.copyWith(planModeEnabled: value),
                    onChanged,
                  ),
                ),
                DropdownMenu<String>(
                  initialSelection: runtimeConfig.bashReviewMode,
                  label: const Text('Bash Review'),
                  dropdownMenuEntries: const [
                    DropdownMenuEntry(value: 'always', label: 'Always'),
                    DropdownMenuEntry(value: 'auto', label: 'Auto'),
                    DropdownMenuEntry(value: 'allow_all', label: 'Allow all'),
                  ],
                  onSelected: (value) {
                    if (value == null) return;
                    _update(
                      ref,
                      runtimeConfig.copyWith(bashReviewMode: value),
                      onChanged,
                    );
                  },
                ),
              ],
            ),
            modelSettings.when(
              data: (ModelSettingsSnapshot? settings) {
                final profiles = settings?.orchestrationProfiles ?? [];
                if (profiles.isEmpty) {
                  return const SizedBox.shrink();
                }
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
                      onChanged,
                    );
                  },
                );
              },
              loading: () => const LinearProgressIndicator(),
              error: (error, stackTrace) => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }

  void _update(
    WidgetRef ref,
    ThreadRuntimeConfigInput config,
    ValueChanged<ThreadRuntimeConfigInput> onChanged,
  ) {
    onChanged(config);
    final rpc = ref.read(desktopRpcProvider);
    rpc?.updateRuntimeConfig(threadId: threadId, runtimeConfig: config);
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
