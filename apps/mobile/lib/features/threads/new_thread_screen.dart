import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/locale/app_error_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/project_orchestration_settings.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/prompt_image_attachment.dart';
import '../composer/composer_dock_shell.dart';
import '../composer/session_composer.dart';
import '../composer/workspace_changes_pill.dart';
import '../projects/project_providers.dart';
import 'thread_menu_sheets.dart';
import 'thread_providers.dart';
import 'thread_session_app_bar.dart';

class NewThreadScreen extends ConsumerStatefulWidget {
  const NewThreadScreen({super.key});

  @override
  ConsumerState<NewThreadScreen> createState() => _NewThreadScreenState();
}

class _NewThreadScreenState extends ConsumerState<NewThreadScreen> {
  final _promptController = TextEditingController();
  final _attachments = <PromptImageAttachment>[];
  final _picker = ImagePicker();
  var _starting = false;
  var _coreKind = 'claude';
  String? _runtimeConfigScope;

  @override
  void initState() {
    super.initState();
    _promptController.addListener(() => setState(() {}));
    _initRuntimeConfig();
  }

  Future<void> _initRuntimeConfig() async {
    final currentDesktopId = ref.read(selectedDesktopIdProvider);
    final workspacePath = await ref.read(selectedProjectPathProvider.future);
    final scope = '$currentDesktopId:${workspacePath ?? ''}';
    final existing = ref.read(runtimeConfigProvider);
    if (existing != null && _runtimeConfigScope == scope) return;

    _runtimeConfigScope = scope;
    final modelSettings = await ref.read(modelSettingsProvider.future);
    final workflow = await ref.read(workflowSettingsProvider.future);
    final mcpSettings = await ref.read(mcpSettingsProvider.future);
    final projectOrchestration = workspacePath == null || workspacePath.isEmpty
        ? null
        : await ref.read(
            projectOrchestrationSettingsProvider(workspacePath).future,
          );
    if (!mounted || _runtimeConfigScope != scope) return;
    _coreKind = workflow?.defaultCoreKind ?? 'claude';
    ref.read(runtimeConfigProvider.notifier).state = buildDefaultRuntimeConfig(
      modelSettings: modelSettings,
      workflow: workflow,
      mcpServers: mcpSettings?.servers,
      orchestrationSelection: projectOrchestration?.orchestrationSelection,
      coreKind: _coreKind,
    );
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // When the selected desktop changes, clear the runtime config so it
    // re-derives from the newly-selected desktop's model/MCP settings.
    ref.listen(selectedDesktopIdProvider, (previous, next) {
      if (previous != null && previous != next) {
        ref.read(runtimeConfigProvider.notifier).state = null;
        _runtimeConfigScope = null;
        _initRuntimeConfig();
      }
    });

    final workspacePath =
        ref.watch(selectedProjectPathProvider).valueOrNull ?? '';
    ref.listen(selectedProjectPathProvider, (previous, next) {
      if (previous?.valueOrNull != next.valueOrNull) {
        ref.read(runtimeConfigProvider.notifier).state = null;
        _runtimeConfigScope = null;
        _initRuntimeConfig();
      }
    });
    final modelSettings = ref.watch(modelSettingsProvider);
    final workflow = ref.watch(workflowSettingsProvider);
    final mcpSettings = ref.watch(mcpSettingsProvider);
    final projectOrchestration = workspacePath.isEmpty
        ? const AsyncValue<ProjectOrchestrationSettingsSnapshot?>.data(null)
        : ref.watch(projectOrchestrationSettingsProvider(workspacePath));
    final runtimeConfig =
        ref.watch(runtimeConfigProvider) ??
        (projectOrchestration.hasValue
            ? buildDefaultRuntimeConfig(
                modelSettings: modelSettings.valueOrNull,
                workflow: workflow.valueOrNull,
                mcpServers: mcpSettings.valueOrNull?.servers,
                orchestrationSelection:
                    projectOrchestration.valueOrNull?.orchestrationSelection,
                coreKind: _coreKind,
              )
            : ThreadRuntimeConfig(
                subagentEnabled: defaultSubagentAvailability(),
                sessionMode: workflow.valueOrNull?.sessionMode ?? 'agent',
                bashReviewMode: 'always',
              ));
    final gitStatusAsync = workspacePath.isNotEmpty
        ? ref.watch(gitStatusProvider(workspacePath))
        : const AsyncValue<GitWorkingTreeStatus?>.data(null);
    final gitStatus = gitStatusAsync.valueOrNull;
    final workspaceChanges = ref.watch(
      workspacePillSummaryProvider(workspacePath),
    );
    final changesLoading = ref.watch(
      workspacePillLoadingProvider(workspacePath),
    );
    final projectsAsync = ref.watch(projectListProvider);
    EcoProject? project;
    for (final item in projectsAsync.valueOrNull ?? const <EcoProject>[]) {
      if (item.path == workspacePath) {
        project = item;
        break;
      }
    }

    return Scaffold(
      resizeToAvoidBottomInset: false,
      extendBodyBehindAppBar: true,
      backgroundColor: ecoColors(context).bgFeed,
      appBar: buildThreadSessionAppBar(
        context,
        ref,
        title: context.l10n.threadNew,
        workspacePath: workspacePath,
        projectName: project?.name,
        runtimeConfig: runtimeConfig,
        isRunning: _starting,
        gitStatus: gitStatus,
        showNewThreadAction: false,
      ),
      body: ref.watch(runtimeConfigProvider) == null
          ? const Center(child: CircularProgressIndicator())
          : Stack(
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(
                    32,
                    sessionContentTopPadding(context),
                    32,
                    180,
                  ),
                  child: Align(
                    alignment: Alignment.center,
                    child: Text(
                      landingHeroText(
                        workspacePath: workspacePath,
                        isHomeProject: project?.isHome ?? false,
                        projectName: project?.name,
                        l10n: context.l10n,
                      ),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w600, height: 1.35),
                    ),
                  ),
                ),
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: sessionToolbarFrostHeight(context),
                  child: const IgnorePointer(child: SessionTopFrostGradient()),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: AnimatedPadding(
                    duration: const Duration(milliseconds: 100),
                    curve: Curves.easeOut,
                    padding: EdgeInsets.only(
                      bottom: MediaQuery.viewInsetsOf(context).bottom,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        WorkspaceChangesPill(
                          summary: workspaceChanges,
                          busy: changesLoading,
                          onTap: workspacePath.isNotEmpty
                              ? () {
                                  refreshWorkspaceChanges(ref, workspacePath);
                                  showWorkspaceDiffReviewSheet(
                                    context: context,
                                    ref: ref,
                                    workspacePath: workspacePath,
                                  );
                                }
                              : null,
                        ),
                        ComposerDockShell(
                          child: SessionComposer(
                            controller: _promptController,
                            attachments: _attachments,
                            runtimeConfig: runtimeConfig,
                            threadId: '',
                            isRunning: false,
                            sendBusy: _starting,
                            hasActivity: false,
                            inputHint: composerLandingPlaceholder(context.l10n),
                            workspacePath: workspacePath,
                            coreKind: _coreKind,
                            onCoreKindChanged: (coreKind) {
                              _handleCoreKindChanged(coreKind);
                            },
                            onPickImage: _pickImage,
                            onRemoveAttachment: (index) =>
                                setState(() => _attachments.removeAt(index)),
                            onSend: _startThread,
                            onStop: () {},
                            onRuntimeConfigChanged: (config) {
                              ref.read(runtimeConfigProvider.notifier).state =
                                  config;
                            },
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

  void _handleCoreKindChanged(String coreKind) {
    final current = ref.read(runtimeConfigProvider);
    final modelSettings = ref.read(modelSettingsProvider).valueOrNull;
    final workflow = ref.read(workflowSettingsProvider).valueOrNull;
    final mcpSettings = ref.read(mcpSettingsProvider).valueOrNull;
    final workspacePath = ref.read(selectedProjectPathProvider).valueOrNull;
    final projectOrchestration = workspacePath == null || workspacePath.isEmpty
        ? null
        : ref
              .read(projectOrchestrationSettingsProvider(workspacePath))
              .valueOrNull;
    final next = coreKind == 'acp'
        ? buildAcpRuntimeConfig(
            workflow: workflow,
            cursorModelId: current?.cursorModelId,
            sessionMode: current?.sessionMode,
            bashReviewMode: current?.bashReviewMode,
            subagentEnabled: current?.subagentEnabled,
            auxiliaryModel: current?.auxiliaryModel,
            visionModel: current?.visionModel,
            mcpServersEnabled: current?.mcpServersEnabled,
            integrationsEnabled: current?.integrationsEnabled,
          )
        : buildDefaultRuntimeConfig(
            modelSettings: modelSettings,
            workflow: workflow,
            mcpServers: mcpSettings?.servers,
            orchestrationSelection:
                projectOrchestration?.orchestrationSelection,
            coreKind: coreKind,
          );
    ref.read(runtimeConfigProvider.notifier).state = next;
    setState(() => _coreKind = coreKind);
    _saveDefaultCoreKind(coreKind);
  }

  Future<void> _saveDefaultCoreKind(String coreKind) async {
    final rpc = ref.read(desktopRpcProvider);
    final workflow = ref.read(workflowSettingsProvider).valueOrNull;
    if (rpc == null || workflow == null) return;
    try {
      await rpc.saveWorkflowSettings(
        WorkflowSettingsSnapshot(
          sessionMode: workflow.sessionMode,
          defaultCoreKind: coreKind,
          acpCursorModelId: workflow.acpCursorModelId,
          showBilling: workflow.showBilling,
          contextWindowLimitTokens: workflow.contextWindowLimitTokens,
          maxOutputLimitTokens: workflow.maxOutputLimitTokens,
          defaultOrchestrationSelection: workflow.defaultOrchestrationSelection,
          defaultAuxiliaryModel: workflow.defaultAuxiliaryModel,
          defaultVisionModel: workflow.defaultVisionModel,
          mcpServersEnabled: workflow.mcpServersEnabled,
          integrationsEnabled: workflow.integrationsEnabled,
        ),
      );
      ref.invalidate(workflowSettingsProvider);
    } catch (_) {
      // The local selection still applies to this new thread.
    }
  }

  Future<void> _pickImage() async {
    final file = await _picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final attachment = await promptImageAttachmentFromXFile(file);
    if (!mounted) return;
    if (attachment == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.composerUnsupportedImage)),
      );
      return;
    }
    setState(() {
      _attachments.add(attachment);
    });
  }

  Future<void> _startThread() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;
    if (_starting) return;

    final rpc = ref.read(desktopRpcProvider);
    final workspacePath = ref.read(selectedProjectPathProvider).valueOrNull;
    final runtimeConfig = ref.read(runtimeConfigProvider);
    final modelSettings = ref.read(modelSettingsProvider).valueOrNull;
    if (rpc == null || workspacePath == null || workspacePath.isEmpty) return;
    if (runtimeConfig == null) return;
    if (!isThreadRuntimeConfigReady(
      modelSettings,
      runtimeConfig,
      coreKind: _coreKind,
    )) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.commonNotConfigured)),
        );
      }
      return;
    }

    setState(() => _starting = true);
    try {
      final sendRuntimeConfig = downgradeAuxiliaryDependentFeatures(
        runtimeConfig,
      );
      if (sendRuntimeConfig.bashReviewMode != runtimeConfig.bashReviewMode) {
        ref.read(runtimeConfigProvider.notifier).state = sendRuntimeConfig;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(context.l10n.auxiliaryModelAutoReviewFallback),
            ),
          );
        }
      }
      final thread = await rpc.startThread(
        workspacePath: workspacePath,
        prompt: prompt,
        coreKind: _coreKind,
        attachments: _attachments.isEmpty ? null : List.of(_attachments),
        runtimeConfig: sendRuntimeConfig,
      );
      ref.invalidate(threadListProvider);
      ref.invalidate(projectWorkspaceContextProvider);
      if (mounted) {
        context.go('/threads/${thread.id}');
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(localizedAppError(error, context.l10n))),
        );
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }
}
