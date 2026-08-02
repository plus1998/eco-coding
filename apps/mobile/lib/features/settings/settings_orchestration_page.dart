import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../composer/composer_controls.dart';
import '../threads/thread_providers.dart';
import 'settings_workflow_persistence.dart';

class SettingsOrchestrationPage extends ConsumerStatefulWidget {
  const SettingsOrchestrationPage({super.key});

  @override
  ConsumerState<SettingsOrchestrationPage> createState() =>
      _SettingsOrchestrationPageState();
}

class _SettingsOrchestrationPageState
    extends ConsumerState<SettingsOrchestrationPage> {
  final _writer = SettingsGlobalOrchestrationWriter();
  ThreadRuntimeConfigInput? _config;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final config = await loadGlobalRuntimeConfig(ref);
    if (!mounted) return;
    setState(() {
      _config = config;
      _loading = false;
    });
  }

  void _onChanged(ThreadRuntimeConfigInput config) {
    setState(() => _config = config);
    _writer.queue(
      ref,
      context: context,
      config: config,
      onSavingChanged: () {
        if (mounted) setState(() {});
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final desktopConnected = ref.watch(desktopRpcProvider) != null;
    final mcpServers =
        ref.watch(mcpSettingsProvider).valueOrNull?.servers ?? const [];
    final config = _config;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.composerOrchestration)),
      body: _loading || config == null
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : ListView(
              padding: EdgeInsets.only(
                bottom: MediaQuery.paddingOf(context).bottom + 24,
              ),
              children: [
                if (modelSettings != null &&
                    modelSettings.mainAgentConfigs.isNotEmpty)
                  EcoGroupedSection(
                    caption: desktopConnected
                        ? l10n.composerSelectOrchestrationSelection
                        : l10n.settingsConnectPcFirst,
                    topSpacing: 28,
                    child: OrchestrationCompositionSelectors(
                      settings: modelSettings,
                      runtimeConfig: config,
                      threadId: '',
                      canEdit: desktopConnected && !_writer.saving,
                      onChanged: _onChanged,
                      workspacePath: '',
                      mcpServers: mcpServers,
                      rememberedMcp: null,
                      showOrchestrationPickers: true,
                      showAuxiliaryModelPicker: false,
                      showVisionModelPicker: false,
                    ),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 40, 20, 0),
                    child: Text(
                      desktopConnected
                          ? l10n.composerOrchestrationNotConfigured
                          : l10n.settingsConnectPcFirst,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
              ],
            ),
    );
  }
}
