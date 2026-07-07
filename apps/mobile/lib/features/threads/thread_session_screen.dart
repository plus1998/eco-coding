import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_run_projection.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/subagent_projection_feed.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import '../../core/utils/thread_status.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../approvals/approval_sheets.dart';
import '../approvals/bash_approval_panel.dart';
import '../approvals/plan_approval_panel.dart';
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
  bool _bashApprovalBusy = false;
  bool _planActionBusy = false;
  bool _followUpBusy = false;
  bool _sendBusy = false;
  bool _stopBusy = false;
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
          ref
              .read(threadSessionProvider(widget.threadId))
              .thread
              ?.workspacePath ??
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
    if (session.pendingClarification != null &&
        session.pendingClarification!.threadId == thread.id) {
      return 'clarification:${session.pendingClarification!.toolUseId}';
    }
    return null;
  }

  bool _needsApprovalSheet(ThreadSessionState session) {
    final thread = session.thread;
    if (thread == null) return false;
    if (session.pendingClarification != null &&
        session.pendingClarification!.threadId == thread.id) {
      return true;
    }
    return false;
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
          pendingBash: state.pendingBash,
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
    final workspaceChanges = ref.watch(
      workspacePillSummaryProvider(workspacePath),
    );
    final changesLoading = ref.watch(
      workspacePillLoadingProvider(workspacePath),
    );
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
    final pendingBash = session.pendingBash;
    final pendingPlan = session.pendingPlan;
    final showBashApproval =
        pendingBash != null && pendingBash.threadId == thread?.id;
    final showPlanApproval =
        pendingPlan != null && pendingPlan.threadId == thread?.id;
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
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 280),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeInCubic,
                  transitionBuilder: (child, animation) {
                    return FadeTransition(
                      opacity: animation,
                      child: ScaleTransition(
                        scale: Tween<double>(begin: 0.96, end: 1).animate(
                          CurvedAnimation(
                            parent: animation,
                            curve: Curves.easeOutCubic,
                          ),
                        ),
                        alignment: Alignment.bottomCenter,
                        child: child,
                      ),
                    );
                  },
                  child: showBashApproval
                      ? BashApprovalPanel(
                          key: ValueKey('bash-${pendingBash.toolUseId}'),
                          request: pendingBash,
                          busy: _bashApprovalBusy,
                          onResolve: ({required decision, feedback}) async {
                            setState(() => _bashApprovalBusy = true);
                            try {
                              await ref
                                  .read(
                                    threadSessionProvider(
                                      widget.threadId,
                                    ).notifier,
                                  )
                                  .resolveBash(
                                    pendingBash.toolUseId,
                                    decision,
                                    feedback: feedback,
                                  );
                            } finally {
                              if (mounted) {
                                setState(() => _bashApprovalBusy = false);
                              }
                            }
                          },
                          onSkip: () async {
                            setState(() => _bashApprovalBusy = true);
                            try {
                              await ref
                                  .read(
                                    threadSessionProvider(
                                      widget.threadId,
                                    ).notifier,
                                  )
                                  .resolveBash(pendingBash.toolUseId, 'denied');
                            } finally {
                              if (mounted) {
                                setState(() => _bashApprovalBusy = false);
                              }
                            }
                          },
                        )
                      : showPlanApproval
                      ? PlanApprovalPanel(
                          key: ValueKey('plan-${pendingPlan.threadId}'),
                          plan: pendingPlan,
                          busy: _planActionBusy,
                          failureMessage: planFailureMessage,
                          onApprove: () async {
                            setState(() => _planActionBusy = true);
                            try {
                              await _handlePlanApproval(approve: true);
                            } finally {
                              if (mounted) {
                                setState(() => _planActionBusy = false);
                              }
                            }
                          },
                          onDismiss: () async {
                            setState(() => _planActionBusy = true);
                            try {
                              await _handlePlanApproval(approve: false);
                            } finally {
                              if (mounted) {
                                setState(() => _planActionBusy = false);
                              }
                            }
                          },
                        )
                      : SessionComposer(
                          key: const ValueKey('session-composer'),
                          controller: _promptController,
                          attachments: _attachments,
                          runtimeConfig: runtimeConfig,
                          threadId: widget.threadId,
                          isRunning: isRunning,
                          canStopThread: canStopThread,
                          followUpMode: followUpMode,
                          sendBusy: _followUpBusy || _sendBusy,
                          stopBusy: _stopBusy,
                          hasActivity: session.projectionReady,
                          inputHint: _editingFollowUpId != null
                              ? '编辑引导消息…'
                              : (showLanding
                                    ? composerLandingPlaceholder
                                    : null),
                          contextSnapshot: session.contextSnapshot,
                          threadStatus: thread?.status,
                          onPickImage: _pickImage,
                          onRemoveAttachment: (index) =>
                              setState(() => _attachments.removeAt(index)),
                          onSend: () => _sendMessage(runtimeConfig),
                          onStop: () => _stopThread(),
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
    if (_sendBusy || _followUpBusy) return;
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
        setState(() => _sendBusy = true);
        try {
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
        } finally {
          if (mounted) {
            setState(() => _sendBusy = false);
          }
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
    if (rpc == null || _stopBusy) return;
    setState(() => _stopBusy = true);
    try {
      await rpc.cancelThread(widget.threadId);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _stopBusy = false);
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
    if (session.pendingClarification != null &&
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
          bottom: 8,
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
      onOpenAgentDetail: (entry) =>
          unawaited(_openAgentProjectionDetail(context, ref, threadId, entry)),
      onOpenToolDetail: (entry) =>
          unawaited(_openToolProjectionDetail(context, ref, threadId, entry)),
    );
  }
}

