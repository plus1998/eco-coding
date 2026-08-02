import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/session_mode.dart';
import '../../core/locale/app_error_localizations.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../threads/thread_providers.dart';

Future<void> saveSettingsSessionMode(
  WidgetRef ref, {
  required BuildContext context,
  required SessionMode nextMode,
}) async {
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) return;
  try {
    final workflow = await ref.read(workflowSettingsProvider.future);
    await rpc.saveWorkflowSettings(
      WorkflowSettingsSnapshot(
        sessionMode: nextMode,
        defaultCoreKind: workflow?.defaultCoreKind,
        contextWindowLimitTokens:
            workflow?.contextWindowLimitTokens ??
            defaultContextWindowLimitTokens,
        defaultOrchestrationSelection: workflow?.defaultOrchestrationSelection,
        defaultAuxiliaryModel: workflow?.defaultAuxiliaryModel,
        defaultVisionModel: workflow?.defaultVisionModel,
        mcpServersEnabled: workflow?.mcpServersEnabled,
      ),
    );
    ref.invalidate(workflowSettingsProvider);
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(localizedAppError(error, context.l10n))),
      );
    }
  }
}

Future<void> saveSettingsContextWindowLimit(
  WidgetRef ref, {
  required BuildContext context,
  required int nextLimit,
  required int previousLimit,
  required ValueChanged<int> onOptimistic,
  required ValueChanged<int> onRevert,
}) async {
  if (nextLimit == previousLimit) return;
  onOptimistic(nextLimit);
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) {
    onRevert(previousLimit);
    return;
  }
  try {
    final workflow = await ref.read(workflowSettingsProvider.future);
    await rpc.saveWorkflowSettings(
      WorkflowSettingsSnapshot(
        sessionMode: workflow?.sessionMode ?? 'agent',
        defaultCoreKind: workflow?.defaultCoreKind,
        contextWindowLimitTokens: nextLimit,
        defaultOrchestrationSelection: workflow?.defaultOrchestrationSelection,
        defaultAuxiliaryModel: workflow?.defaultAuxiliaryModel,
        defaultVisionModel: workflow?.defaultVisionModel,
        mcpServersEnabled: workflow?.mcpServersEnabled,
      ),
    );
    ref.invalidate(workflowSettingsProvider);
  } catch (error) {
    onRevert(previousLimit);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(localizedAppError(error, context.l10n))),
      );
    }
  }
}

/// Queued write-back for global default orchestration selection.
class SettingsGlobalOrchestrationWriter {
  OrchestrationSelection? _pending;
  bool _saving = false;

  bool get saving => _saving;

  void queue(
    WidgetRef ref, {
    required BuildContext context,
    required ThreadRuntimeConfigInput config,
    required VoidCallback onSavingChanged,
  }) {
    final selection = config.orchestrationSelection;
    if (!hasCompleteOrchestrationSelection(selection)) return;
    _pending = selection;
    _flush(ref, context: context, onSavingChanged: onSavingChanged);
  }

  Future<void> _flush(
    WidgetRef ref, {
    required BuildContext context,
    required VoidCallback onSavingChanged,
  }) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null || _saving) return;
    _saving = true;
    onSavingChanged();
    try {
      while (_pending != null) {
        final selection = _pending!;
        _pending = null;
        final workflow = await ref.read(workflowSettingsProvider.future);
        await rpc.saveWorkflowSettings(
          WorkflowSettingsSnapshot(
            sessionMode: workflow?.sessionMode ?? 'agent',
            defaultCoreKind: workflow?.defaultCoreKind,
            contextWindowLimitTokens:
                workflow?.contextWindowLimitTokens ??
                defaultContextWindowLimitTokens,
            defaultOrchestrationSelection: selection,
            defaultAuxiliaryModel: workflow?.defaultAuxiliaryModel,
            defaultVisionModel: workflow?.defaultVisionModel,
            mcpServersEnabled: workflow?.mcpServersEnabled,
          ),
        );
      }
      ref.invalidate(workflowSettingsProvider);
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(localizedAppError(error, context.l10n))),
        );
      }
    } finally {
      _saving = false;
      onSavingChanged();
    }
  }
}

Future<ThreadRuntimeConfigInput> loadGlobalRuntimeConfig(WidgetRef ref) async {
  final workflow = await ref.read(workflowSettingsProvider.future);
  final modelSettings = await ref.read(modelSettingsProvider.future);
  final mcpSettings = await ref.read(mcpSettingsProvider.future);
  return buildDefaultRuntimeConfig(
    modelSettings: modelSettings,
    workflow: workflow,
    mcpServers: mcpSettings?.servers,
    orchestrationSelection: workflow?.defaultOrchestrationSelection,
  );
}
