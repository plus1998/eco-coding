import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import '../../core/utils/thread_status.dart';
import '../approvals/approval_sheets.dart';
import '../composer/composer_dock_shell.dart';
import '../composer/follow_up_queue_bar.dart';
import '../composer/session_composer.dart';
import '../composer/workspace_changes_pill.dart';
import 'activity_feed.dart';
import 'activity_feed_scroll_coordinator.dart';
import 'thread_info_sheets.dart';
import 'thread_menu_sheets.dart';
import 'thread_session_layout.dart';
import 'thread_providers.dart';
import 'thread_session_app_bar.dart';

class ThreadSessionScreen extends ConsumerStatefulWidget {
  const ThreadSessionScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ThreadSessionScreen> createState() =>
      _ThreadSessionScreenState();
}

class _ThreadSessionScreenState extends ConsumerState<ThreadSessionScreen>
    with WidgetsBindingObserver {
  final _promptController = TextEditingController();
  final _scrollController = ScrollController();
  late final ActivityFeedScrollCoordinator _scrollCoordinator =
      ActivityFeedScrollCoordinator(_scrollController);
  final _attachments = <PromptImageAttachment>[];
  final _picker = ImagePicker();
  String? _shownApprovalKey;
  bool _planApprovalSheetOpen = false;
  bool _followUpBusy = false;
  String? _editingFollowUpId;
  String? _followUpCancelBusyId;
  String? _followUpEscalateBusyId;
  double _lastKeyboardInset = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(runtimeConfigProvider.notifier).state = null;
      _maybeShowApprovalSheet(ref.read(threadSessionProvider(widget.threadId)));
    });
  }

  void _maybeShowApprovalSheet(ThreadSessionState session) {
    if (!_needsApprovalSheet(session)) {
      return;
    }
    final key = _approvalKey(session);
    if (key == null || key == _shownApprovalKey) {
      return;
    }
    _shownApprovalKey = key;
    _showApprovalSheets(session);
  }

  @override
  void didChangeMetrics() {
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final inset = MediaQuery.viewInsetsOf(context).bottom;
      if (inset > _lastKeyboardInset &&
          !_scrollCoordinator.userDetachedFromBottom) {
        _scrollCoordinator.scrollToEnd();
      }
      _lastKeyboardInset = inset;
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshFollowUps());
      final workspacePath =
          ref.read(threadSessionProvider(widget.threadId)).thread?.workspacePath ??
          '';
      if (workspacePath.isNotEmpty) {
        refreshWorkspaceChanges(ref, workspacePath);
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _promptController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String? _approvalKey(ThreadSessionState session) {
    final thread = session.thread;
    if (thread == null) return null;
    if (session.pendingPlan != null &&
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
  Widget build(BuildContext context) {
    final session = ref.watch(
      threadSessionProvider(widget.threadId).select(
        (state) => (
          loading: state.loading,
          error: state.error,
          thread: state.thread,
          pendingPlan: state.pendingPlan,
          followUps: state.followUps,
          contextSnapshot: state.contextSnapshot,
          projectionReady: isProjectionFeedReady(state.runProjection),
        ),
      ),
    );
    final runtimeConfig =
        ref.watch(runtimeConfigProvider) ??
        session.thread?.runtimeConfig ??
        buildDefaultRuntimeConfig(
          modelSettings: ref.watch(modelSettingsProvider).valueOrNull,
          workflow: ref.watch(workflowSettingsProvider).valueOrNull,
          mcpServers: ref.watch(mcpSettingsProvider).valueOrNull?.servers,
        );
    final thread = session.thread;
    final workspacePath = thread?.workspacePath ?? '';
    final projectName = workspacePath.isEmpty
        ? null
        : workspaceDisplayName(workspacePath);
    final landingHero = landingHeroText(
      workspacePath: workspacePath.isEmpty ? null : workspacePath,
      projectName: projectName,
    );
    final gitStatusAsync = workspacePath.isNotEmpty && !session.loading
        ? ref.watch(gitStatusProvider(workspacePath))
        : const AsyncValue<GitWorkingTreeStatus?>.data(null);
    final gitStatus = gitStatusAsync.valueOrNull;
    final workspaceChanges = ref.watch(workspacePillSummaryProvider(workspacePath));
    final changesLoading = ref.watch(workspacePillLoadingProvider(workspacePath));
    final isRunning = _isRunning(thread);
    final showLanding =
        !session.loading &&
        session.error == null &&
        !isRunning &&
        !session.projectionReady;
    final isAwaitingPlan =
        thread != null && session.pendingPlan?.threadId == thread.id;
    final canStopThread = isRunning || isAwaitingPlan;
    final planFailureMessage = isAwaitingPlan
        ? extractPlanFailureMessage(thread.message)
        : null;
    final followUpMode = isLiveFollowUpThreadStatus(thread?.status);
    final queuedFollowUps = queuedThreadFollowUps(
      session.followUps,
    ).where((item) => item.id != _editingFollowUpId).toList();

    ref.listen(threadSessionProvider(widget.threadId), (previous, next) {
      if (next.loading) return;
      final previousApprovalKey = previous == null
          ? null
          : _approvalKey(previous);
      final nextApprovalKey = _approvalKey(next);
      if (previousApprovalKey != null && nextApprovalKey == null) {
        Navigator.of(context).maybePop();
      }
      if (!_needsApprovalSheet(next)) {
        _shownApprovalKey = null;
      } else {
        final key = nextApprovalKey;
        if (key != null && key != _shownApprovalKey) {
          _shownApprovalKey = key;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            _showApprovalSheets(
              ref.read(threadSessionProvider(widget.threadId)),
            );
          });
        }
      }
      final previousProjection = previous?.runProjection;
      final nextProjection = next.runProjection;
      final projectionBecameReady =
          !isProjectionFeedReady(previousProjection) &&
          isProjectionFeedReady(nextProjection);
      if (projectionBecameReady) {
        _scrollCoordinator.forceScrollToEnd();
      }
      final prevThread = previous?.thread;
      final nextThread = next.thread;
      if (prevThread != null &&
          nextThread != null &&
          isThreadBusy(prevThread) &&
          !isThreadBusy(nextThread)) {
        final path = nextThread.workspacePath;
        if (path.isNotEmpty) {
          refreshWorkspaceChanges(ref, path);
        }
      }
    });

    return Scaffold(
      resizeToAvoidBottomInset: false,
      extendBodyBehindAppBar: true,
      appBar: buildThreadSessionAppBar(
        context,
        ref,
        title: thread?.title ?? '',
        workspacePath: workspacePath,
        threadId: widget.threadId,
        projectName: projectName,
        runtimeConfig: runtimeConfig,
        isRunning: isRunning,
        gitStatus: gitStatus,
      ),
      body: ThreadSessionConversationLayout(
        feed: session.loading
            ? const Center(child: CircularProgressIndicator())
            : session.error != null
            ? Center(child: Text(session.error!))
            : showLanding
            ? Padding(
                padding: const EdgeInsets.fromLTRB(32, 0, 32, 32),
                child: Align(
                  alignment: Alignment.center,
                  child: Text(
                    landingHero,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      height: 1.35,
                    ),
                  ),
                ),
              )
            : _ThreadSessionFeedPane(
                threadId: widget.threadId,
                scrollController: _scrollController,
                scrollCoordinator: _scrollCoordinator,
                isRunning: isRunning,
              ),
        composer: AnimatedPadding(
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
                if (queuedFollowUps.isNotEmpty)
                  FollowUpQueueBar(
                    followUps: queuedFollowUps,
                    cancelBusyId: _followUpCancelBusyId,
                    escalateBusyId: _followUpEscalateBusyId,
                    onEscalate: (followUp) => _escalateFollowUp(followUp),
                    onEdit: _startEditingFollowUp,
                    onDelete: (followUp) => _deleteFollowUp(followUp),
                  ),
                if (_editingFollowUpId != null)
                  _EditingFollowUpBanner(onCancel: _cancelEditingFollowUp),
                if (isAwaitingPlan && session.pendingPlan != null)
                  _PlanApprovalBanner(
                    failureMessage: planFailureMessage,
                    onViewPlan: () => _showApprovalSheets(
                      ref.read(threadSessionProvider(widget.threadId)),
                    ),
                    onApprove: () => _handlePlanApproval(approve: true),
                    onDismiss: () => _handlePlanApproval(approve: false),
                  ),
                SessionComposer(
                  controller: _promptController,
                  attachments: _attachments,
                  runtimeConfig: runtimeConfig,
                  threadId: widget.threadId,
                  isRunning: isRunning,
                  canStopThread: canStopThread,
                  followUpMode: followUpMode,
                  sendBusy: _followUpBusy,
                  hasActivity: session.projectionReady,
                  inputHint: _editingFollowUpId != null
                      ? '编辑引导消息…'
                      : (showLanding ? composerLandingPlaceholder : null),
                  contextSnapshot: session.contextSnapshot,
                  threadStatus: thread?.status,
                  onPickImage: _pickImage,
                  onRemoveAttachment: (index) =>
                      setState(() => _attachments.removeAt(index)),
                  onSend: () => _sendMessage(runtimeConfig),
                  onStop: () => _stopThread(),
                  onRuntimeConfigChanged: (config) {
                    ref.read(runtimeConfigProvider.notifier).state = config;
                  },
                ),
              ],
            ),
          ),
        ),
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

  void _startEditingFollowUp(ThreadPendingFollowUp followUp) {
    setState(() {
      _editingFollowUpId = followUp.id;
      _promptController.text = followUp.prompt;
      _attachments.clear();
    });
  }

  void _cancelEditingFollowUp() {
    setState(() {
      _editingFollowUpId = null;
      _promptController.clear();
      _attachments.clear();
    });
  }

  Future<void> _refreshFollowUps() async {
    await ref
        .read(threadSessionProvider(widget.threadId).notifier)
        .refreshPending();
  }

  Future<void> _deleteFollowUp(ThreadPendingFollowUp followUp) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    setState(() => _followUpCancelBusyId = followUp.id);
    try {
      await rpc.followUpCancel(
        threadId: widget.threadId,
        followUpId: followUp.id,
      );
      if (_editingFollowUpId == followUp.id) {
        _cancelEditingFollowUp();
      }
      await _refreshFollowUps();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _followUpCancelBusyId = null);
      }
    }
  }

  Future<void> _escalateFollowUp(ThreadPendingFollowUp followUp) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null || followUp.priority == 'escalated') return;
    setState(() => _followUpEscalateBusyId = followUp.id);
    try {
      await rpc.followUpEscalate(
        threadId: widget.threadId,
        followUpId: followUp.id,
      );
      if (_editingFollowUpId == followUp.id) {
        _cancelEditingFollowUp();
      }
      await _refreshFollowUps();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _followUpEscalateBusyId = null);
      }
    }
  }

  Future<void> _sendMessage(ThreadRuntimeConfigInput runtimeConfig) async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    final thread = ref.read(threadSessionProvider(widget.threadId)).thread;
    final followUpMode = isLiveFollowUpThreadStatus(thread?.status);

    try {
      if (followUpMode) {
        if (_attachments.isNotEmpty) {
          if (mounted) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('运行中引导消息暂不支持图片附件。')));
          }
          return;
        }
        setState(() => _followUpBusy = true);
        if (_editingFollowUpId != null) {
          await rpc.followUpUpdate(
            threadId: widget.threadId,
            followUpId: _editingFollowUpId!,
            prompt: prompt,
          );
          _cancelEditingFollowUp();
        } else {
          await rpc.followUpEnqueue(threadId: widget.threadId, prompt: prompt);
          FocusManager.instance.primaryFocus?.unfocus();
          _promptController.clear();
          if (mounted) {
            setState(() => _attachments.clear());
          }
        }
        await _refreshFollowUps();
      } else {
        await rpc.continueThread(
          threadId: widget.threadId,
          prompt: prompt,
          attachments: _attachments.isEmpty ? null : List.of(_attachments),
          runtimeConfig: runtimeConfig,
        );
        ref.invalidate(threadListProvider);
        FocusManager.instance.primaryFocus?.unfocus();
        _promptController.clear();
        if (mounted) {
          setState(() => _attachments.clear());
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted && followUpMode) {
        setState(() => _followUpBusy = false);
      }
    }
  }

  Future<void> _stopThread() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    try {
      await rpc.cancelThread(widget.threadId);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _handlePlanApproval({required bool approve}) async {
    final notifier = ref.read(threadSessionProvider(widget.threadId).notifier);
    try {
      if (approve) {
        await notifier.approvePlan();
      } else {
        await notifier.dismissPlan();
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
        session.pendingPlan!.threadId == thread?.id) {
      if (_planApprovalSheetOpen) return;
      _planApprovalSheetOpen = true;
      showPlanApprovalSheet(
        context: context,
        plan: session.pendingPlan!,
        onApprove: () => _handlePlanApproval(approve: true),
        onDismiss: () => _handlePlanApproval(approve: false),
      ).whenComplete(() {
        _planApprovalSheetOpen = false;
        if (!mounted) return;
        final current = ref.read(threadSessionProvider(widget.threadId));
        if (!_needsApprovalSheet(current)) {
          return;
        }
        _shownApprovalKey = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _maybeShowApprovalSheet(
            ref.read(threadSessionProvider(widget.threadId)),
          );
        });
      });
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

class _ThreadSessionFeedPane extends ConsumerWidget {
  const _ThreadSessionFeedPane({
    required this.threadId,
    required this.scrollController,
    required this.scrollCoordinator,
    required this.isRunning,
  });

  final String threadId;
  final ScrollController scrollController;
  final ActivityFeedScrollCoordinator scrollCoordinator;
  final bool isRunning;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Stack(
      clipBehavior: Clip.hardEdge,
      children: [
        _ActivityFeedView(
          threadId: threadId,
          scrollController: scrollController,
          scrollCoordinator: scrollCoordinator,
          isRunning: isRunning,
        ),
        Positioned(
          top: 8,
          right: 8,
          child: _ThreadUsageOverlay(threadId: threadId),
        ),
      ],
    );
  }
}

class _ActivityFeedView extends ConsumerWidget {
  const _ActivityFeedView({
    required this.threadId,
    required this.scrollController,
    required this.scrollCoordinator,
    required this.isRunning,
  });

  final String threadId;
  final ScrollController scrollController;
  final ActivityFeedScrollCoordinator scrollCoordinator;
  final bool isRunning;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadPrompt = ref.watch(
      threadSessionProvider(threadId).select((state) => state.thread?.prompt),
    );
    final runProjection = ref.watch(
      threadSessionProvider(threadId).select((state) => state.runProjection),
    );
    final subagentSessions = ref.watch(
      threadSessionProvider(threadId).select((state) => state.subagentSessions),
    );
    final agentProfile = null as OrchestrationProfile?;
    final feedEntries = buildActivityFeed(
      threadPrompt: threadPrompt,
      threadId: threadId,
      runProjection: runProjection,
      subagentSessions: subagentSessions,
    );
    final projectionReady = isProjectionFeedReady(runProjection);
    final hasStreamingThinking = feedEntries.any(
      (entry) => entry.kind == ActivityFeedKind.thinking && entry.streaming,
    );
    final hasStreamingAssistant = feedEntries.any(
      (entry) => entry.kind == ActivityFeedKind.assistant && entry.streaming,
    );
    final displayFeedEntries =
        isRunning && !hasStreamingThinking && !hasStreamingAssistant
        ? [
            ...feedEntries,
            const ActivityFeedEntry(
              id: 'pending-agent',
              kind: ActivityFeedKind.thinking,
              text: '',
              streaming: true,
            ),
          ]
        : feedEntries;

    if (!projectionReady) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            isRunning ? '运行投影加载中…' : '运行投影尚未就绪',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: ecoColors(context).textMuted,
            ),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return ActivityFeedList(
      entries: displayFeedEntries,
      scrollController: scrollController,
      scrollCoordinator: scrollCoordinator,
      agentProfile: agentProfile,
    );
  }
}