Future<void> _openAgentProjectionDetail(
  BuildContext context,
  WidgetRef ref,
  String threadId,
  ActivityFeedEntry entry,
) async {
  final agentId = entry.agentId?.trim();
  if (agentId == null || agentId.isEmpty) {
    return;
  }
  final loadFuture = ref
      .read(threadSessionProvider(threadId).notifier)
      .loadProjectionDetail(kind: 'agent', key: agentId);
  if (!context.mounted) return;
  await _showProjectionDetailSheet(
    context: context,
    ref: ref,
    threadId: threadId,
    loadFuture: loadFuture,
    title: entry.text,
    subtitle: agentId,
    emptyText: '暂无子代理详情',
    timelineBuilder: (projection) {
      final agent = projection == null
          ? null
          : findProjectionAgentById(projection, agentId);
      return agent?.timeline ?? const [];
    },
  );
}

Future<void> _openToolProjectionDetail(
  BuildContext context,
  WidgetRef ref,
  String threadId,
  ActivityFeedEntry entry,
) async {
  final toolUseId = entry.toolUseId?.trim();
  if (toolUseId == null || toolUseId.isEmpty) {
    return;
  }
  final loadFuture = ref
      .read(threadSessionProvider(threadId).notifier)
      .loadProjectionDetail(kind: 'tool', key: toolUseId);
  if (!context.mounted) return;
  await _showProjectionDetailSheet(
    context: context,
    ref: ref,
    threadId: threadId,
    loadFuture: loadFuture,
    title: entry.text,
    subtitle: toolUseId,
    emptyText: '暂无工具详情',
    timelineBuilder: (projection) =>
        _projectionToolDetailItems(projection, toolUseId),
  );
}

typedef _ProjectionDetailTimelineBuilder =
    List<ThreadRunProjectionTimelineItem> Function(
      ThreadRunProjectionSnapshot? projection,
    );

