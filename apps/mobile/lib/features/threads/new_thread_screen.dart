import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/theme/eco_theme.dart';
import '../composer/session_composer.dart';
import '../projects/project_providers.dart';
import 'thread_providers.dart';
import 'thread_session_menu.dart';

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
    if (!mounted) return;
    ref.read(runtimeConfigProvider.notifier).state =
        defaultRuntimeConfig(modelSettings: modelSettings, workflow: workflow);
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
    final runtimeConfig = ref.watch(runtimeConfigProvider) ??
        buildDefaultRuntimeConfig(
          modelSettings: modelSettings.valueOrNull,
          workflow: workflow.valueOrNull,
        );
    final workspaceDiffAsync = workspacePath.isNotEmpty
        ? ref.watch(workspaceDiffProvider(workspacePath))
        : const AsyncValue<WorkspaceDiffResult?>.data(null);
    final gitStatusAsync = workspacePath.isNotEmpty
        ? ref.watch(gitStatusProvider(workspacePath))
        : const AsyncValue<GitWorkingTreeStatus?>.data(null);
    final gitStatus = gitStatusAsync.valueOrNull;
    final projectsAsync = ref.watch(projectListProvider);
    EcoProject? project;
    for (final item in projectsAsync.valueOrNull ?? const <EcoProject>[]) {
      if (item.path == workspacePath) {
        project = item;
        break;
      }
    }

    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '新建会话',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    height: 1.2,
                  ),
            ),
            if (workspacePath.isNotEmpty)
              GestureDetector(
                onLongPress: () {
                  Clipboard.setData(ClipboardData(text: workspacePath));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('工作目录已复制')),
                  );
                },
                child: Text(
                  '${project?.name ?? workspaceDisplayName(workspacePath)} · $workspacePath',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: ecoThemeExtras(context).textMuted,
                      ),
                ),
              ),
          ],
        ),
        actions: [
          ThreadSessionMenuButton(
            workspacePath: workspacePath,
            runtimeConfig: runtimeConfig,
            isRunning: _starting,
            gitStatus: gitStatus,
          ),
        ],
      ),
      body: ref.watch(runtimeConfigProvider) == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 32),
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
                ),
                SessionComposer(
                  controller: _promptController,
                  attachments: _attachments,
                  runtimeConfig: runtimeConfig,
                  threadId: '',
                  isRunning: _starting,
                  hasActivity: false,
                  inputHint: composerLandingPlaceholder,
                  workspaceDiff: workspaceDiffAsync.valueOrNull,
                  diffLoading: workspaceDiffAsync.isLoading,
                  onPickImage: _pickImage,
                  onRemoveAttachment: (index) =>
                      setState(() => _attachments.removeAt(index)),
                  onSend: _startThread,
                  onStop: () {},
                  onRuntimeConfigChanged: (config) {
                    ref.read(runtimeConfigProvider.notifier).state = config;
                  },
                  onChangesTap: null,
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
      ref.invalidate(projectListProvider);
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
