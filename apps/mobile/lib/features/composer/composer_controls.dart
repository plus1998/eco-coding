import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/locale/app_localizations_ext.dart';
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
import '../../l10n/generated/app_localizations.dart';
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

class ComposerTemporaryModelOption {
  const ComposerTemporaryModelOption({
    required this.providerId,
    required this.modelId,
    this.displayName,
    this.candidateModelId,
    this.supportsReasoning,
  });

  final String providerId;
  final String modelId;
  final String? displayName;
  final String? candidateModelId;
  final bool? supportsReasoning;
}

List<({String value, String label})> _thinkingEffortOptions(
  AppLocalizations l10n,
) => [
  (value: 'off', label: l10n.composerReasoningOff),
  (value: 'low', label: l10n.composerReasoningLow),
  (value: 'medium', label: l10n.composerReasoningMedium),
  (value: 'high', label: l10n.composerReasoningHigh),
  (value: 'xhigh', label: l10n.composerReasoningExtraHigh),
  (value: 'max', label: l10n.composerReasoningMaximum),
];

List<ComposerTemporaryModelOption> buildComposerTemporaryModelOptions({
  required ModelProviderView provider,
  required OrchestrationModelRef templateModel,
  required List<CandidateModelView> candidates,
}) {
  if (!provider.enabled || provider.id != templateModel.providerId) {
    return const [];
  }
  final seen = <String>{};
  final options = <ComposerTemporaryModelOption>[];
  for (final candidate in candidates) {
    final modelId = candidate.modelId.trim();
    if (candidate.providerId != provider.id ||
        modelId.isEmpty ||
        !seen.add(modelId)) {
      continue;
    }
    options.add(
      ComposerTemporaryModelOption(
        providerId: provider.id,
        modelId: modelId,
        displayName: candidate.displayName?.trim().isEmpty == true
            ? null
            : candidate.displayName?.trim(),
        candidateModelId: candidate.id.trim().isEmpty
            ? null
            : candidate.id.trim(),
        supportsReasoning: candidate.resolvedSupportsReasoning,
      ),
    );
  }
  final defaultModel = provider.defaultModel.trim();
  if (defaultModel.isNotEmpty && seen.add(defaultModel)) {
    options.add(
      ComposerTemporaryModelOption(
        providerId: provider.id,
        modelId: defaultModel,
      ),
    );
  }
  final templateModelId = templateModel.modelId.trim();
  if (templateModelId.isNotEmpty && seen.add(templateModelId)) {
    options.insert(
      0,
      ComposerTemporaryModelOption(
        providerId: provider.id,
        modelId: templateModelId,
        candidateModelId: templateModel.candidateModelId,
      ),
    );
  }
  return options;
}

String? composerTemporaryModelEffort(
  MainAgentModelOverride? override,
  OrchestrationModelRef templateModel,
) {
  final overrideUsesTemplateModel =
      override?.providerId.trim() == templateModel.providerId.trim() &&
      override?.modelId.trim() == templateModel.modelId.trim();
  return override?.thinkingEffort ??
      (override == null || overrideUsesTemplateModel
          ? templateModel.thinkingEffort
          : null);
}

MainAgentModelOverride? buildComposerTemporaryModelOverride({
  required ComposerTemporaryModelOption model,
  required String? thinkingEffort,
  required OrchestrationModelRef templateModel,
}) {
  final providerId = model.providerId.trim();
  final modelId = model.modelId.trim();
  final candidateModelId = model.candidateModelId?.trim();
  final sameAsTemplate =
      providerId == templateModel.providerId.trim() &&
      modelId == templateModel.modelId.trim() &&
      candidateModelId == templateModel.candidateModelId?.trim() &&
      thinkingEffort == templateModel.thinkingEffort;
  if (sameAsTemplate) return null;
  return MainAgentModelOverride(
    providerId: providerId,
    modelId: modelId,
    thinkingEffort: thinkingEffort,
    candidateModelId: candidateModelId?.isEmpty == true
        ? null
        : candidateModelId,
  );
}

bool composerTemporaryModelSelected(
  MainAgentModelOverride? override,
  ComposerTemporaryModelOption option,
) {
  if (override == null) return false;
  final overrideCandidateId = override.candidateModelId?.trim();
  final optionCandidateId = option.candidateModelId?.trim();
  if (overrideCandidateId?.isNotEmpty == true &&
      optionCandidateId?.isNotEmpty == true) {
    return overrideCandidateId == optionCandidateId;
  }
  return override.providerId == option.providerId &&
      override.modelId == option.modelId;
}