Future<void> _showProjectionDetailSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String threadId,
  required Future<ThreadRunProjectionDetailResult?> loadFuture,
  required String title,
  required String subtitle,
  required String emptyText,
  required _ProjectionDetailTimelineBuilder timelineBuilder,
}) {
  return showEcoModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    enableDrag: false,
    backgroundColor: Colors.transparent,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.82,
        ),
        child: ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          child: ColoredBox(
            color: ecoColors(context).bgMenu,
            child: Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.viewPaddingOf(context).bottom + 8,
              ),
              child: Consumer(
                builder: (context, ref, _) {
                  final projection = ref.watch(
                    threadSessionProvider(
                      threadId,
                    ).select((state) => state.runProjection),
                  );
                  return _ProjectionDetailSheet(
                    threadId: threadId,
                    title: title,
                    subtitle: subtitle,
                    emptyText: emptyText,
                    loadFuture: loadFuture,
                    baseProjection: projection,
                    cachedTimeline: timelineBuilder(projection),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

ThreadRunProjectionSnapshot _projectionDetailSnapshot({
  required String threadId,
  required ThreadRunProjectionSnapshot? base,
  required List<ThreadRunProjectionTimelineItem> timeline,
}) {
  return ThreadRunProjectionSnapshot(
    threadId: base?.threadId ?? threadId,
    status: base?.status ?? '',
    generatedAt: base?.generatedAt ?? '',
    sourceEventCount: timeline.isNotEmpty ? timeline.length : 0,
    agents: const [],
    timeline: timeline.map(_projectionDetailTimelineItem).toList(),
    requestSpans: base?.requestSpans ?? const [],
  );
}

ThreadRunProjectionTimelineItem _projectionDetailTimelineItem(
  ThreadRunProjectionTimelineItem item,
) {
  if (isSubagentMissionEnvelope(item.text)) {
    final missionText = resolveMissionDisplayText(item.text);
    if (missionText.isNotEmpty) {
      return ThreadRunProjectionTimelineItem(
        id: item.id,
        sequence: item.sequence,
        eventType: 'thread.status',
        scope: 'main',
        text: missionText,
        at: item.at,
        role: 'user',
        agentId: item.agentId,
        requestId: item.requestId,
        streamKey: item.streamKey,
        metadata: {...?item.metadata, 'liveType': 'thread.user_prompt'},
      );
    }
  }
  if (item.scope == 'main') return item;
  return ThreadRunProjectionTimelineItem(
    id: item.id,
    sequence: item.sequence,
    eventType: item.eventType,
    scope: 'main',
    text: item.text,
    at: item.at,
    role: item.role,
    agentId: item.agentId,
    requestId: item.requestId,
    streamKey: item.streamKey,
    metadata: item.metadata,
  );
}

List<ThreadRunProjectionTimelineItem> _projectionToolDetailItems(
  ThreadRunProjectionSnapshot? projection,
  String toolUseId,
) {
  if (projection == null) return const [];
  final items = [
    ...projection.timeline,
    for (final agent in projection.agents) ...agent.timeline,
  ].where((item) => _projectionToolUseId(item) == toolUseId).toList();
  items.sort((left, right) {
    final sequenceDelta = left.sequence.compareTo(right.sequence);
    if (sequenceDelta != 0) return sequenceDelta;
    final atDelta = left.at.compareTo(right.at);
    if (atDelta != 0) return atDelta;
    return left.id.compareTo(right.id);
  });
  return items;
}

String? _projectionToolUseId(ThreadRunProjectionTimelineItem item) {
  final tool = readProjectionToolMetadata(item.metadata);
  final toolUseId = tool?.toolUseId?.trim();
  if (toolUseId != null && toolUseId.isNotEmpty) {
    return toolUseId;
  }
  final bashApproval = readBashApprovalMetadata(item.metadata);
  final approvalToolUseId = bashApproval?.toolUseId.trim();
  if (approvalToolUseId != null && approvalToolUseId.isNotEmpty) {
    return approvalToolUseId;
  }
  return null;
}

class _ProjectionDetailSheet extends StatefulWidget {
  const _ProjectionDetailSheet({
    required this.threadId,
    required this.title,
    required this.subtitle,
    required this.emptyText,
    required this.loadFuture,
    required this.baseProjection,
    required this.cachedTimeline,
  });

  final String threadId;
  final String title;
  final String subtitle;
  final String emptyText;
  final Future<ThreadRunProjectionDetailResult?> loadFuture;
  final ThreadRunProjectionSnapshot? baseProjection;
  final List<ThreadRunProjectionTimelineItem> cachedTimeline;

  @override
  State<_ProjectionDetailSheet> createState() => _ProjectionDetailSheetState();
}

class _ProjectionDetailSheetState extends State<_ProjectionDetailSheet> {
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: eco.textHeading,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        widget.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                      ),
                    ],
                  ),
                ),
              ),
              Tooltip(
                message: '关闭',
                child: IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: Icon(
                    Icons.close_rounded,
                    color: eco.textMuted,
                    size: 20,
                  ),
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ),
            ],
          ),
        ),
        Divider(height: 1, color: eco.borderSubtle),
        FutureBuilder<ThreadRunProjectionDetailResult?>(
          future: widget.loadFuture,
          builder: (context, snapshot) {
            final loading = snapshot.connectionState != ConnectionState.done;
            final entries = _buildProjectionDetailEntries(
              threadId: widget.threadId,
              base: widget.baseProjection,
              cachedTimeline: widget.cachedTimeline,
              detail: snapshot.data,
            );
            Widget body;
            if (entries.isEmpty && loading) {
              body = _ProjectionDetailStatusList(
                scrollController: _scrollController,
                title: '正在请求详情…',
                loading: true,
              );
            } else if (entries.isEmpty) {
              if (snapshot.hasError) {
                body = _ProjectionDetailStatusList(
                  scrollController: _scrollController,
                  title: '详情请求失败',
                  detail: '${snapshot.error}',
                );
              } else {
                final detail = snapshot.data;
                body = _ProjectionDetailStatusList(
                  scrollController: _scrollController,
                  title: detail == null
                      ? '未收到详情响应'
                      : detail.timeline.isEmpty
                      ? '桌面端返回了 0 条详情'
                      : widget.emptyText,
                  detail: detail == null
                      ? '移动端已发起请求，但没有拿到可解析的 detail 结果。'
                      : detail.timeline.isEmpty
                      ? '请求已完成，kind=${detail.kind}, key=${detail.key}。'
                      : null,
                );
              }
            } else {
              body = Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Stack(
                  children: [
                    ActivityFeedList(
                      entries: entries,
                      scrollController: _scrollController,
                      expandUserPrompts: true,
                    ),
                    if (loading)
                      Positioned(
                        left: 0,
                        right: 0,
                        top: 0,
                        child: LinearProgressIndicator(
                          minHeight: 2,
                          color: eco.accent,
                          backgroundColor: Colors.transparent,
                        ),
                      ),
                  ],
                ),
              );
            }
            return SizedBox(
              height: _projectionDetailBodyHeight(
                context,
                entries: entries,
                loading: loading,
              ),
              child: body,
            );
          },
        ),
      ],
    );
  }
}

