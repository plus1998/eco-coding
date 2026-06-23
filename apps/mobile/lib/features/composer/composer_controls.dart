import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/bash_review_ui.dart';
import '../../core/constants/plan_mode_ui.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/model_id.dart';
import '../../core/utils/thread_usage_display.dart';
import '../threads/thread_info_sheets.dart';
import '../threads/thread_providers.dart';
import 'composer_context_ring.dart';

const _subagentRoleLabels = {
  'explore': 'Explore',
  'architect': 'Architect',
  'coder': 'Coder',
  'reviewer': 'Reviewer',
  'tester': 'Tester',
};

extension ThreadRuntimeConfigCopy on ThreadRuntimeConfig {
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

void persistRuntimeConfig(
  WidgetRef ref, {
  required String threadId,
  required ThreadRuntimeConfigInput config,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) {
  onChanged(config);
  if (threadId.isEmpty) return;
  ref
      .read(desktopRpcProvider)
      ?.updateRuntimeConfig(threadId: threadId, runtimeConfig: config);
}

ThreadRuntimeConfigInput watchedComposerRuntimeConfig(
  WidgetRef ref,
  ThreadRuntimeConfigInput fallback,
) {
  return ref.watch(runtimeConfigProvider) ?? fallback;
}

class _ComposerSubagentSwitchList extends ConsumerWidget {
  const _ComposerSubagentSwitchList({
    required this.fallbackConfig,
    required this.threadId,
    required this.profile,
    required this.canEdit,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput fallbackConfig;
  final String threadId;
  final OrchestrationProfile? profile;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtimeConfig = watchedComposerRuntimeConfig(ref, fallbackConfig);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: configuredOrchestrationSubagentRoles(profile).map((role) {
        final enabled = isRuntimeSubagentEnabled(
          runtimeConfig.subagentEnabled,
          role,
        );
        final isExplore = role == 'explore';
        final toggleable = canEdit && isSubagentToggleable(profile, role);
        final configured = isSubagentConfiguredInProfile(profile, role);
        return SwitchListTile(
          title: Text(_subagentRoleLabels[role] ?? role),
          subtitle: Text(
            isExplore
                ? '始终启用'
                : !configured
                ? 'Profile 未配置'
                : enabled
                ? '已启用'
                : '已停用',
          ),
          value: isExplore ? true : enabled,
          onChanged: !toggleable
              ? null
              : (value) {
                  final next = Map<String, bool>.from(
                    normalizedRuntimeSubagentEnabled(
                      runtimeConfig.subagentEnabled,
                    ),
                  );
                  next[role] = value;
                  persistRuntimeConfig(
                    ref,
                    threadId: threadId,
                    config: runtimeConfig.copyWith(subagentEnabled: next),
                    onChanged: onChanged,
                  );
                },
        );
      }).toList(),
    );
  }
}

class ComposerRouteSheet extends ConsumerWidget {
  const ComposerRouteSheet({
    super.key,
    required this.fallbackConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput fallbackConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtimeConfig = watchedComposerRuntimeConfig(ref, fallbackConfig);
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final profiles = modelSettings?.orchestrationProfiles ?? [];
    final selectedId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;
    final profile = resolveThreadAgentProfile(modelSettings, runtimeConfig);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SheetHeader(title: '方案与编排'),
            if (profiles.isNotEmpty)
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: profiles.length,
                  itemBuilder: (context, index) {
                    final entry = profiles[index];
                    final isActive = entry.id == selectedId;
                    return ListTile(
                      title: Text(entry.name),
                      trailing: isActive
                          ? Icon(EcoIcons.check, color: ecoColors(context).accentText)
                          : null,
                      selected: isActive,
                      enabled: canEdit,
                      onTap: !canEdit
                          ? null
                          : () {
                              persistRuntimeConfig(
                                ref,
                                threadId: threadId,
                                config: ThreadRuntimeConfig(
                                  routeProfileId: entry.id,
                                  agentProfileId: entry.id,
                                  subagentEnabled:
                                      deriveSubagentEnabledFromProfile(
                                        entry,
                                        existing: runtimeConfig.subagentEnabled,
                                      ),
                                  planModeEnabled:
                                      runtimeConfig.planModeEnabled,
                                  bashReviewMode: runtimeConfig.bashReviewMode,
                                ),
                                onChanged: onChanged,
                              );
                              Navigator.pop(context);
                            },
                    );
                  },
                ),
              ),
            const Divider(height: 1),
            _ComposerSubagentSwitchList(
              fallbackConfig: fallbackConfig,
              threadId: threadId,
              profile: profile,
              canEdit: canEdit,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }
}

class ComposerContextTrigger extends StatelessWidget {
  const ComposerContextTrigger({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.enabled = true,
    this.compact = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool enabled;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final child = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 8 : 10,
            vertical: 6,
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 15,
                color: enabled ? ecoColors(context).textSecondary : ecoColors(context).textMuted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: enabled ? ecoColors(context).textPrimary : ecoColors(context).textMuted,
                    fontWeight: FontWeight.w500,
                    fontSize: 12,
                  ),
                ),
              ),
              if (enabled && onTap != null)
                Icon(EcoIcons.expandDown, size: 14, color: ecoColors(context).textMuted),
            ],
          ),
        ),
      ),
    );

    if (compact) return child;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).composerPillBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: ecoColors(context).composerPillBorder),
      ),
      child: child,
    );
  }
}