class _ThreadUsageOverlay extends ConsumerWidget {
  const _ThreadUsageOverlay({required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final billing = ref.watch(
      threadSessionProvider(threadId).select((state) => state.billing),
    );
    final threadStatus = ref.watch(
      threadSessionProvider(threadId).select((state) => state.thread?.status),
    );
    return ThreadUsageFloatButtons(
      billing: billing,
      threadStatus: threadStatus,
    );
  }
}

class _PlanApprovalBanner extends StatelessWidget {
  const _PlanApprovalBanner({
    required this.onViewPlan,
    required this.onApprove,
    required this.onDismiss,
    this.failureMessage,
  });

  final VoidCallback onViewPlan;
  final Future<void> Function() onApprove;
  final Future<void> Function() onDismiss;
  final String? failureMessage;

  @override
  Widget build(BuildContext context) {
    final failed = failureMessage != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).accentSoft,
        border: Border(top: BorderSide(color: ecoColors(context).borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  EcoIcons.planApproval,
                  size: 18,
                  color: ecoColors(context).accentText,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    failed ? '执行失败，计划待确认' : '计划已生成，等待确认',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: ecoColors(context).accentText,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: onViewPlan,
                  style: TextButton.styleFrom(
                    foregroundColor: ecoColors(context).accentText,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('查看计划'),
                ),
              ],
            ),
            if (failureMessage != null) ...[
              const SizedBox(height: 4),
              Text(
                failureMessage!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).accentText,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => onDismiss(),
                    child: const Text('驳回'),
                  ),
                ),
                if (!failed) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => onApprove(),
                      child: const Text('批准执行'),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EditingFollowUpBanner extends StatelessWidget {
  const _EditingFollowUpBanner({required this.onCancel});

  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).accentSoft,
        border: Border(top: BorderSide(color: ecoColors(context).borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Icon(
              EcoIcons.followUp,
              size: 16,
              color: ecoColors(context).accentText,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '正在编辑引导消息',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).accentText,
                ),
              ),
            ),
            TextButton.icon(
              onPressed: onCancel,
              icon: const Icon(EcoIcons.close, size: 16),
              label: const Text('取消'),
              style: TextButton.styleFrom(
                foregroundColor: ecoColors(context).accentText,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