double _projectionDetailBodyHeight(
  BuildContext context, {
  required List<ActivityFeedEntry> entries,
  required bool loading,
}) {
  final maxBodyHeight = MediaQuery.sizeOf(context).height * 0.66;
  if (entries.isEmpty) {
    return loading ? 150 : 132;
  }
  final estimated = entries.fold<double>(
    28,
    (height, entry) => height + _estimateProjectionDetailEntryHeight(entry),
  );
  return estimated.clamp(132, maxBodyHeight).toDouble();
}

double _estimateProjectionDetailEntryHeight(ActivityFeedEntry entry) {
  final textLength = entry.text.trim().length;
  final textLines = (textLength / 28).ceil().clamp(1, 28);
  switch (entry.kind) {
    case ActivityFeedKind.user:
    case ActivityFeedKind.assistant:
    case ActivityFeedKind.thinking:
    case ActivityFeedKind.clarificationAnswer:
      return 44 + textLines * 22;
    case ActivityFeedKind.action:
      return entry.fileChange != null || entry.bashRun != null ? 150 : 72;
    case ActivityFeedKind.actionGroup:
      return 76 + entry.actionChildren.length.clamp(0, 4) * 38;
    case ActivityFeedKind.subagentMission:
      return 120;
    case ActivityFeedKind.phase:
    case ActivityFeedKind.error:
      return 64 + textLines * 18;
  }
}

class _ProjectionDetailStatusList extends StatelessWidget {
  const _ProjectionDetailStatusList({
    required this.scrollController,
    required this.title,
    this.detail,
    this.loading = false,
  });

  final ScrollController scrollController;
  final String title;
  final String? detail;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 32),
        if (loading) ...[
          Center(
            child: SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: eco.accent,
              ),
            ),
          ),
          const SizedBox(height: 14),
        ],
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: eco.textMuted),
        ),
        if (detail != null && detail!.trim().isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            detail!,
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
          ),
        ],
      ],
    );
  }
}

List<ActivityFeedEntry> _buildProjectionDetailEntries({
  required String threadId,
  required ThreadRunProjectionSnapshot? base,
  required List<ThreadRunProjectionTimelineItem> cachedTimeline,
  required ThreadRunProjectionDetailResult? detail,
}) {
  final timeline = _mergeProjectionDetailTimeline(
    cachedTimeline,
    detail?.timeline ?? const [],
  );
  final detailProjection = _projectionDetailSnapshot(
    threadId: threadId,
    base: base,
    timeline: timeline,
  );
  return buildActivityFeed(
    threadPrompt: '',
    threadId: threadId,
    runProjection: detailProjection,
  );
}

List<ThreadRunProjectionTimelineItem> _mergeProjectionDetailTimeline(
  List<ThreadRunProjectionTimelineItem> cached,
  List<ThreadRunProjectionTimelineItem> fresh,
) {
  if (cached.isEmpty) return fresh;
  if (fresh.isEmpty) return cached;
  final byId = <String, ThreadRunProjectionTimelineItem>{
    for (final item in cached) item.id: item,
  };
  for (final item in fresh) {
    byId[item.id] = item;
  }
  final merged = byId.values.toList();
  merged.sort((left, right) {
    final sequenceDelta = left.sequence.compareTo(right.sequence);
    if (sequenceDelta != 0) return sequenceDelta;
    final atDelta = left.at.compareTo(right.at);
    if (atDelta != 0) return atDelta;
    return left.id.compareTo(right.id);
  });
  return merged;
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