class ComposerToolbarTrigger extends StatelessWidget {
  const ComposerToolbarTrigger({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: 15,
                color: enabled ? ecoColors(context).textSecondary : ecoColors(context).textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: enabled ? ecoColors(context).textPrimary : ecoColors(context).textMuted,
                  fontWeight: FontWeight.w500,
                  fontSize: 12,
                ),
              ),
              if (enabled && onTap != null) ...[
                const SizedBox(width: 2),
                Icon(EcoIcons.expandDown, size: 14, color: ecoColors(context).textMuted),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class ComposerProfileControl extends ConsumerWidget {
  const ComposerProfileControl({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    this.compact = true,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelSettings = ref.watch(modelSettingsProvider);
    final profileId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;

    final label = modelSettings.maybeWhen(
      data: (settings) {
        for (final profile in settings?.orchestrationProfiles ?? []) {
          if (profile.id == profileId) return profile.name;
        }
        return profileId.isEmpty ? '选择方案' : profileId;
      },
      orElse: () => profileId.isEmpty ? '选择方案' : profileId,
    );

    return ComposerContextTrigger(
      icon: EcoIcons.profile,
      label: label,
      enabled: canEdit,
      compact: compact,
      onTap: canEdit
          ? () => _showProfileSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              onChanged: onChanged,
            )
          : null,
    );
  }

  Future<void> _showProfileSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    final settings = await ref.read(modelSettingsProvider.future);
    final profiles = settings?.orchestrationProfiles ?? [];
    if (profiles.isEmpty || !context.mounted) return;

    final selectedId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _SheetHeader(title: '选择智能体配置'),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: profiles.length,
                itemBuilder: (context, index) {
                  final profile = profiles[index];
                  final isActive = profile.id == selectedId;
                  return ListTile(
                    title: Text(profile.name),
                    trailing: isActive
                        ? Icon(EcoIcons.check, color: ecoColors(context).accentText)
                        : null,
                    selected: isActive,
                    onTap: () {
                      persistRuntimeConfig(
                        ref,
                        threadId: threadId,
                        config: ThreadRuntimeConfig(
                          routeProfileId: profile.id,
                          agentProfileId: profile.id,
                          subagentEnabled: deriveSubagentEnabledFromProfile(
                            profile,
                            existing: runtimeConfig.subagentEnabled,
                          ),
                          planModeEnabled: runtimeConfig.planModeEnabled,
                          bashReviewMode: runtimeConfig.bashReviewMode,
                        ),
                        onChanged: onChanged,
                      );
                      Navigator.pop(context);
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ComposerOrchestrationControl extends ConsumerWidget {
  const ComposerOrchestrationControl({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    this.compact = true,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final profile = resolveThreadAgentProfile(modelSettings, runtimeConfig);
    final enabledCount = countEnabledSubagents(runtimeConfig.subagentEnabled);
    final totalCount = countConfiguredSubagents(profile);
    final summary = totalCount > 0
        ? '$enabledCount/$totalCount'
        : '$enabledCount';

    return ComposerContextTrigger(
      icon: EcoIcons.subagents,
      label: compact ? summary : '编排 $summary',
      enabled: canEdit,
      compact: compact,
      onTap: canEdit
          ? () => _showOrchestrationSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              profile: profile,
              onChanged: onChanged,
            )
          : null,
    );
  }

  Future<void> _showOrchestrationSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required OrchestrationProfile? profile,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _SheetHeader(title: '子代理编排'),
              ListTile(
                title: const Text('主 Agent'),
                subtitle: const Text('始终启用'),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: ecoColors(context).statusAllowBg,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: ecoColors(context).statusAllowBorder),
                  ),
                  child: Text(
                    '启用',
                    style: TextStyle(
                      color: ecoColors(context).statusAllowText,
                      fontSize: 11,
                    ),
                  ),
                ),
              ),
              _ComposerSubagentSwitchList(
                fallbackConfig: runtimeConfig,
                threadId: threadId,
                profile: profile,
                canEdit: canEdit,
                onChanged: onChanged,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ComposerPlanModeControl extends ConsumerWidget {
  const ComposerPlanModeControl({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = planModeUi(runtimeConfig.planModeEnabled);
    return ComposerToolbarTrigger(
      icon: planModeIcon(runtimeConfig.planModeEnabled),
      label: current.title,
      enabled: canEdit,
      onTap: canEdit
          ? () => showComposerPlanModeSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              onChanged: onChanged,
            )
          : null,
    );
  }
}

class ComposerPlanModeIconButton extends ConsumerWidget {
  const ComposerPlanModeIconButton({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final planModeEnabled = runtimeConfig.planModeEnabled;
    final current = planModeUi(planModeEnabled);

    return IconButton(
      onPressed: !canEdit
          ? null
          : () => showComposerPlanModeSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              onChanged: onChanged,
            ),
      tooltip: current.title,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      icon: Icon(
        planModeIcon(planModeEnabled),
        size: 22,
        color: planModeEnabled ? ecoColors(context).accent : ecoColors(context).textSecondary,
      ),
    );
  }
}

IconData planModeIcon(bool planModeEnabled) {
  return planModeEnabled ? EcoIcons.planMode : EcoIcons.agentMode;
}

Future<void> showComposerPlanModeSheet(
  BuildContext context,
  WidgetRef ref, {
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SheetHeader(title: '想以何种方式工作？'),
          ...planModeUiOptions.map((option) {
            final isActive = option.value == runtimeConfig.planModeEnabled;
            return ListTile(
              leading: Icon(
                planModeIcon(option.value),
                size: 20,
                color: ecoColors(context).textSecondary,
              ),
              title: Text(option.title),
              subtitle: Text(option.description),
              trailing: isActive
                  ? Icon(EcoIcons.check, color: ecoColors(context).accentText)
                  : null,
              selected: isActive,
              onTap: () {
                persistRuntimeConfig(
                  ref,
                  threadId: threadId,
                  config: runtimeConfig.copyWith(planModeEnabled: option.value),
                  onChanged: onChanged,
                );
                Navigator.pop(context);
              },
            );
          }),
        ],
      ),
    ),
  );
}

class ComposerRouteSummary extends ConsumerWidget {
  const ComposerRouteSummary({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    this.contextSnapshot,
    this.threadStatus,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelSettings = ref.watch(modelSettingsProvider);
    final profileId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;
    final agentProfile = resolveThreadAgentProfile(
      modelSettings.valueOrNull,
      runtimeConfig,
    );
    final profileLabel = modelSettings.maybeWhen(
      data: (settings) {
        for (final profile in settings?.orchestrationProfiles ?? []) {
          if (profile.id == profileId) return profile.name;
        }
        return profileId.isEmpty ? '选择方案' : profileId;
      },
      orElse: () => profileId.isEmpty ? '选择方案' : profileId,
    );
    final plannerContext = contextSnapshot == null
        ? null
        : resolvePlannerContext(contextSnapshot!);
    final modelId = plannerContext?.modelId ?? contextSnapshot?.modelId;
    final modelLabel = modelId == null || modelId.trim().isEmpty
        ? null
        : shortenModelId(modelId);
    final occupancyPct = resolvePlannerOccupancyPct(contextSnapshot);
    final tooltip = [?modelLabel, profileLabel].whereType<String>().join(' · ');

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (contextSnapshot != null)
          IconButton(
            onPressed: () => showThreadContextSheet(
              context: context,
              contextSnapshot: contextSnapshot,
              threadStatus: threadStatus,
              agentProfile: agentProfile,
            ),
            tooltip: '上下文',
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            icon: ComposerContextRing(pct: occupancyPct ?? 0, size: 22),
          ),
        IconButton(
          onPressed: () => _showRouteSheet(
            context,
            ref,
            runtimeConfig: runtimeConfig,
            threadId: threadId,
            canEdit: canEdit,
            onChanged: onChanged,
          ),
          tooltip: tooltip,
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          icon: Icon(
            EcoIcons.profile,
            size: 22,
            color: ecoColors(context).textSecondary,
          ),
        ),
      ],
    );
  }

  Future<void> _showRouteSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required bool canEdit,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => ComposerRouteSheet(
        fallbackConfig: runtimeConfig,
        threadId: threadId,
        canEdit: canEdit,
        onChanged: onChanged,
      ),
    );
  }
}

