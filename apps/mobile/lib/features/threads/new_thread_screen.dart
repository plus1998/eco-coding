import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
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

  @override
  void initState() {
    super.initState();
    _promptController.addListener(() => setState(() {}));
    _initRuntimeConfig();
  }

  Future<void> _initRuntimeConfig() async {
    if (ref.read(runtimeConfigProvider) != null) return;
    final modelSettings = await ref.read(modelSettingsProvider.future);
    final workflow = await ref.read(workflowSettingsProvider.future);
    final mcpSettings = await ref.read(mcpSettingsProvider.future);
    if (!mounted) return;
    ref.read(runtimeConfigProvider.notifier).state = buildDefaultRuntimeConfig(
      modelSettings: modelSettings,
      workflow: workflow,
      mcpServers: mcpSettings?.servers,
    );
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final workspacePath = ref.watch(selectedProjectPathProvider).valueOrNull ?? '';
    final modelSettings = ref.watch(modelSettingsProvider);
    final workflow = ref.watch(workflowSettingsProvider);
    final mcpSettings = ref.watch(mcpSettingsProvider);
    final runtimeConfig = ref.watch(runtimeConfigProvider) ??
        buildDefaultRuntimeConfig(
          modelSettings: modelSettings.valueOrNull,
          workflow: workflow.valueOrNull,
          mcpServers: mcpSettings.valueOrNull?.servers,
        );
    final gitStatusAsync = workspacePath.isNotEmpty
        ? ref.watch(gitStatusProvider(workspacePath))
        : const AsyncValue<GitWorkingTreeStatus?>.data(null);
    final gitStatus = gitStatusAsync.valueOrNull;
    final workspaceChanges = gitStatus?.toChangesSummary();
    final changesLoading = gitStatusAsync.isLoading || gitStatusAsync.isReloading;
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
      appBar: buildThreadSessionAppBar(
        context,
        ref,
        title: '新建会话',
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
                    sessionToolbarFrostHeight(context),
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
                      ),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            height: 1.35,
                          ),
                    ),
                  ),
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
                    child: ComposerDockShell(
                      child: Column(
                      mainAxisSize: MainAxisSize.min,
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
                        SessionComposer(
                          controller: _promptController,
                          attachments: _attachments,
                          runtimeConfig: runtimeConfig,
                          threadId: '',
                          isRunning: _starting,
                          hasActivity: false,
                          inputHint: composerLandingPlaceholder,
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
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
    );
  }

  Future<void> _pickImage() async {
    final file = await _picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() {
      _attachments.add(
        PromptImageAttachment(
          mediaType: 'image/${file.path.split('.').last}',
          data: base64Encode(bytes),
        ),
      );
    });
  }

  Future<void> _startThread() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;

    final rpc = ref.read(desktopRpcProvider);
    final workspacePath = ref.read(selectedProjectPathProvider).valueOrNull;
    final runtimeConfig = ref.read(runtimeConfigProvider);
    if (rpc == null || workspacePath == null || workspacePath.isEmpty) return;
    if (runtimeConfig == null) return;

    setState(() => _starting = true);
    try {
      final thread = await rpc.startThread(
        workspacePath: workspacePath,
        prompt: prompt,
        attachments: _attachments.isEmpty ? null : List.of(_attachments),
        runtimeConfig: runtimeConfig,
      );
      ref.invalidate(threadListProvider);
      ref.invalidate(projectWorkspaceContextProvider);
      if (mounted) {
        context.go('/threads/${thread.id}');
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }
}