bool composerTemporaryModelMatchesTemplate(
  ComposerTemporaryModelOption option,
  OrchestrationModelRef templateModel,
) {
  final optionCandidateId = option.candidateModelId?.trim();
  final templateCandidateId = templateModel.candidateModelId?.trim();
  if (optionCandidateId?.isNotEmpty == true &&
      templateCandidateId?.isNotEmpty == true) {
    return optionCandidateId == templateCandidateId;
  }
  return option.providerId == templateModel.providerId &&
      option.modelId == templateModel.modelId;
}

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
          context.l10n.composerNoSubagents,
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
                    ? context.l10n.composerProfileNotConfigured
                    : enabled
                    ? context.l10n.commonEnabled
                    : context.l10n.commonDisabled,
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

enum _ComposerRouteCategory {
  agent,
  model,
  thinking,
  mcp,
  skills,
  profile,
  subagents,
}

class ComposerRouteSheet extends ConsumerStatefulWidget {
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
  ConsumerState<ComposerRouteSheet> createState() => _ComposerRouteSheetState();
}

class _ComposerRouteSheetState extends ConsumerState<ComposerRouteSheet> {
  _ComposerRouteCategory _selectedCategory = _ComposerRouteCategory.agent;

  ThreadRuntimeConfigInput get fallbackConfig => widget.fallbackConfig;
  String get threadId => widget.threadId;
  bool get canEdit => widget.canEdit;
  ValueChanged<ThreadRuntimeConfigInput> get onChanged => widget.onChanged;
  String get workspacePath => widget.workspacePath;
  String? get coreKind => widget.coreKind;
  ValueChanged<String>? get onCoreKindChanged => widget.onCoreKindChanged;

