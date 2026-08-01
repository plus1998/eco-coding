import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/constants/bash_review_ui.dart';
import '../../core/constants/session_mode_ui.dart';
import 'composer_toolbar_icon.dart';
import '../../core/models/composer_mcp.dart';
import '../../core/models/git_models.dart';
import '../../core/models/mcp_models.dart';
import '../../core/models/project_orchestration_settings.dart';
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

String _thinkingEffortLabel(String? effort, AppLocalizations l10n) {
  final value = effort ?? 'off';
  for (final option in _thinkingEffortOptions(l10n)) {
    if (option.value == value) return option.label;
  }
  return value;
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
      defaultOrchestrationSelection: workflow.defaultOrchestrationSelection,
      defaultAuxiliaryModel: workflow.defaultAuxiliaryModel,
      defaultVisionModel: workflow.defaultVisionModel,
      mcpServersEnabled: mcpServersEnabled,
    ),
  );
  ref.invalidate(workflowSettingsProvider);
}

Future<void> persistAuxiliaryModelWorkflowDefault(
  WidgetRef ref, {
  required AuxiliaryModelSelection? selection,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;
  final workflow = await ref.read(workflowSettingsProvider.future);
  if (workflow == null) return;
  await rpc.saveWorkflowSettings(
    WorkflowSettingsSnapshot(
      sessionMode: workflow.sessionMode,
      defaultCoreKind: workflow.defaultCoreKind,
      defaultOrchestrationSelection: workflow.defaultOrchestrationSelection,
      defaultAuxiliaryModel: selection,
      defaultVisionModel: workflow.defaultVisionModel,
      mcpServersEnabled: workflow.mcpServersEnabled,
    ),
  );
  ref.invalidate(workflowSettingsProvider);
}

Future<void> persistVisionModelWorkflowDefault(
  WidgetRef ref, {
  required VisionModelSelection? selection,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;
  final workflow = await ref.read(workflowSettingsProvider.future);
  if (workflow == null) return;
  await rpc.saveWorkflowSettings(
    WorkflowSettingsSnapshot(
      sessionMode: workflow.sessionMode,
      defaultCoreKind: workflow.defaultCoreKind,
      defaultOrchestrationSelection: workflow.defaultOrchestrationSelection,
      defaultAuxiliaryModel: workflow.defaultAuxiliaryModel,
      defaultVisionModel: selection,
      mcpServersEnabled: workflow.mcpServersEnabled,
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

class OrchestrationCompositionSelectors extends ConsumerWidget {
  const OrchestrationCompositionSelectors({
    super.key,
    required this.settings,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    required this.workspacePath,
    this.mcpServers = const [],
    this.rememberedMcp,
    this.showAuxiliaryModelPicker = false,
    this.showVisionModelPicker = false,
  });

  final ModelSettingsSnapshot settings;
  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final String workspacePath;
  final List<McpServerConfigView> mcpServers;
  final Map<String, bool>? rememberedMcp;
  final bool showAuxiliaryModelPicker;
  final bool showVisionModelPicker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mainAgentConfigs = settings.mainAgentConfigs;
    final mainAgentPrompts = settings.mainAgentPrompts
        .where((prompt) => prompt.mode == 'custom_append')
        .toList(growable: false);
    final subagentOrchestrations = settings.subagentOrchestrations;
    final selection =
        runtimeConfig.orchestrationSelection ?? emptyOrchestrationSelection();
    final selectedMainAgentConfigId = selection.mainAgentConfigId;
    final mainAgentConfigId =
        mainAgentConfigs.any((config) => config.id == selectedMainAgentConfigId)
        ? selectedMainAgentConfigId
        : '';
    final selectedMainPromptValue = mainPromptSelectionValue(
      selection.mainPrompt,
    );
    final mainPromptValue =
        selectedMainPromptValue == builtinMainPromptValue ||
            mainAgentPrompts.any(
              (prompt) => prompt.id == selectedMainPromptValue,
            )
        ? selectedMainPromptValue
        : '';
    final subagentsValue = subagentSelectionValue(selection.subagents);
    final subagentOrchestrationId =
        subagentsValue != subagentsNoneValue &&
            subagentOrchestrations.any(
              (orchestration) => orchestration.id == subagentsValue,
            )
        ? subagentsValue
        : subagentsValue == subagentsNoneValue
        ? subagentsNoneValue
        : '';

    void applyPatch({
      String? mainAgentConfigId,
      MainAgentPromptSelection? mainPrompt,
      SubagentSelection? subagents,
    }) {
      final nextConfig = applyOrchestrationSelectionPatch(
        settings: settings,
        runtimeConfig: runtimeConfig,
        servers: mcpServers,
        remembered: rememberedMcp,
        mainAgentConfigId: mainAgentConfigId,
        mainPrompt: mainPrompt,
        subagents: subagents,
      );
      persistRuntimeConfig(
        ref,
        threadId: threadId,
        config: nextConfig,
        onChanged: onChanged,
      );
      final selection = nextConfig.orchestrationSelection;
      if (threadId.isEmpty &&
          workspacePath.trim().isNotEmpty &&
          hasCompleteOrchestrationSelection(selection)) {
        unawaited(
          persistProjectOrchestrationSelection(
            ref,
            workspacePath: workspacePath,
            selection: selection!,
          ),
        );
      }
    }

    final selectedMainAgent = mainAgentConfigs
        .where((config) => config.id == mainAgentConfigId)
        .firstOrNull;
    final selectedMainAgentLabel = selectedMainAgent == null
        ? context.l10n.commonNotConfigured
        : selectedMainAgent.name;
    final selectedMainAgentDetail = selectedMainAgent == null
        ? null
        : shortenModelId(selectedMainAgent.modelRef.modelId);

    final selectedPromptLabel = mainPromptValue.isEmpty
        ? context.l10n.commonNotConfigured
        : mainPromptValue == builtinMainPromptValue
        ? context.l10n.composerBuiltinMainAgentPrompt
        : mainAgentPrompts
                  .where((prompt) => prompt.id == mainPromptValue)
                  .firstOrNull
                  ?.name ??
              context.l10n.commonNotConfigured;

    final selectedSubagent = subagentOrchestrations
        .where((orchestration) => orchestration.id == subagentOrchestrationId)
        .firstOrNull;
    final selectedSubagentLabel = subagentOrchestrationId.isEmpty
        ? context.l10n.commonNotConfigured
        : subagentOrchestrationId == subagentsNoneValue
        ? context.l10n.composerNoSubagentOrchestration
        : selectedSubagent?.name ?? context.l10n.commonNotConfigured;
    final selectedSubagentDetail = selectedSubagent == null
        ? null
        : context.l10n.composerAgentsCount(selectedSubagent.agents.length);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _OrchestrationPickerRow(
          label: context.l10n.composerMainAgent,
          value: selectedMainAgentLabel,
          detail: selectedMainAgentDetail,
          enabled: canEdit && mainAgentConfigs.isNotEmpty,
          onTap: !canEdit || mainAgentConfigs.isEmpty
              ? null
              : () => _showOrchestrationOptionSheet(
                  context,
                  title: context.l10n.composerMainAgent,
                  options: [
                    for (final config in mainAgentConfigs)
                      _OrchestrationPickerOption(
                        value: config.id,
                        title: config.name,
                        subtitle: shortenModelId(config.modelRef.modelId),
                      ),
                  ],
                  selectedValue: mainAgentConfigId,
                  onSelected: (value) => applyPatch(mainAgentConfigId: value),
                ),
        ),
        const EcoGroupedDivider(indent: 16),
        _OrchestrationPickerRow(
          label: context.l10n.composerMainAgentPrompt,
          value: selectedPromptLabel,
          enabled: canEdit,
          onTap: !canEdit
              ? null
              : () => _showOrchestrationOptionSheet(
                  context,
                  title: context.l10n.composerMainAgentPrompt,
                  options: [
                    _OrchestrationPickerOption(
                      value: builtinMainPromptValue,
                      title: context.l10n.composerBuiltinMainAgentPrompt,
                    ),
                    for (final prompt in mainAgentPrompts)
                      _OrchestrationPickerOption(
                        value: prompt.id,
                        title: prompt.name,
                      ),
                  ],
                  selectedValue: mainPromptValue,
                  onSelected: (value) => applyPatch(
                    mainPrompt: value == builtinMainPromptValue
                        ? const BuiltinMainAgentPromptSelection()
                        : CustomAppendMainAgentPromptSelection(promptId: value),
                  ),
                ),
        ),
        const EcoGroupedDivider(indent: 16),
        _OrchestrationPickerRow(
          label: context.l10n.composerSubagentOrchestration,
          value: selectedSubagentLabel,
          detail: selectedSubagentDetail,
          enabled: canEdit,
          onTap: !canEdit
              ? null
              : () => _showOrchestrationOptionSheet(
                  context,
                  title: context.l10n.composerSubagentOrchestration,
                  options: [
                    _OrchestrationPickerOption(
                      value: subagentsNoneValue,
                      title: context.l10n.composerNoSubagentOrchestration,
                    ),
                    for (final orchestration in subagentOrchestrations)
                      _OrchestrationPickerOption(
                        value: orchestration.id,
                        title: orchestration.name,
                        subtitle: context.l10n.composerAgentsCount(
                          orchestration.agents.length,
                        ),
                      ),
                  ],
                  selectedValue: subagentOrchestrationId,
                  onSelected: (value) => applyPatch(
                    subagents: value == subagentsNoneValue
                        ? const NoneSubagentSelection()
                        : OrchestrationSubagentSelection(
                            orchestrationId: value,
                          ),
                  ),
                ),
        ),
        if (showAuxiliaryModelPicker) ...[
          const EcoGroupedDivider(indent: 16),
          _OrchestrationPickerRow(
            label: context.l10n.composerAuxiliaryModel,
            value: runtimeConfig.auxiliaryModel == null
                ? context.l10n.commonNotConfigured
                : shortenModelId(runtimeConfig.auxiliaryModel!.modelId),
            enabled: canEdit,
            onTap: !canEdit
                ? null
                : () => showComposerAuxiliaryModelPickerSheet(
                    context,
                    runtimeConfig: runtimeConfig,
                    threadId: threadId,
                    canEdit: canEdit,
                    onChanged: onChanged,
                    mainAgentConfigId: mainAgentConfigId,
                  ),
          ),
        ],
        if (showVisionModelPicker) ...[
          const EcoGroupedDivider(indent: 16),
          _OrchestrationPickerRow(
            label: context.l10n.composerVisionModel,
            value: runtimeConfig.visionModel == null
                ? context.l10n.commonNotConfigured
                : shortenModelId(runtimeConfig.visionModel!.modelId),
            enabled: canEdit,
            onTap: !canEdit
                ? null
                : () => showComposerVisionModelPickerSheet(
                    context,
                    runtimeConfig: runtimeConfig,
                    threadId: threadId,
                    canEdit: canEdit,
                    onChanged: onChanged,
                    mainAgentConfigId: mainAgentConfigId,
                  ),
          ),
        ],
      ],
    );
  }
}

class _OrchestrationPickerOption {
  const _OrchestrationPickerOption({
    required this.value,
    required this.title,
    this.subtitle,
  });

  final String value;
  final String title;
  final String? subtitle;
}

class _OrchestrationPickerRow extends StatelessWidget {
  const _OrchestrationPickerRow({
    required this.label,
    required this.value,
    this.detail,
    required this.enabled,
    this.onTap,
  });

  final String label;
  final String value;
  final String? detail;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final canTap = enabled && onTap != null;
    final valueColor = enabled ? colors.textSecondary : colors.textMuted;

    return EcoGroupedTile(
      onTap: canTap
          ? () {
              HapticFeedback.selectionClick();
              onTap!();
            }
          : null,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                fontSize: 17,
                letterSpacing: -0.2,
                color: enabled ? colors.textPrimary : colors.textMuted,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 7,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Flexible(
                  child: Text(
                    value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: valueColor,
                      fontSize: 15,
                      letterSpacing: -0.1,
                      height: 1.2,
                    ),
                  ),
                ),
                if (detail != null && detail!.trim().isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      detail!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.textMuted,
                        fontSize: 13,
                        letterSpacing: -0.08,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
                if (canTap) ...[
                  const SizedBox(width: 4),
                  Icon(
                    EcoIcons.chevronRight,
                    size: 16,
                    color: colors.textMuted.withValues(alpha: 0.7),
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

Future<void> _showOrchestrationOptionSheet(
  BuildContext context, {
  required String title,
  required List<_OrchestrationPickerOption> options,
  required String selectedValue,
  required ValueChanged<String> onSelected,
}) {
  return showEcoActionSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: title,
      maxHeightFactor: 0.62,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          EcoGroupedSection(
            topSpacing: 4,
            child: Column(
              children: [
                for (var i = 0; i < options.length; i++) ...[
                  if (i > 0) const EcoGroupedDivider(indent: 16),
                  EcoSheetOptionTile(
                    title: options[i].title,
                    subtitle: options[i].subtitle,
                    selected: options[i].value == selectedValue,
                    onTap: () {
                      HapticFeedback.selectionClick();
                      onSelected(options[i].value);
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

class _ComposerSubagentSwitchList extends ConsumerWidget {
  const _ComposerSubagentSwitchList({
    required this.fallbackConfig,
    required this.threadId,
    required this.snapshot,
    required this.canEdit,
    required this.onChanged,
  });

  final ThreadRuntimeConfigInput fallbackConfig;
  final String threadId;
  final ResolvedOrchestrationSnapshot? snapshot;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtimeConfig = watchedComposerRuntimeConfig(ref, fallbackConfig);
    final roles = configuredOrchestrationSubagentRoles(snapshot);
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
              final toggleable =
                  canEdit && isSubagentToggleable(snapshot, role);
              final configured = isSubagentConfiguredInSnapshot(snapshot, role);
              return EcoSheetSwitchTile(
                title: _subagentRoleLabels[role] ?? role,
                subtitle: !configured
                    ? context.l10n.composerOrchestrationNotConfigured
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

ThreadRuntimeConfigInput watchedComposerRuntimeConfig(
  WidgetRef ref,
  ThreadRuntimeConfigInput fallback,
) {
  return ref.watch(runtimeConfigProvider) ?? fallback;
}

enum _ComposerRouteCategory {
  agent,
  model,
  auxiliaryModel,
  visionModel,
  mcp,
  skills,
  orchestration,
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
  late String? _coreKind = widget.coreKind;

  ThreadRuntimeConfigInput get fallbackConfig => widget.fallbackConfig;
  String get threadId => widget.threadId;
  bool get canEdit => widget.canEdit;
  ValueChanged<ThreadRuntimeConfigInput> get onChanged => widget.onChanged;
  String get workspacePath => widget.workspacePath;
  String? get coreKind => _coreKind;
  ValueChanged<String>? get onCoreKindChanged => widget.onCoreKindChanged;

  @override
  void didUpdateWidget(covariant ComposerRouteSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Parent may push a new coreKind after the sheet is already open (rare,
    // but keep local selection in sync if it does).
    if (oldWidget.coreKind != widget.coreKind && widget.coreKind != _coreKind) {
      _coreKind = widget.coreKind;
    }
  }

  void _selectCoreKind(String value) {
    if (_coreKind == value) return;
    HapticFeedback.selectionClick();
    // Update local state immediately so the open sheet reflects the change
    // without waiting for the parent route to rebuild (modal sheets don't).
    setState(() => _coreKind = value);
    onCoreKindChanged?.call(value);
  }

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
      snapshot: resolveThreadOrchestrationSnapshot(
        modelSettings,
        runtimeConfig,
      ),
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
    final snapshot = resolveThreadOrchestrationSnapshot(
      modelSettings,
      runtimeConfig,
    );
    final templateModel = snapshot?.mainAgent.modelRef;
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
        value: _ComposerRouteCategory.auxiliaryModel,
        label: context.l10n.composerAuxiliaryModel,
        summary: runtimeConfig.auxiliaryModel == null
            ? context.l10n.commonNotConfigured
            : shortenModelId(runtimeConfig.auxiliaryModel!.modelId),
        icon: EcoIcons.contextMemory,
      ),
      (
        value: _ComposerRouteCategory.visionModel,
        label: context.l10n.composerVisionModel,
        summary: runtimeConfig.visionModel == null
            ? context.l10n.commonNotConfigured
            : shortenModelId(runtimeConfig.visionModel!.modelId),
        icon: EcoIcons.contextMemory,
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
        value: _ComposerRouteCategory.orchestration,
        label: context.l10n.composerOrchestration,
        summary:
            orchestrationCompositionSummary(
              modelSettings,
              runtimeConfig,
            ).isEmpty
            ? context.l10n.commonNotConfigured
            : orchestrationCompositionSummary(modelSettings, runtimeConfig),
        icon: EcoIcons.orchestration,
      ),
      (
        value: _ComposerRouteCategory.subagents,
        label: context.l10n.composerSubagents,
        summary: _firstEnabledSubagentLabel(
          runtimeConfig,
          snapshot,
          context.l10n,
        ),
        icon: EcoIcons.subagents,
      ),
    ];
    final selected = categories.firstWhere(
      (category) => category.value == _selectedCategory,
    );

    return EcoSheetScaffold(
      title: context.l10n.composerOrchestrationComponents,
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
                                  : () =>
                                        _selectCoreKind(_coreOptions[i].value),
                            ),
                          ],
                        ],
                      ),
                    ),
                  if (_selectedCategory ==
                          _ComposerRouteCategory.orchestration &&
                      modelSettings != null &&
                      modelSettings.mainAgentConfigs.isNotEmpty)
                    EcoGroupedSection(
                      label: context.l10n.composerOrchestration,
                      topSpacing: coreKind == null ? 4 : 20,
                      child: OrchestrationCompositionSelectors(
                        settings: modelSettings,
                        runtimeConfig: runtimeConfig,
                        threadId: threadId,
                        canEdit: canEdit,
                        onChanged: onChanged,
                        workspacePath: workspacePath,
                        mcpServers: mcpServers,
                        rememberedMcp: workflow?.mcpServersEnabled,
                      ),
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.model &&
                      templateModel != null &&
                      modelProvider?.enabled == true)
                    _ComposerTemporaryModelSection(
                      runtimeConfig: runtimeConfig,
                      threadId: threadId,
                      canEdit: canEdit,
                      onChanged: onChanged,
                      provider: modelProvider!,
                      templateModel: templateModel,
                    ),
                  if (_selectedCategory ==
                          _ComposerRouteCategory.auxiliaryModel &&
                      runtimeConfig.orchestrationSelection?.mainAgentConfigId
                              .trim()
                              .isNotEmpty ==
                          true)
                    ComposerAuxiliaryModelSection(
                      runtimeConfig: runtimeConfig,
                      threadId: threadId,
                      canEdit: canEdit,
                      onChanged: onChanged,
                      mainAgentConfigId: runtimeConfig
                          .orchestrationSelection!
                          .mainAgentConfigId,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.visionModel &&
                      runtimeConfig.orchestrationSelection?.mainAgentConfigId
                              .trim()
                              .isNotEmpty ==
                          true)
                    ComposerVisionModelSection(
                      runtimeConfig: runtimeConfig,
                      threadId: threadId,
                      canEdit: canEdit,
                      onChanged: onChanged,
                      mainAgentConfigId: runtimeConfig
                          .orchestrationSelection!
                          .mainAgentConfigId,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.subagents)
                    EcoGroupedSection(
                      label: context.l10n.composerSubagents,
                      topSpacing: snapshot == null && coreKind == null ? 4 : 20,
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
                            snapshot: snapshot,
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
                  if (_selectedCategory ==
                          _ComposerRouteCategory.auxiliaryModel &&
                      runtimeConfig.orchestrationSelection?.mainAgentConfigId
                              .trim()
                              .isNotEmpty !=
                          true)
                    _ComposerRouteEmptyState(
                      message:
                          context.l10n.composerAuxiliaryModelNeedsMainAgent,
                    ),
                  if (_selectedCategory == _ComposerRouteCategory.visionModel &&
                      runtimeConfig.orchestrationSelection?.mainAgentConfigId
                              .trim()
                              .isNotEmpty !=
                          true)
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerVisionModelNeedsMainAgent,
                    ),
                  if (_selectedCategory ==
                          _ComposerRouteCategory.orchestration &&
                      (modelSettings?.mainAgentConfigs.isEmpty ?? true))
                    _ComposerRouteEmptyState(
                      message: context.l10n.composerNoOrchestrationResources,
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

String _firstEnabledSubagentLabel(
  ThreadRuntimeConfigInput runtimeConfig,
  ResolvedOrchestrationSnapshot? snapshot,
  AppLocalizations l10n,
) {
  for (final role in configuredOrchestrationSubagentRoles(snapshot)) {
    if (isRuntimeSubagentEnabled(runtimeConfig.subagentEnabled, role)) {
      return _subagentRoleLabels[role] ?? role;
    }
  }
  return l10n.composerNotEnabled;
}

class ComposerAuxiliaryModelSection extends ConsumerWidget {
  const ComposerAuxiliaryModelSection({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    required this.mainAgentConfigId,
    this.closeOnSelect = true,
    this.topSpacing = 20,
    this.showSectionHeader = true,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final String mainAgentConfigId;
  final bool closeOnSelect;
  final double topSpacing;
  final bool showSectionHeader;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final options = ref.watch(auxiliaryModelOptionsProvider(mainAgentConfigId));

    void select(CommitModelOptionView? option) {
      final selection = option == null
          ? null
          : AuxiliaryModelSelection(
              providerId: option.providerId,
              modelId: option.modelId,
              candidateModelId: option.candidateModelId,
            );
      var next = option == null
          ? runtimeConfig.copyWith(clearAuxiliaryModel: true)
          : runtimeConfig.copyWith(auxiliaryModel: selection);
      next = downgradeAuxiliaryDependentFeatures(next);
      persistRuntimeConfig(
        ref,
        threadId: threadId,
        config: next,
        onChanged: onChanged,
      );
      persistAuxiliaryModelWorkflowDefault(
        ref,
        selection: selection,
      ).catchError((_) {});
      if (closeOnSelect) {
        Navigator.pop(context);
      }
    }

    if (mainAgentConfigId.trim().isEmpty) {
      return _auxiliaryModelSection(
        context,
        child: EcoGroupedTile(
          child: Text(context.l10n.composerAuxiliaryModelNeedsMainAgent),
        ),
      );
    }

    return _auxiliaryModelSection(
      context,
      child: Column(
        children: [
          EcoSheetOptionTile(
            title: context.l10n.commonNotConfigured,
            subtitle: context.l10n.composerAuxiliaryModelManualFallback,
            selected: runtimeConfig.auxiliaryModel == null,
            enabled: canEdit,
            onTap: !canEdit ? null : () => select(null),
          ),
          options.when(
            data: (items) => Column(
              children: [
                for (final option in items) ...[
                  const EcoGroupedDivider(indent: 16),
                  EcoSheetOptionTile(
                    title: '${option.providerName} · ${option.modelLabel}',
                    subtitle: option.modelId,
                    selected:
                        runtimeConfig.auxiliaryModel?.candidateModelId ==
                        option.candidateModelId,
                    enabled: canEdit,
                    onTap: !canEdit ? null : () => select(option),
                  ),
                ],
              ],
            ),
            loading: () => const Column(
              children: [
                EcoGroupedDivider(indent: 16),
                EcoGroupedTile(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 2),
                    child: LinearProgressIndicator(minHeight: 2),
                  ),
                ),
              ],
            ),
            error: (_, _) => Column(
              children: [
                const EcoGroupedDivider(indent: 16),
                EcoGroupedTile(
                  child: Text(context.l10n.composerModelLoadFailed),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _auxiliaryModelSection(BuildContext context, {required Widget child}) {
    return EcoGroupedSection(
      label: showSectionHeader ? context.l10n.composerAuxiliaryModel : null,
      caption: showSectionHeader
          ? context.l10n.composerAuxiliaryModelHint
          : null,
      topSpacing: topSpacing,
      child: child,
    );
  }
}

Future<void> showComposerAuxiliaryModelPickerSheet(
  BuildContext context, {
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required bool canEdit,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  required String mainAgentConfigId,
}) {
  return showEcoActionSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: context.l10n.composerAuxiliaryModel,
      subtitle: context.l10n.composerAuxiliaryModelHint,
      maxHeightFactor: 0.7,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          ComposerAuxiliaryModelSection(
            runtimeConfig: runtimeConfig,
            threadId: threadId,
            canEdit: canEdit,
            onChanged: onChanged,
            mainAgentConfigId: mainAgentConfigId,
            topSpacing: 4,
            showSectionHeader: false,
          ),
        ],
      ),
    ),
  );
}

class ComposerVisionModelSection extends ConsumerWidget {
  const ComposerVisionModelSection({
    super.key,
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    required this.mainAgentConfigId,
    this.closeOnSelect = true,
    this.topSpacing = 20,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final String mainAgentConfigId;
  final bool closeOnSelect;
  final double topSpacing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final options = ref.watch(auxiliaryModelOptionsProvider(mainAgentConfigId));

    void select(CommitModelOptionView? option) {
      final selection = option == null
          ? null
          : VisionModelSelection(
              providerId: option.providerId,
              modelId: option.modelId,
              candidateModelId: option.candidateModelId,
            );
      final next = option == null
          ? runtimeConfig.copyWith(clearVisionModel: true)
          : runtimeConfig.copyWith(visionModel: selection);
      persistRuntimeConfig(
        ref,
        threadId: threadId,
        config: next,
        onChanged: onChanged,
      );
      persistVisionModelWorkflowDefault(
        ref,
        selection: selection,
      ).catchError((_) {});
      if (closeOnSelect) {
        Navigator.pop(context);
      }
    }

    if (mainAgentConfigId.trim().isEmpty) {
      return EcoGroupedSection(
        label: context.l10n.composerVisionModel,
        caption: context.l10n.composerVisionModelHint,
        topSpacing: topSpacing,
        child: EcoGroupedTile(
          child: Text(context.l10n.composerVisionModelNeedsMainAgent),
        ),
      );
    }

    return EcoGroupedSection(
      label: context.l10n.composerVisionModel,
      caption: context.l10n.composerVisionModelHint,
      topSpacing: topSpacing,
      child: Column(
        children: [
          EcoSheetOptionTile(
            title: context.l10n.commonNotConfigured,
            subtitle: context.l10n.composerVisionModelFollowMain,
            selected: runtimeConfig.visionModel == null,
            enabled: canEdit,
            onTap: !canEdit ? null : () => select(null),
          ),
          options.when(
            data: (items) => Column(
              children: [
                for (final option in items) ...[
                  const EcoGroupedDivider(indent: 16),
                  EcoSheetOptionTile(
                    title: '${option.providerName} · ${option.modelLabel}',
                    subtitle: option.modelId,
                    selected:
                        runtimeConfig.visionModel?.candidateModelId ==
                        option.candidateModelId,
                    enabled: canEdit,
                    onTap: !canEdit ? null : () => select(option),
                  ),
                ],
              ],
            ),
            loading: () => const Column(
              children: [
                EcoGroupedDivider(indent: 16),
                EcoGroupedTile(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 2),
                    child: LinearProgressIndicator(minHeight: 2),
                  ),
                ),
              ],
            ),
            error: (_, _) => Column(
              children: [
                const EcoGroupedDivider(indent: 16),
                EcoGroupedTile(
                  child: Text(context.l10n.composerModelLoadFailed),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

Future<void> showComposerVisionModelPickerSheet(
  BuildContext context, {
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required bool canEdit,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  required String mainAgentConfigId,
}) {
  return showEcoActionSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: context.l10n.composerVisionModel,
      subtitle: context.l10n.composerVisionModelHint,
      maxHeightFactor: 0.7,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          ComposerVisionModelSection(
            runtimeConfig: runtimeConfig,
            threadId: threadId,
            canEdit: canEdit,
            onChanged: onChanged,
            mainAgentConfigId: mainAgentConfigId,
            topSpacing: 4,
          ),
        ],
      ),
    ),
  );
}

class _ComposerTemporaryModelSection extends ConsumerWidget {
  const _ComposerTemporaryModelSection({
    required this.runtimeConfig,
    required this.threadId,
    required this.canEdit,
    required this.onChanged,
    required this.provider,
    required this.templateModel,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ModelProviderView provider;
  final OrchestrationModelRef templateModel;

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
        EcoGroupedSection(
          label: context.l10n.composerModel,
          topSpacing: 20,
          footer: canEdit
              ? context.l10n.composerModelCandidatesHint
              : context.l10n.composerModelLocked,
          child: Column(
            children: [
              EcoSheetOptionTile(
                title: context.l10n.composerFollowOrchestration,
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
                    selected: composerTemporaryModelSelected(override, option),
                    enabled: canEdit,
                    onTap: !canEdit
                        ? null
                        : () => selectOverride(
                            buildComposerTemporaryModelOverride(
                              model: option,
                              thinkingEffort: option.supportsReasoning == false
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

class ComposerCompositionControl extends ConsumerWidget {
  const ComposerCompositionControl({
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
    final label = orchestrationCompositionSummary(modelSettings, runtimeConfig);
    final displayLabel = label.isEmpty
        ? context.l10n.composerSelectOrchestration
        : label;

    return ComposerContextTrigger(
      icon: EcoIcons.orchestration,
      label: displayLabel,
      enabled: canEdit,
      compact: compact,
      onTap: canEdit
          ? () => _showCompositionSheet(
              context,
              ref,
              runtimeConfig: runtimeConfig,
              threadId: threadId,
              onChanged: onChanged,
            )
          : null,
    );
  }

  Future<void> _showCompositionSheet(
    BuildContext context,
    WidgetRef ref, {
    required ThreadRuntimeConfigInput runtimeConfig,
    required String threadId,
    required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  }) async {
    final settings = await ref.read(modelSettingsProvider.future);
    final workflow = await ref.read(workflowSettingsProvider.future);
    final mcpServers = await ref.read(mcpSettingsProvider.future);
    if (settings == null ||
        settings.mainAgentConfigs.isEmpty ||
        !context.mounted) {
      return;
    }

    await showEcoActionSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => EcoSheetScaffold(
        title: context.l10n.composerSelectOrchestrationSelection,
        maxHeightFactor: 0.7,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            EcoGroupedSection(
              topSpacing: 4,
              child: OrchestrationCompositionSelectors(
                settings: settings,
                runtimeConfig: runtimeConfig,
                threadId: threadId,
                canEdit: true,
                onChanged: onChanged,
                workspacePath: '',
                mcpServers: mcpServers?.servers ?? const [],
                rememberedMcp: workflow?.mcpServersEnabled,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> persistProjectOrchestrationSelection(
  WidgetRef ref, {
  required String workspacePath,
  required OrchestrationSelection selection,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null || workspacePath.trim().isEmpty) return;
  try {
    await rpc.saveProjectOrchestrationSettings(
      ProjectOrchestrationSettingsSnapshot(
        workspacePath: workspacePath,
        orchestrationSelection: selection,
      ),
    );
    ref.invalidate(projectOrchestrationSettingsProvider(workspacePath));
  } catch (_) {
    // The local new-thread selection remains usable when persistence fails.
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
    final snapshot = resolveThreadOrchestrationSnapshot(
      modelSettings,
      runtimeConfig,
    );
    final enabledCount = countEnabledSubagents(runtimeConfig.subagentEnabled);
    final totalCount = countConfiguredSubagents(snapshot);
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
              snapshot: snapshot,
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
    required ResolvedOrchestrationSnapshot? snapshot,
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
                    snapshot: snapshot,
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
    this.billing,
    this.showBilling = false,
    this.contextSnapshot,
    this.threadStatus,
    this.workspacePath = '',
    this.coreKind,
    this.onCoreKindChanged,
    this.showRouteControl = true,
  });

  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool canEdit;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ThreadBillingSnapshot? billing;
  final bool showBilling;
  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;
  final String workspacePath;
  final String? coreKind;
  final ValueChanged<String>? onCoreKindChanged;
  final bool showRouteControl;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final snapshot = resolveThreadOrchestrationSnapshot(
      modelSettings,
      runtimeConfig,
    );
    final themeSource = SubagentThemeSource.fromSnapshot(snapshot);
    final currentMainModelId =
        runtimeConfig.mainAgentModelOverride?.modelId ??
        snapshot?.mainAgent.modelRef.modelId;
    final occupancyPct = resolvePlannerOccupancyPct(contextSnapshot);
    final modelTooltip = currentMainModelId?.trim();
    final thinkingTooltip = snapshot == null
        ? null
        : _thinkingEffortLabel(
            composerTemporaryModelEffort(
              runtimeConfig.mainAgentModelOverride,
              snapshot.mainAgent.modelRef,
            ),
            context.l10n,
          );
    final routeTooltip = [
      if (modelTooltip != null && modelTooltip.isNotEmpty)
        shortenModelId(modelTooltip),
      ?thinkingTooltip,
    ].join(' · ');

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showBilling)
          ComposerToolbarIconButton(
            onPressed: () => showThreadBillingSheet(
              context: context,
              billing: billing,
              threadStatus: threadStatus,
              currentMainModelId: currentMainModelId,
            ),
            tooltip: formatBillingPillCost(billing),
            icon: ComposerToolbarIcon(
              icon: EcoIcons.usageCost,
              color: ecoColors(context).textSecondary,
            ),
          ),
        if (contextSnapshot != null)
          ComposerToolbarIconButton(
            onPressed: () => showThreadContextSheet(
              context: context,
              contextSnapshot: contextSnapshot,
              threadStatus: threadStatus,
              themeSource: themeSource,
            ),
            tooltip: '$occupancyPct%',
            icon: ComposerContextRing(
              pct: occupancyPct ?? 0,
              size: kComposerToolbarIconSize,
            ),
          ),
        if (showRouteControl)
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
            tooltip: routeTooltip.isEmpty ? null : routeTooltip,
            icon: ComposerToolbarIcon(
              icon: EcoIcons.orchestration,
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
                      final option = bashReviewUiOptions(context.l10n)[i];
                      if (option.value == 'auto' &&
                          runtimeConfig.auxiliaryModel == null) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              context.l10n.auxiliaryModelRequiredForAutoReview,
                            ),
                          ),
                        );
                        return;
                      }
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
        color: ecoColors(context).textSecondary,
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
