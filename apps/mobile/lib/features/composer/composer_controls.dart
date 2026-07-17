import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/constants/bash_review_ui.dart';
import '../../core/constants/session_mode_ui.dart';
import 'composer_toolbar_icon.dart';
import '../../core/models/composer_mcp.dart';
import '../../core/models/skill_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/model_id.dart';
import '../../core/utils/thread_usage_display.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
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

Future<void> persistComposerMcpWorkflowDefaults(
  WidgetRef ref, {
  required Map<String, bool> mcpServersEnabled,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;
  final workflow = await ref.read(workflowSettingsProvider.future);
  if (workflow == null) return;
  await rpc.saveWorkflowSettings(
    WorkflowSettingsSnapshot(
      sessionMode: workflow.sessionMode,
      defaultCoreKind: workflow.defaultCoreKind,
      defaultAgentProfileId: workflow.defaultAgentProfileId,
      mcpServersEnabled: mcpServersEnabled,
    ),
  );
  ref.invalidate(workflowSettingsProvider);
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
    final roles = configuredOrchestrationSubagentRoles(profile);
    if (roles.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Text(
          '当前方案未配置子代理',
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: ecoColors(context).textMuted),
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < roles.length; i++) ...[
          if (i > 0) const EcoGroupedDivider(indent: 16),
          Builder(
            builder: (context) {
              final role = roles[i];
              final enabled = isRuntimeSubagentEnabled(
                runtimeConfig.subagentEnabled,
                role,
              );
              final toggleable = canEdit && isSubagentToggleable(profile, role);
              final configured = isSubagentConfiguredInProfile(profile, role);
              return EcoSheetSwitchTile(
                title: _subagentRoleLabels[role] ?? role,
                subtitle: !configured
                    ? 'Profile 未配置'
                    : enabled
                    ? '已启用'
                    : '已停用',
                value: enabled,
                enabled: toggleable,
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
            },
          ),
        ],
      ],
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
    this.workspacePath = '',
    this.coreKind,
    this.onCoreKindChanged,
  });

  final ThreadRuntimeConfigInput fallbackConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final String workspacePath;
  final String? coreKind;
  final ValueChanged<String>? onCoreKindChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtimeConfig = watchedComposerRuntimeConfig(ref, fallbackConfig);
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final workflow = ref.watch(workflowSettingsProvider).valueOrNull;
    final mcpServers =
        ref.watch(mcpSettingsProvider).valueOrNull?.servers ?? const [];
    final enabledMcpServers = mcpServers
        .where((server) => server.enabled && server.name.trim().isNotEmpty)
        .toList(growable: false);
    final mcpEnabledSettings = resolveComposerMcpSettings(
      servers: mcpServers,
      runtimeConfig: runtimeConfig,
      profile: resolveThreadAgentProfile(modelSettings, runtimeConfig),
      remembered: workflow?.mcpServersEnabled,
    );
    final skillsResult = workspacePath.isEmpty
        ? null
        : ref.watch(composerSkillsProvider(workspacePath)).valueOrNull;
    final projectSkillsSettings = workspacePath.isEmpty
        ? null
        : ref.watch(projectSkillsSettingsProvider(workspacePath)).valueOrNull;
    final skills = skillsResult?.allSkills ?? const <SkillInfo>[];
    final skillsEnabled = _deriveComposerSkillsEnabled(
      skills,
      runtimeConfig.skillsEnabled,
      projectSkillsSettings?.enabledByPath,
    );
    final profiles = modelSettings?.orchestrationProfiles ?? [];
    final selectedId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;
    final profile = resolveThreadAgentProfile(modelSettings, runtimeConfig);

    return EcoSheetScaffold(
      title: '方案与编排',
      subtitle: '统一配置运行核心、智能体方案与工具',
      maxHeightFactor: 0.82,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          if (coreKind != null)
            EcoGroupedSection(
              label: '运行核心',
              topSpacing: 4,
              footer: onCoreKindChanged == null ? '当前会话的运行核心已锁定' : null,
              child: Column(
                children: [
                  for (var i = 0; i < _coreOptions.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 52),
                    EcoSheetOptionTile(
                      leading: Icon(
                        _coreOptions[i].icon,
                        size: 22,
                        color: _coreOptions[i].value == coreKind
                            ? ecoColors(context).accent
                            : ecoColors(context).textMuted,
                      ),
                      title: _coreOptions[i].label,
                      selected: _coreOptions[i].value == coreKind,
                      enabled: canEdit && onCoreKindChanged != null,
                      onTap: !canEdit || onCoreKindChanged == null
                          ? null
                          : () => onCoreKindChanged!(_coreOptions[i].value),
                    ),
                  ],
                ],
              ),
            ),
          if (profiles.isNotEmpty)
            EcoGroupedSection(
              label: '方案',
              topSpacing: coreKind == null ? 4 : 20,
              child: Column(
                children: [
                  for (var i = 0; i < profiles.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 16),
                    EcoSheetOptionTile(
                      title: profiles[i].name,
                      selected: profiles[i].id == selectedId,
                      enabled: canEdit,
                      onTap: !canEdit
                          ? null
                          : () {
                              persistRuntimeConfig(
                                ref,
                                threadId: threadId,
                                config: buildRuntimeConfigForProfile(
                                  profile: profiles[i],
                                  runtimeConfig: runtimeConfig,
                                  servers: mcpServers,
                                  remembered: workflow?.mcpServersEnabled,
                                ),
                                onChanged: onChanged,
                              );
                              Navigator.pop(context);
                            },
                    ),
                  ],
                ],
              ),
            ),
          EcoGroupedSection(
            label: '子代理',
            topSpacing: profiles.isEmpty && coreKind == null ? 4 : 20,
            footer: canEdit ? null : '当前会话不可编辑编排',
            child: Column(
              children: [
                EcoGroupedTile(
                  padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '主 Agent',
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(fontSize: 17, letterSpacing: -0.2),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '始终启用',
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(
                                    color: ecoColors(context).textMuted,
                                  ),
                            ),
                          ],
                        ),
                      ),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: ecoColors(context).statusAllowBg,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          child: Text(
                            '启用',
                            style: TextStyle(
                              color: ecoColors(context).statusAllowText,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const EcoGroupedDivider(indent: 16),
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
          if (enabledMcpServers.isNotEmpty)
            EcoGroupedSection(
              label: 'MCP',
              topSpacing: 20,
              footer: canEdit ? '关闭后当前会话不再调用该服务器工具' : null,
              child: Column(
                children: [
                  for (var i = 0; i < enabledMcpServers.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 16),
                    Builder(
                      builder: (context) {
                        final server = enabledMcpServers[i];
                        final serverKey = sanitizeMcpServerName(server.name);
                        final enabled = mcpEnabledSettings[serverKey] ?? false;
                        return EcoSheetSwitchTile(
                          title: server.name,
                          subtitle: server.transport,
                          value: enabled,
                          enabled: canEdit,
                          onChanged: !canEdit
                              ? null
                              : (value) async {
                                  final nextSettings = Map<String, bool>.from(
                                    mcpEnabledSettings,
                                  )..[serverKey] = value;
                                  persistRuntimeConfig(
                                    ref,
                                    threadId: threadId,
                                    config: runtimeConfig.copyWith(
                                      mcpServersEnabled: nextSettings,
                                    ),
                                    onChanged: onChanged,
                                  );
                                  await persistComposerMcpWorkflowDefaults(
                                    ref,
                                    mcpServersEnabled: nextSettings,
                                  );
                                },
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
          if (skills.isNotEmpty)
            EcoGroupedSection(
              label: 'Skills',
              topSpacing: 20,
              footer: canEdit ? '按需启用当前项目可用的 Skills' : null,
              child: Column(
                children: [
                  for (var i = 0; i < skills.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 16),
                    Builder(
                      builder: (context) {
                        final skill = skills[i];
                        final key = skill.settingsId;
                        final enabled = skillsEnabled[key] ?? false;
                        return EcoSheetSwitchTile(
                          title: skill.name,
                          subtitle: skill.source == 'project'
                              ? '项目 · ${skill.layout}'
                              : '用户 · ${skill.layout}',
                          value: enabled,
                          enabled: canEdit,
                          onChanged: !canEdit
                              ? null
                              : (value) async {
                                  final nextSettings = Map<String, bool>.from(
                                    skillsEnabled,
                                  )..[key] = value;
                                  persistRuntimeConfig(
                                    ref,
                                    threadId: threadId,
                                    config: runtimeConfig.copyWith(
                                      skillsEnabled: nextSettings,
                                    ),
                                    onChanged: onChanged,
                                  );
                                  if (workspacePath.isNotEmpty) {
                                    final rpc = ref.read(desktopRpcProvider);
                                    await rpc?.saveProjectSkillsSettings(
                                      ProjectSkillsSettingsSnapshot(
                                        workspacePath: workspacePath,
                                        enabledByPath: nextSettings,
                                      ),
                                    );
                                    ref.invalidate(
                                      projectSkillsSettingsProvider(
                                        workspacePath,
                                      ),
                                    );
                                  }
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

const _coreOptions = [
  (value: 'claude', label: 'Claude Code', icon: EcoIcons.agent),
  (value: 'codex', label: 'Codex', icon: EcoIcons.terminalSquare),
];

Map<String, bool> _deriveComposerSkillsEnabled(
  List<SkillInfo> skills,
  Map<String, bool>? existing,
  Map<String, bool>? remembered,
) {
  return {
    for (final skill in skills)
      skill.settingsId:
          existing?[skill.settingsId] ??
          remembered?[skill.settingsId] ??
          (skill.source == 'project'),
  };
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
                color: enabled
                    ? ecoColors(context).textSecondary
                    : ecoColors(context).textMuted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: enabled
                        ? ecoColors(context).textPrimary
                        : ecoColors(context).textMuted,
                    fontWeight: FontWeight.w500,
                    fontSize: 12,
                  ),
                ),
              ),
              if (enabled && onTap != null)
                Icon(
                  EcoIcons.expandDown,
                  size: 14,
                  color: ecoColors(context).textMuted,
                ),
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
        border: Border.all(
          width: 0.5,
          color: ecoColors(context).composerPillBorder,
        ),
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
                color: enabled
                    ? ecoColors(context).textSecondary
                    : ecoColors(context).textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: enabled
                      ? ecoColors(context).textPrimary
                      : ecoColors(context).textMuted,
                  fontWeight: FontWeight.w500,
                  fontSize: 12,
                ),
              ),
              if (enabled && onTap != null) ...[
                const SizedBox(width: 2),
                Icon(
                  EcoIcons.expandDown,
                  size: 14,
                  color: ecoColors(context).textMuted,
                ),
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
    final workflow = await ref.read(workflowSettingsProvider.future);
    final mcpServers = await ref.read(mcpSettingsProvider.future);
    final profiles = settings?.orchestrationProfiles ?? [];
    if (profiles.isEmpty || !context.mounted) return;

    final selectedId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;

    await showEcoActionSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => EcoSheetScaffold(
        title: '选择智能体配置',
        maxHeightFactor: 0.7,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            EcoGroupedSection(
              label: '方案',
              topSpacing: 4,
              child: Column(
                children: [
                  for (var i = 0; i < profiles.length; i++) ...[
                    if (i > 0) const EcoGroupedDivider(indent: 16),
                    EcoSheetOptionTile(
                      title: profiles[i].name,
                      selected: profiles[i].id == selectedId,
                      onTap: () {
                        persistRuntimeConfig(
                          ref,
                          threadId: threadId,
                          config: buildRuntimeConfigForProfile(
                            profile: profiles[i],
                            runtimeConfig: runtimeConfig,
                            servers: mcpServers?.servers ?? const [],
                            remembered: workflow?.mcpServersEnabled,
                          ),
                          onChanged: onChanged,
                        );
                        Navigator.pop(context);
                      },
                    ),
                  ],
                ],
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
    await showEcoActionSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => EcoSheetScaffold(
        title: '子代理编排',
        subtitle: '控制当前会话可调用的子代理',
        maxHeightFactor: 0.7,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            EcoGroupedSection(
              label: '代理',
              topSpacing: 4,
              child: Column(
                children: [
                  EcoGroupedTile(
                    padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '主 Agent',
                                style: Theme.of(context).textTheme.bodyLarge
                                    ?.copyWith(
                                      fontSize: 17,
                                      letterSpacing: -0.2,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '始终启用',
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      color: ecoColors(context).textMuted,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: ecoColors(context).statusAllowBg,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            child: Text(
                              '启用',
                              style: TextStyle(
                                color: ecoColors(context).statusAllowText,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const EcoGroupedDivider(indent: 16),
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
          ],
        ),
      ),
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
    final current = sessionModeUi(runtimeConfig.sessionMode);

    return ComposerToolbarIconButton(
      onPressed: !canEdit
          ? null
          : () => showComposerSessionModeSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              onChanged: onChanged,
            ),
      tooltip: current.title,
      icon: SessionModeIcon(
        mode: runtimeConfig.sessionMode,
        color: ecoColors(context).textSecondary,
      ),
    );
  }
}

Future<void> showComposerSessionModeSheet(
  BuildContext context,
  WidgetRef ref, {
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) async {
  await showEcoActionSheet<void>(
    context: context,
    builder: (context) => EcoSheetScaffold(
      title: '工作模式',
      subtitle: '选择当前会话的运行方式',
      maxHeightFactor: 0.55,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          EcoGroupedSection(
            label: '模式',
            topSpacing: 4,
            child: Column(
              children: [
                for (var i = 0; i < sessionModeUiOptions.length; i++) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  EcoSheetOptionTile(
                    leading: SessionModeIcon(
                      mode: sessionModeUiOptions[i].value,
                      size: 22,
                      color:
                          sessionModeUiOptions[i].value ==
                              runtimeConfig.sessionMode
                          ? ecoColors(context).accent
                          : ecoColors(context).textMuted,
                    ),
                    title: sessionModeUiOptions[i].title,
                    subtitle: sessionModeUiOptions[i].description,
                    selected:
                        sessionModeUiOptions[i].value ==
                        runtimeConfig.sessionMode,
                    onTap: () {
                      persistRuntimeConfig(
                        ref,
                        threadId: threadId,
                        config: runtimeConfig.copyWith(
                          sessionMode: sessionModeUiOptions[i].value,
                        ),
                        onChanged: onChanged,
                      );
                      Navigator.pop(context);
                    },
                  ),
                ],
              ],
            ),
          ),
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
    this.workspacePath = '',
    this.coreKind,
    this.onCoreKindChanged,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;
  final String workspacePath;
  final String? coreKind;
  final ValueChanged<String>? onCoreKindChanged;

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
          ComposerToolbarIconButton(
            onPressed: () => showThreadContextSheet(
              context: context,
              contextSnapshot: contextSnapshot,
              threadStatus: threadStatus,
              agentProfile: agentProfile,
            ),
            tooltip: '上下文',
            icon: ComposerContextRing(
              pct: occupancyPct ?? 0,
              size: kComposerToolbarIconSize,
            ),
          ),
        ComposerToolbarIconButton(
          onPressed: () => _showRouteSheet(
            context,
            ref,
            runtimeConfig: runtimeConfig,
            threadId: threadId,
            canEdit: canEdit,
            onChanged: onChanged,
            workspacePath: workspacePath,
            coreKind: coreKind,
            onCoreKindChanged: onCoreKindChanged,
          ),
          tooltip: tooltip,
          icon: ComposerToolbarIcon(
            icon: EcoIcons.profile,
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
    required String workspacePath,
    required String? coreKind,
    required ValueChanged<String>? onCoreKindChanged,
  }) async {
    await showEcoActionSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => ComposerRouteSheet(
        fallbackConfig: runtimeConfig,
        threadId: threadId,
        canEdit: canEdit,
        onChanged: onChanged,
        workspacePath: workspacePath,
        coreKind: coreKind,
        onCoreKindChanged: onCoreKindChanged,
      ),
    );
  }
}

Future<void> showComposerBashReviewSheet(
  BuildContext context,
  WidgetRef ref, {
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
}) {
  return showEcoActionSheet<void>(
    context: context,
    builder: (context) => EcoSheetScaffold(
      title: 'Bash 审批',
      subtitle: '控制命令执行前的确认方式',
      maxHeightFactor: 0.55,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          EcoGroupedSection(
            label: '模式',
            topSpacing: 4,
            child: Column(
              children: [
                for (var i = 0; i < bashReviewUiOptions.length; i++) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  EcoSheetOptionTile(
                    leading: ComposerBashReviewToolbarIcon(
                      mode: bashReviewUiOptions[i].value,
                      size: 22,
                      color:
                          bashReviewUiOptions[i].value ==
                              runtimeConfig.bashReviewMode
                          ? ecoColors(context).accent
                          : ecoColors(context).textMuted,
                    ),
                    title: bashReviewUiOptions[i].title,
                    subtitle: bashReviewUiOptions[i].description,
                    selected:
                        bashReviewUiOptions[i].value ==
                        runtimeConfig.bashReviewMode,
                    onTap: () {
                      persistRuntimeConfig(
                        ref,
                        threadId: threadId,
                        config: runtimeConfig.copyWith(
                          bashReviewMode: bashReviewUiOptions[i].value,
                        ),
                        onChanged: onChanged,
                      );
                      Navigator.pop(context);
                    },
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    ),
  );
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

    return ComposerToolbarIconButton(
      onPressed: () => showComposerBashReviewSheet(
        context,
        ref,
        runtimeConfig: runtimeConfig,
        threadId: threadId,
        onChanged: onChanged,
      ),
      tooltip: bashReviewUi(mode).title,
      icon: ComposerBashReviewToolbarIcon(
        mode: mode,
        color: accent
            ? ecoColors(context).accent
            : ecoColors(context).textSecondary,
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
      onTap: () => showComposerBashReviewSheet(
        context,
        ref,
        runtimeConfig: runtimeConfig,
        threadId: threadId,
        onChanged: onChanged,
      ),
    );
  }
}