class ComposerBashReviewIconButton extends ConsumerWidget {
  const ComposerBashReviewIconButton({
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
    final mode = runtimeConfig.bashReviewMode;
    final accent = mode == 'auto';

    return IconButton(
      onPressed: () => _showBashReviewSheet(
        context,
        ref,
        runtimeConfig: runtimeConfig,
        threadId: threadId,
        onChanged: onChanged,
      ),
      tooltip: bashReviewUi(mode).title,
      visualDensity: VisualDensity.compact,
      icon: _BashReviewShieldIcon(
        mode: mode,
        color: accent ? ecoColors(context).accent : ecoColors(context).textSecondary,
      ),
    );
  }

  Future<void> _showBashReviewSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SheetHeader(title: 'Bash 审批模式'),
            ...bashReviewUiOptions.map((option) {
              final isActive = option.value == runtimeConfig.bashReviewMode;
              return ListTile(
                leading: _BashReviewShieldIcon(
                  mode: option.value,
                  color: ecoColors(context).textSecondary,
                  size: 20,
                ),
                title: Text(option.title),
                subtitle: Text(option.description),
                trailing: isActive
                    ? Icon(EcoIcons.check, color: ecoColors(context).accentText)
                    : null,
                selected: isActive,
                onTap: () {
                  persistRuntimeConfig(
                    ref,
                    threadId: threadId,
                    config: runtimeConfig.copyWith(
                      bashReviewMode: option.value,
                    ),
                    onChanged: onChanged,
                  );
                  Navigator.pop(context);
                },
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _BashReviewShieldIcon extends StatelessWidget {
  const _BashReviewShieldIcon({
    required this.mode,
    required this.color,
    this.size = 22,
  });

  final String mode;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final icon = switch (mode) {
      'auto' => EcoIcons.shieldAuto,
      'allow_all' => EcoIcons.shieldAllowAll,
      _ => EcoIcons.shieldManual,
    };

    if (mode != 'auto') {
      return Icon(icon, size: size, color: color);
    }

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Icon(EcoIcons.shieldAuto, size: size, color: color),
          Positioned(
            bottom: size * 0.18,
            child: Icon(EcoIcons.terminal, size: size * 0.38, color: color),
          ),
        ],
      ),
    );
  }
}

class ComposerBashReviewControl extends ConsumerWidget {
  const ComposerBashReviewControl({
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
    final current = bashReviewUi(runtimeConfig.bashReviewMode);
    final icon = switch (runtimeConfig.bashReviewMode) {
      'auto' => EcoIcons.shieldAuto,
      'allow_all' => EcoIcons.shieldAllowAll,
      _ => EcoIcons.shieldManual,
    };

    return ComposerToolbarTrigger(
      icon: icon,
      label: current.title,
      onTap: () => _showBashReviewSheet(
        context,
        ref,
        runtimeConfig: runtimeConfig,
        threadId: threadId,
        onChanged: onChanged,
      ),
    );
  }

  Future<void> _showBashReviewSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SheetHeader(title: 'Bash 审批模式'),
            ...bashReviewUiOptions.map((option) {
              final isActive = option.value == runtimeConfig.bashReviewMode;
              return ListTile(
                title: Text(option.title),
                subtitle: Text(option.description),
                trailing: isActive
                    ? Icon(EcoIcons.check, color: ecoColors(context).accentText)
                    : null,
                selected: isActive,
                onTap: () {
                  persistRuntimeConfig(
                    ref,
                    threadId: threadId,
                    config: runtimeConfig.copyWith(
                      bashReviewMode: option.value,
                    ),
                    onChanged: onChanged,
                  );
                  Navigator.pop(context);
                },
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        children: [
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: ecoColors(context).borderSubtle,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(title, style: Theme.of(context).textTheme.titleMedium),
          ),
        ],
      ),
    );
  }
}