  @override
  Widget build(BuildContext context) {
    final runtimeConfig = watchedComposerRuntimeConfig(
      ref,
      widget.fallbackConfig,
    );
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
    final skillsResult = widget.workspacePath.isEmpty
        ? null
        : ref.watch(composerSkillsProvider(widget.workspacePath)).valueOrNull;
    final projectSkillsSettings = widget.workspacePath.isEmpty
        ? null
        : ref
              .watch(projectSkillsSettingsProvider(widget.workspacePath))
              .valueOrNull;
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
    final templateModel = profile?.mainModelRef;
    ModelProviderView? modelProvider;
    if (templateModel != null) {
      for (final provider in modelSettings?.providers ?? const []) {
        if (provider.id == templateModel.providerId) {
          modelProvider = provider;
          break;
        }
      }
    }

    final categories = [
      (
        value: _ComposerRouteCategory.agent,
        label: context.l10n.composerAgent,
        summary: switch (coreKind) {
          'codex' => 'Codex',
          'claude' => 'Claude Code',
          _ => context.l10n.commonUnavailable,
        },
        icon: EcoIcons.agent,
      ),
      (
        value: _ComposerRouteCategory.model,
        label: context.l10n.composerModel,
        summary: templateModel == null
            ? context.l10n.commonNotConfigured
            : shortenModelId(
                runtimeConfig.mainAgentModelOverride?.modelId ??
                    templateModel.modelId,
              ),
        icon: EcoIcons.contextMemory,
      ),
      (
        value: _ComposerRouteCategory.thinking,
        label: context.l10n.composerReasoning,
        summary: templateModel == null
            ? context.l10n.commonNotConfigured
            : _thinkingEffortLabel(
                composerTemporaryModelEffort(
                  runtimeConfig.mainAgentModelOverride,
                  templateModel,
                ),
                context.l10n,
              ),
        icon: EcoIcons.sparkles,
      ),
      (
        value: _ComposerRouteCategory.mcp,
        label: context.l10n.composerMcp,
        summary:
            '${mcpEnabledSettings.values.where((value) => value).length}/${enabledMcpServers.length}',
        icon: EcoIcons.mcp,
      ),
      (
        value: _ComposerRouteCategory.skills,
        label: context.l10n.composerSkills,
        summary:
            '${skillsEnabled.values.where((value) => value).length}/${skills.length}',
        icon: EcoIcons.todos,
      ),
      (
        value: _ComposerRouteCategory.profile,
        label: context.l10n.composerProfile,
        summary: profile?.name ?? context.l10n.commonNotConfigured,
        icon: EcoIcons.profile,
      ),
      (
        value: _ComposerRouteCategory.subagents,
        label: context.l10n.composerSubagents,
        summary: _firstEnabledSubagentLabel(
          runtimeConfig,
          profile,
          context.l10n,
        ),
        icon: EcoIcons.subagents,
      ),
    ];
    final selected = categories.firstWhere(
      (category) => category.value == _selectedCategory,
    );

    return EcoSheetScaffold(
      title: context.l10n.composerProfileOrchestration,
      subtitle: context.l10n.composerSessionOnly,
      maxHeightFactor: 0.86,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 2, 16, 12),
            child: GridView.builder(
              shrinkWrap: true,
              primary: false,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 4,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1.25,
              ),
              itemCount: categories.length,
              itemBuilder: (context, index) {
                final category = categories[index];
                return _ComposerRouteCategoryTile(
                  label: category.label,
                  summary: category.summary,
                  icon: category.icon,
                  selected: category.value == _selectedCategory,
                  onTap: () {
                    if (category.value == _selectedCategory) return;
                    HapticFeedback.selectionClick();
                    setState(() => _selectedCategory = category.value);
                  },
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    selected.label,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.25,
                    ),
                  ),
                ),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 180),
                  child: Text(
                    selected.summary,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              switchInCurve: Curves.easeOutCubic,
              switchOutCurve: Curves.easeInCubic,
              transitionBuilder: (child, animation) =>
                  FadeTransition(opacity: animation, child: child),
              child: ListView(
                key: ValueKey(_selectedCategory),
                padding: const EdgeInsets.only(bottom: 8),
                children: [
                  if (_selectedCategory == _ComposerRouteCategory.agent &&
                      coreKind != null)
                    EcoGroupedSection(
                      label: context.l10n.composerRuntimeCore,
                      topSpacing: 4,
                      footer: onCoreKindChanged == null
                          ? context.l10n.composerRuntimeCoreLocked
                          : null,
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
                                  : () => onCoreKindChanged!(
                                      _coreOptions[i].value,
                                    ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.profile &&
                      profiles.isNotEmpty)
                    EcoGroupedSection(
                      label: context.l10n.composerProfile,
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
                                          remembered:
                                              workflow?.mcpServersEnabled,
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
                  if ((_selectedCategory == _ComposerRouteCategory.model ||
                          _selectedCategory ==
                              _ComposerRouteCategory.thinking) &&
                      templateModel != null &&
                      modelProvider?.enabled == true)
                    _ComposerTemporaryModelSection(
                      showModel:
                          _selectedCategory == _ComposerRouteCategory.model,
                      showThinking:
                          _selectedCategory == _ComposerRouteCategory.thinking,
                      runtimeConfig: runtimeConfig,
                      threadId: threadId,
                      canEdit: canEdit,
                      onChanged: onChanged,
                      provider: modelProvider!,
                      templateModel: templateModel,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.subagents)
                    EcoGroupedSection(
                      label: context.l10n.composerSubagents,
                      topSpacing: profiles.isEmpty && coreKind == null ? 4 : 20,
                      footer: canEdit
                          ? null
                          : context.l10n.composerOrchestrationLocked,
                      child: Column(
                        children: [
                          EcoGroupedTile(
                            padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        context.l10n.composerMainAgent,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyLarge
                                            ?.copyWith(
                                              fontSize: 17,
                                              letterSpacing: -0.2,
                                            ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        context.l10n.composerAlwaysEnabled,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: ecoColors(
                                                context,
                                              ).textMuted,
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
                                      context.l10n.commonEnable,
                                      style: TextStyle(
                                        color: ecoColors(
                                          context,
                                        ).statusAllowText,
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
                  if (_selectedCategory == _ComposerRouteCategory.mcp &&
                      enabledMcpServers.isNotEmpty)
                    EcoGroupedSection(
                      label: context.l10n.composerMcp,
                      topSpacing: 20,
                      footer: canEdit
                          ? context.l10n.composerMcpDisabledHint
                          : null,
                      child: Column(
                        children: [
                          for (
                            var i = 0;
                            i < enabledMcpServers.length;
                            i++
                          ) ...[
                            if (i > 0) const EcoGroupedDivider(indent: 16),
                            Builder(
                              builder: (context) {
                                final server = enabledMcpServers[i];
                                final serverKey = sanitizeMcpServerName(
                                  server.name,
                                );
                                final enabled =
                                    mcpEnabledSettings[serverKey] ?? false;
                                return EcoSheetSwitchTile(
                                  title: server.name,
                                  subtitle: server.transport,
                                  value: enabled,
                                  enabled: canEdit,
                                  onChanged: !canEdit
                                      ? null
                                      : (value) async {
                                          final nextSettings =
                                              Map<String, bool>.from(
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
                  if (_selectedCategory == _ComposerRouteCategory.agent &&
                      coreKind == null)
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoSwitchableAgent,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.model &&
                      (templateModel == null || modelProvider?.enabled != true))
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoSwitchableModel,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.thinking &&
                      (templateModel == null || modelProvider?.enabled != true))
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoReasoningOptions,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.profile &&
                      profiles.isEmpty)
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoProfiles,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.mcp &&
                      enabledMcpServers.isEmpty)
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoMcpServers,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.skills &&
                      skills.isEmpty)
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoSkills,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.skills &&
                      skills.isNotEmpty)
                    EcoGroupedSection(
                      label: context.l10n.composerSkills,
                      topSpacing: 20,
                      footer: canEdit ? context.l10n.composerSkillsHint : null,
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
                                      ? context.l10n.composerProjectSkill(
                                          skill.layout,
                                        )
                                      : context.l10n.composerUserSkill(
                                          skill.layout,
                                        ),
                                  value: enabled,
                                  enabled: canEdit,
                                  onChanged: !canEdit
                                      ? null
                                      : (value) async {
                                          final nextSettings =
                                              Map<String, bool>.from(
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
                                            final rpc = ref.read(
                                              desktopRpcProvider,
                                            );
                                            await rpc
                                                ?.saveProjectSkillsSettings(
                                                  ProjectSkillsSettingsSnapshot(
                                                    workspacePath:
                                                        workspacePath,
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
            ),
          ),
        ],
      ),
    );
  }
}

class _ComposerRouteEmptyState extends StatelessWidget {
  const _ComposerRouteEmptyState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 16, 0),
      child: Text(
        message,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: ecoColors(context).textMuted),
      ),
    );
  }
}

class _ComposerRouteCategoryTile extends StatelessWidget {
  const _ComposerRouteCategoryTile({
    required this.label,
    required this.summary,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String summary;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: AnimatedScale(
        scale: selected ? 1 : 0.98,
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOutCubic,
        child: Material(
          color: selected ? colors.accentSoft : colors.cardSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(
              width: 0.5,
              color: selected
                  ? colors.accent.withValues(alpha: 0.3)
                  : colors.cardSurfaceBorder,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 8),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        icon,
                        size: 17,
                        color: selected ? colors.accent : colors.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: selected
                                    ? colors.accent
                                    : colors.textPrimary,
                                fontSize: 12,
                                fontWeight: selected
                                    ? FontWeight.w600
                                    : FontWeight.w500,
                                letterSpacing: 0,
                              ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    summary,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.textMuted,
                      fontSize: 10,
                      fontWeight: FontWeight.w400,
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _thinkingEffortLabel(String? effort, AppLocalizations l10n) {
  final value = effort ?? 'off';
  for (final option in _thinkingEffortOptions(l10n)) {
    if (option.value == value) return option.label;
  }
  return value;
}

String _firstEnabledSubagentLabel(
  ThreadRuntimeConfigInput runtimeConfig,
  OrchestrationProfile? profile,
  AppLocalizations l10n,
) {
  for (final role in configuredOrchestrationSubagentRoles(profile)) {
    if (isRuntimeSubagentEnabled(runtimeConfig.subagentEnabled, role)) {
      return _subagentRoleLabels[role] ?? role;
    }
  }
  return l10n.composerNotEnabled;
}

class _ComposerTemporaryModelSection extends ConsumerWidget {
  const _ComposerTemporaryModelSection({
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    required this.provider,
    required this.templateModel,
    this.showModel = true,
    this.showThinking = true,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ModelProviderView provider;
  final OrchestrationModelRef templateModel;
  final bool showModel;
  final bool showThinking;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final candidates = ref.watch(candidateModelsProvider(provider.id));
    final options = buildComposerTemporaryModelOptions(
      provider: provider,
      templateModel: templateModel,
      candidates: candidates.valueOrNull ?? const [],
    );
    final override = runtimeConfig.mainAgentModelOverride;
    ComposerTemporaryModelOption? currentModel;
    for (final option in options) {
      if (composerTemporaryModelSelected(override, option)) {
        currentModel = option;
        break;
      }
    }
    if (currentModel == null && override != null) {
      currentModel = ComposerTemporaryModelOption(
        providerId: override.providerId,
        modelId: override.modelId,
        candidateModelId: override.candidateModelId,
      );
    }
    if (currentModel == null) {
      for (final option in options) {
        if (composerTemporaryModelMatchesTemplate(option, templateModel)) {
          currentModel = option;
          break;
        }
      }
    }
    currentModel ??= ComposerTemporaryModelOption(
      providerId: templateModel.providerId,
      modelId: templateModel.modelId,
      candidateModelId: templateModel.candidateModelId,
    );

    final currentEffort = composerTemporaryModelEffort(override, templateModel);
    final selectedEffort = currentEffort ?? 'off';
    final reasoningUnavailable = currentModel.supportsReasoning == false;

    void selectOverride(MainAgentModelOverride? nextOverride) {
      persistRuntimeConfig(
        ref,
        threadId: threadId,
        config: nextOverride == null
            ? runtimeConfig.copyWith(clearMainAgentModelOverride: true)
            : runtimeConfig.copyWith(mainAgentModelOverride: nextOverride),
        onChanged: onChanged,
      );
      Navigator.pop(context);
    }

    return Column(
      children: [
        if (showModel)
          EcoGroupedSection(
            label: context.l10n.composerModel,
            topSpacing: 20,
            footer: canEdit
                ? context.l10n.composerModelCandidatesHint
                : context.l10n.composerModelLocked,
            child: Column(
              children: [
                EcoSheetOptionTile(
                  title: context.l10n.composerFollowProfile,
                  subtitle: templateModel.modelId,
                  selected: override == null,
                  enabled: canEdit,
                  onTap: !canEdit ? null : () => selectOverride(null),
                ),
                if (candidates.isLoading) ...[
                  const EcoGroupedDivider(indent: 16),
                  const EcoGroupedTile(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 2),
                      child: LinearProgressIndicator(minHeight: 2),
                    ),
                  ),
                ] else if (candidates.hasError) ...[
                  const EcoGroupedDivider(indent: 16),
                  EcoGroupedTile(
                    child: Text(
                      context.l10n.composerModelLoadFailed,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: ecoColors(context).danger,
                      ),
                    ),
                  ),
                ] else
                  for (final option in options.where(
                    (option) => !composerTemporaryModelMatchesTemplate(
                      option,
                      templateModel,
                    ),
                  )) ...[
                    const EcoGroupedDivider(indent: 16),
                    EcoSheetOptionTile(
                      title: option.displayName?.isNotEmpty == true
                          ? option.displayName!
                          : shortenModelId(option.modelId),
                      subtitle: option.displayName?.isNotEmpty == true
                          ? option.modelId
                          : provider.name,
                      selected: composerTemporaryModelSelected(
                        override,
                        option,
                      ),
                      enabled: canEdit,
                      onTap: !canEdit
                          ? null
                          : () => selectOverride(
                              buildComposerTemporaryModelOverride(
                                model: option,
                                thinkingEffort:
                                    option.supportsReasoning == false
                                    ? 'off'
                                    : currentEffort,
                                templateModel: templateModel,
                              ),
                            ),
                    ),
                  ],
              ],
            ),
          ),
        if (showThinking)
          EcoGroupedSection(
            label: context.l10n.composerReasoning,
            topSpacing: 20,
            footer: reasoningUnavailable
                ? context.l10n.composerReasoningUnsupported
                : context.l10n.composerSessionReasoningOnly,
            child: Column(
              children: [
                for (
                  var i = 0;
                  i < _thinkingEffortOptions(context.l10n).length;
                  i++
                ) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 16),
                  EcoSheetOptionTile(
                    title: _thinkingEffortOptions(context.l10n)[i].label,
                    selected:
                        selectedEffort ==
                        _thinkingEffortOptions(context.l10n)[i].value,
                    enabled:
                        canEdit &&
                        (!reasoningUnavailable ||
                            _thinkingEffortOptions(context.l10n)[i].value ==
                                'off'),
                    onTap:
                        !canEdit ||
                            (reasoningUnavailable &&
                                _thinkingEffortOptions(context.l10n)[i].value !=
                                    'off')
                        ? null
                        : () => selectOverride(
                            buildComposerTemporaryModelOverride(
                              model: currentModel!,
                              thinkingEffort: _thinkingEffortOptions(
                                context.l10n,
                              )[i].value,
                              templateModel: templateModel,
                            ),
                          ),
                  ),
                ],
              ],
            ),
          ),
      ],
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
        return profileId.isEmpty
            ? context.l10n.composerSelectProfile
            : profileId;
      },
      orElse: () =>
          profileId.isEmpty ? context.l10n.composerSelectProfile : profileId,
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
        title: context.l10n.composerSelectAgentProfile,
        maxHeightFactor: 0.7,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            EcoGroupedSection(
              label: context.l10n.composerProfile,
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
      label: compact
          ? summary
          : context.l10n.composerOrchestrationSummary(summary),
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
        title: context.l10n.composerSubagentOrchestration,
        subtitle: context.l10n.composerSubagentOrchestrationSubtitle,
        maxHeightFactor: 0.7,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            EcoGroupedSection(
              label: context.l10n.composerAgents,
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
                                context.l10n.composerMainAgent,
                                style: Theme.of(context).textTheme.bodyLarge
                                    ?.copyWith(
                                      fontSize: 17,
                                      letterSpacing: -0.2,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                context.l10n.composerAlwaysEnabled,
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
                              context.l10n.commonEnable,
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
    final current = sessionModeUi(runtimeConfig.sessionMode, context.l10n);

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
      title: context.l10n.composerWorkMode,
      subtitle: context.l10n.composerWorkModeSubtitle,
      maxHeightFactor: 0.55,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          EcoGroupedSection(
            label: context.l10n.composerMode,
            topSpacing: 4,
            child: Column(
              children: [
                for (
                  var i = 0;
                  i < sessionModeUiOptions(context.l10n).length;
                  i++
                ) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  EcoSheetOptionTile(
                    leading: SessionModeIcon(
                      mode: sessionModeUiOptions(context.l10n)[i].value,
                      size: 22,
                      color:
                          sessionModeUiOptions(context.l10n)[i].value ==
                              runtimeConfig.sessionMode
                          ? ecoColors(context).accent
                          : ecoColors(context).textMuted,
                    ),
                    title: sessionModeUiOptions(context.l10n)[i].title,
                    subtitle: sessionModeUiOptions(context.l10n)[i].description,
                    selected:
                        sessionModeUiOptions(context.l10n)[i].value ==
                        runtimeConfig.sessionMode,
                    onTap: () {
                      persistRuntimeConfig(
                        ref,
                        threadId: threadId,
                        config: runtimeConfig.copyWith(
                          sessionMode: sessionModeUiOptions(
                            context.l10n,
                          )[i].value,
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
        return profileId.isEmpty
            ? context.l10n.composerSelectProfile
            : profileId;
      },
      orElse: () =>
          profileId.isEmpty ? context.l10n.composerSelectProfile : profileId,
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
            tooltip: context.l10n.composerContext,
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
      title: context.l10n.composerBashApproval,
      subtitle: context.l10n.composerBashApprovalSubtitle,
      maxHeightFactor: 0.55,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          EcoGroupedSection(
            label: context.l10n.composerMode,
            topSpacing: 4,
            child: Column(
              children: [
                for (
                  var i = 0;
                  i < bashReviewUiOptions(context.l10n).length;
                  i++
                ) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 52),
                  EcoSheetOptionTile(
                    leading: ComposerBashReviewToolbarIcon(
                      mode: bashReviewUiOptions(context.l10n)[i].value,
                      size: 22,
                      color:
                          bashReviewUiOptions(context.l10n)[i].value ==
                              runtimeConfig.bashReviewMode
                          ? ecoColors(context).accent
                          : ecoColors(context).textMuted,
                    ),
                    title: bashReviewUiOptions(context.l10n)[i].title,
                    subtitle: bashReviewUiOptions(context.l10n)[i].description,
                    selected:
                        bashReviewUiOptions(context.l10n)[i].value ==
                        runtimeConfig.bashReviewMode,
                    onTap: () {
                      persistRuntimeConfig(
                        ref,
                        threadId: threadId,
                        config: runtimeConfig.copyWith(
                          bashReviewMode: bashReviewUiOptions(
                            context.l10n,
                          )[i].value,
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
      tooltip: bashReviewUi(mode, context.l10n).title,
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
    final current = bashReviewUi(runtimeConfig.bashReviewMode, context.l10n);
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
