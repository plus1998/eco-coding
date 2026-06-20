import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_title.dart';
import '../approvals/approval_sheets.dart';
import '../composer/commit_push_sheet.dart';
import '../composer/session_composer.dart';
import '../projects/project_providers.dart';
import 'activity_feed.dart';
import 'thread_providers.dart';

class ThreadSessionScreen extends ConsumerStatefulWidget {
  const ThreadSessionScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ThreadSessionScreen> createState() =>
      _ThreadSessionScreenState();
}

class _ThreadSessionScreenState extends ConsumerState<ThreadSessionScreen> {
  final _promptController = TextEditingController();
  final _scrollController = ScrollController();
  final _attachments = <PromptImageAttachment>[];
  final _picker = ImagePicker();
  String? _shownApprovalKey;

  @override
  void initState() {
    super.initState();
    _promptController.addListener(() => setState(() {}));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(runtimeConfigProvider.notifier).state = null;
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String? _approvalKey(ThreadSessionState session) {
    final thread = session.thread;
    if (thread == null) return null;
    if (session.pendingPlan != null &&
        thread.status == 'awaiting_plan' &&
        session.pendingPlan!.threadId == thread.id) {
      return 'plan:${session.pendingPlan!.threadId}';
    }
    if (session.pendingBash != null &&
        session.pendingBash!.threadId == thread.id) {
      return 'bash:${session.pendingBash!.toolUseId}';
    }
    if (session.pendingClarification != null &&
        session.pendingClarification!.threadId == thread.id) {
      return 'clarification:${session.pendingClarification!.toolUseId}';
    }
    return null;
  }

  bool _needsApprovalSheet(ThreadSessionState session) {
    return _approvalKey(session) != null;
  }

  bool _isRunning(ThreadSummary? thread) {
    if (thread == null) return false;
    return thread.status == 'running' || thread.status == 'queued';
  }

  @override
  void dispose() {
    _promptController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(threadSessionProvider(widget.threadId));
    final modelSettings = ref.watch(modelSettingsProvider);
    final workflow = ref.watch(workflowSettingsProvider);
    final runtimeConfig = ref.watch(runtimeConfigProvider) ??
        session.thread?.runtimeConfig ??
        buildDefaultRuntimeConfig(
          modelSettings: modelSettings.valueOrNull,
          workflow: workflow.valueOrNull,
        );
    final thread = session.thread;
    final workspacePath = thread?.workspacePath ?? '';
    final projectsAsync = ref.watch(projectListProvider);
    EcoProject? project;
    for (final item in projectsAsync.valueOrNull ?? const <EcoProject>[]) {
      if (item.path == workspacePath) {
        project = item;
        break;
      }
    }
    final showLanding = !session.loading &&
        session.error == null &&
        session.activities.isEmpty;
    final landingHero = landingHeroText(
      workspacePath: workspacePath.isEmpty ? null : workspacePath,
      isHomeProject: project?.isHome ?? false,
      projectName: project?.name,
    );
    final workspaceDiffAsync = workspacePath.isNotEmpty
        ? ref.watch(workspaceDiffProvider(workspacePath))
        : const AsyncValue<WorkspaceDiffResult?>.data(null);
    final isRunning = _isRunning(thread);
    final feedEntries = buildActivityFeed(
      lines: session.activities,
      threadPrompt: thread?.prompt,
      threadId: widget.threadId,
    );

    ref.listen(threadSessionProvider(widget.threadId), (previous, next) {
      if (next.loading) return;
      if (!_needsApprovalSheet(next)) {
        _shownApprovalKey = null;
      } else {
        final key = _approvalKey(next);
        if (key != null && key != _shownApprovalKey) {
          _shownApprovalKey = key;
          _showApprovalSheets(next);
        }
      }
      final previousFeed = previous == null
          ? 0
          : buildActivityFeed(
              lines: previous.activities,
              threadPrompt: previous.thread?.prompt,
              threadId: widget.threadId,
            ).length;
      final nextFeed = buildActivityFeed(
        lines: next.activities,
        threadPrompt: next.thread?.prompt,
        threadId: widget.threadId,
      ).length;
      if (previousFeed != nextFeed) {
        _scrollToBottom();
      }
    });

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              displayThreadTitle(
                title: thread?.title ?? '',
                prompt: thread?.prompt ?? '',
                fallback: '会话',
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
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
                  '${workspaceDisplayName(workspacePath)} · $workspacePath',
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
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: '编辑标题',
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('标题编辑即将支持')),
              );
            },
          ),
          PopupMenuButton<String>(
            onSelected: (value) => _handleMenu(value),
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'cancel', child: Text('取消运行')),
              PopupMenuItem(value: 'retry', child: Text('重试')),
              PopupMenuItem(value: 'refresh', child: Text('刷新待办')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: session.loading
                ? const Center(child: CircularProgressIndicator())
                : session.error != null
                    ? Center(child: Text(session.error!))
                    : showLanding
                        ? Center(
                            child: Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 32),
                              child: Text(
                                landingHero,
                                textAlign: TextAlign.center,
                                style: Theme.of(context)
                                    .textTheme
                                    .headlineSmall
                                    ?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      height: 1.35,
                                    ),
                              ),
                            ),
                          )
                        : Column(
                            children: [
                              Expanded(
                                child: ActivityFeedList(
                                  entries: feedEntries,
                                  scrollController: _scrollController,
                                ),
                              ),
                              if (isRunning) const _ThinkingIndicator(),
                            ],
                          ),
          ),
          if (session.followUps.isNotEmpty)
            _FollowUpBar(
              followUps: session.followUps,
              onCancel: (id) async {
                await ref.read(desktopRpcProvider)?.followUpCancel(
                      threadId: widget.threadId,
                      followUpId: id,
                    );
                await ref
                    .read(threadSessionProvider(widget.threadId).notifier)
                    .refreshPending();
              },
            ),
          SessionComposer(
            controller: _promptController,
            attachments: _attachments,
            runtimeConfig: runtimeConfig,
            threadId: widget.threadId,
            isRunning: isRunning,
            hasActivity: session.activities.isNotEmpty,
            inputHint: showLanding ? composerLandingPlaceholder : null,
            workspaceDiff: workspaceDiffAsync.valueOrNull,
            diffLoading: workspaceDiffAsync.isLoading,
            onPickImage: _pickImage,
            onRemoveAttachment: (index) =>
                setState(() => _attachments.removeAt(index)),
            onSend: () => _sendMessage(runtimeConfig),
            onStop: () => _handleMenu('cancel'),
            onRuntimeConfigChanged: (config) {
              ref.read(runtimeConfigProvider.notifier).state = config;
            },
            onChangesTap: workspaceDiffAsync.valueOrNull != null &&
                    workspacePath.isNotEmpty
                ? () => _openCommitPush(
                      workspacePath: workspacePath,
                      runtimeConfig: runtimeConfig,
                      diff: workspaceDiffAsync.valueOrNull!,
                    )
                : null,
          ),
        ],
      ),
    );
  }

  Future<void> _openCommitPush({
    required String workspacePath,
    required ThreadRuntimeConfigInput runtimeConfig,
    required WorkspaceDiffResult diff,
  }) async {
    final profileId =
        runtimeConfig.agentProfileId ?? runtimeConfig.routeProfileId;
    if (profileId.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('请先在 Composer 设置中选择 Agent Profile')),
        );
      }
      return;
    }

    GitWorkingTreeStatus? gitStatus;
    try {
      gitStatus = await ref.read(desktopRpcProvider)?.getGitStatus(workspacePath);
    } catch (_) {}

    if (!mounted) return;

    final committed = await showCommitPushSheet(
      context: context,
      ref: ref,
      workspacePath: workspacePath,
      profileId: profileId,
      diff: diff,
      branch: gitStatus?.branch,
    );

    if (committed == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已提交并推送到远程')),
      );
    }
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

  Future<void> _sendMessage(ThreadRuntimeConfigInput runtimeConfig) async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;

    try {
      await rpc.continueThread(
        threadId: widget.threadId,
        prompt: prompt,
        attachments: _attachments.isEmpty ? null : List.of(_attachments),
        runtimeConfig: runtimeConfig,
      );
      _promptController.clear();
      setState(() => _attachments.clear());
      ref.invalidate(threadListProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _handleMenu(String value) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    final notifier = ref.read(threadSessionProvider(widget.threadId).notifier);
    try {
      switch (value) {
        case 'cancel':
          await rpc.cancelThread(widget.threadId);
        case 'retry':
          await rpc.retryThread(widget.threadId);
        case 'refresh':
          await notifier.refreshPending();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  void _showApprovalSheets(ThreadSessionState session) {
    if (!_needsApprovalSheet(session)) return;
    final thread = session.thread;
    if (session.pendingPlan != null &&
        thread?.status == 'awaiting_plan' &&
        session.pendingPlan!.threadId == thread!.id) {
      showPlanApprovalSheet(
        context: context,
        plan: session.pendingPlan!,
        onApprove: () => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .approvePlan(),
        onDismiss: () => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .dismissPlan(),
      );
    } else if (session.pendingBash != null &&
        session.pendingBash!.threadId == thread?.id) {
      showBashApprovalSheet(
        context: context,
        request: session.pendingBash!,
        onResolve: (decision) => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .resolveBash(session.pendingBash!.toolUseId, decision),
      );
    } else if (session.pendingClarification != null &&
        session.pendingClarification!.threadId == thread?.id) {
      showClarificationSheet(
        context: context,
        request: session.pendingClarification!,
        onSubmit: (selections) => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .submitClarification(
              session.pendingClarification!.toolUseId,
              selections,
            ),
      );
    }
  }
}

class _ThinkingIndicator extends StatelessWidget {
  const _ThinkingIndicator();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Text(
        '正在思考',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: ecoThemeExtras(context).textMuted,
            ),
      ),
    );
  }
}

class _FollowUpBar extends StatelessWidget {
  const _FollowUpBar({required this.followUps, required this.onCancel});

  final List<ThreadPendingFollowUp> followUps;
  final Future<void> Function(String id) onCancel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.cardSurface,
        border: Border(top: BorderSide(color: eco.borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Follow-up 队列', style: Theme.of(context).textTheme.labelLarge),
            ...followUps.map(
              (item) => ListTile(
                dense: true,
                title: Text(
                  item.prompt,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(item.status),
                trailing: item.status == 'queued'
                    ? IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => onCancel(item.id),
                      )
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
