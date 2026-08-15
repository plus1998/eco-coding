import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/locale/app_error_localizations.dart';
import '../../core/models/app_error.dart';
import '../../core/models/git_models.dart';
import '../../core/models/image_view_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_run_projection.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/acp_host_ui_features.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/prompt_image_attachment.dart';
import '../../core/utils/subagent_projection_feed.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import '../../core/utils/thread_status.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../../l10n/generated/app_localizations.dart';
import '../approvals/approval_sheets.dart';
import '../approvals/bash_approval_panel.dart';
import '../approvals/plan_approval_panel.dart';
import '../composer/composer_dock_shell.dart';
import '../composer/composer_stack_card.dart';
import '../composer/follow_up_queue_bar.dart';
import '../composer/session_composer.dart';
import '../composer/workspace_changes_pill.dart';
import 'activity_feed.dart';
import 'activity_feed_scroll_coordinator.dart';
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
  bool _bashApprovalBusy = false;
  bool _planActionBusy = false;
  bool _clarificationBusy = false;
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
      if (!mounted) return;
      final thread = ref.read(threadSessionProvider(widget.threadId)).thread;
      ref.read(runtimeConfigProvider.notifier).state = thread?.runtimeConfig;
    });
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
      unawaited(
        ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .recoverProjection(),
      );
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
          pendingClarification: state.pendingClarification,
          followUps: state.followUps,
          billing: state.billing,
          contextSnapshot: state.contextSnapshot,
          titleGenerating: state.titleGenerating,
          projectionReady: isProjectionFeedReady(state.runProjection),
        ),
      ),
    );
    final runtimeConfig =
        ref.watch(runtimeConfigProvider) ??
        session.thread?.runtimeConfig ??
        buildDefaultRuntimeConfig();
    final thread = session.thread;
    final workspacePath = thread?.workspacePath ?? '';
    final projectName = workspacePath.isEmpty
        ? null
        : workspaceDisplayName(workspacePath);
    final landingHero = landingHeroText(
      workspacePath: workspacePath.isEmpty ? null : workspacePath,
      projectName: projectName,
      l10n: context.l10n,
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
    final pendingClarification = session.pendingClarification;
    final showBashApproval =
        pendingBash != null && pendingBash.threadId == thread?.id;
    final showPlanApproval =
        pendingPlan != null && pendingPlan.threadId == thread?.id;
    final showClarification =
        pendingClarification != null &&
        pendingClarification.threadId == thread?.id;
    final queuedFollowUps = queuedThreadFollowUps(
      session.followUps,
    ).where((item) => item.id != _editingFollowUpId).toList();

    ref.listen(threadSessionProvider(widget.threadId), (previous, next) {
      if (next.loading) return;
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

    final hasWorkspaceChanges = workspaceChanges?.hasChanges ?? false;
    final hasFloatingComposerContent =
        hasWorkspaceChanges ||
        queuedFollowUps.isNotEmpty ||
        _editingFollowUpId != null;

    final floatingComposer = hasFloatingComposerContent
        ? Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasWorkspaceChanges)
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
                  onReorder: (oldIndex, newIndex) =>
                      _reorderFollowUps(queuedFollowUps, oldIndex, newIndex),
                ),
              if (_editingFollowUpId != null)
                _EditingFollowUpBanner(onCancel: _cancelEditingFollowUp),
            ],
          )
        : null;

    return Scaffold(
      resizeToAvoidBottomInset: false,
      extendBodyBehindAppBar: true,
      backgroundColor: ecoColors(context).bgFeed,
      appBar: buildThreadSessionAppBar(
        context,
        ref,
        title: thread?.title ?? '',
        workspacePath: workspacePath,
        threadId: widget.threadId,
        projectName: projectName,
        runtimeConfig: runtimeConfig,
        isRunning: isRunning,
        titleGenerating: session.titleGenerating,
        gitStatus: gitStatus,
      ),
      body: ThreadSessionConversationLayout(
        floatingComposer: floatingComposer,
        feedBuilder: (context, feedBottomInset, controlsBottomInset) =>
            session.loading
            ? const Center(child: CircularProgressIndicator())
            : session.error != null
            ? Center(
                child: Text(localizedAppError(session.error!, context.l10n)),
              )
            : showLanding
            ? Padding(
                padding: EdgeInsets.fromLTRB(
                  32,
                  sessionContentTopPadding(context),
                  32,
                  32 + feedBottomInset,
                ),
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
                feedBottomInset: feedBottomInset,
                controlsBottomInset: controlsBottomInset,
              ),
        composer: AnimatedPadding(
          duration: const Duration(milliseconds: 100),
          curve: Curves.easeOut,
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: ComposerDockShell(
            child: AnimatedSwitcher(
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
                                threadSessionProvider(widget.threadId).notifier,
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
                                threadSessionProvider(widget.threadId).notifier,
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
                  : showClarification
                  ? ClarificationDockPanel(
                      key: ValueKey(
                        'clarification-${pendingClarification.toolUseId}',
                      ),
                      request: pendingClarification,
                      busy: _clarificationBusy,
                      onSubmit: (selections) => _submitClarification(
                        pendingClarification,
                        selections,
                      ),
                      onDismiss: () =>
                          _dismissClarification(pendingClarification),
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
                          ? context.l10n.threadEditGuidanceHint
                          : (showLanding
                                ? composerLandingPlaceholder(context.l10n)
                                : null),
                      billing: session.billing,
                      contextSnapshot: session.contextSnapshot,
                      threadStatus: thread?.status,
                      workspacePath: workspacePath,
                      coreKind: thread?.coreKind,
                      hostUiFeatures:
                          thread?.hostUiFeatures ?? AcpHostUiFeatures.showAll,
                      onPickImage: _pickImage,
                      onRemoveAttachment: (index) =>
                          setState(() => _attachments.removeAt(index)),
                      onSend: () => _sendMessage(runtimeConfig),
                      onStop: () => _stopThread(),
                      onRuntimeConfigChanged: (config) {
                        ref.read(runtimeConfigProvider.notifier).state = config;
                      },
                    ),
            ),
          ),
        ),
      ),
    );
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

  Future<void> _submitClarification(
    ClarificationRequest request,
    List<List<String>> selections,
  ) async {
    if (_clarificationBusy) return;
    setState(() => _clarificationBusy = true);
    try {
      await ref
          .read(threadSessionProvider(widget.threadId).notifier)
          .submitClarification(request.toolUseId, selections);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _clarificationBusy = false);
      }
    }
  }

  Future<void> _dismissClarification(ClarificationRequest request) async {
    if (_clarificationBusy) return;
    setState(() => _clarificationBusy = true);
    try {
      await ref
          .read(threadSessionProvider(widget.threadId).notifier)
          .dismissClarification(request.toolUseId);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _clarificationBusy = false);
      }
    }
  }

  void _startEditingFollowUp(ThreadPendingFollowUp followUp) {
    setState(() {
      _editingFollowUpId = followUp.id;
      _promptController.text = followUp.prompt;
      _attachments
        ..clear()
        ..addAll(followUp.attachments);
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

  Future<void> _reorderFollowUps(
    List<ThreadPendingFollowUp> followUps,
    int oldIndex,
    int newIndex,
  ) async {
    if (newIndex > oldIndex) newIndex -= 1;
    if (oldIndex == newIndex) return;
    final reordered = List<ThreadPendingFollowUp>.of(followUps);
    reordered.insert(newIndex, reordered.removeAt(oldIndex));
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    try {
      await rpc.followUpReorder(
        threadId: widget.threadId,
        followUpIds: reordered.map((followUp) => followUp.id).toList(),
      );
      await _refreshFollowUps();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
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
        setState(() => _followUpBusy = true);
        if (_editingFollowUpId != null) {
          await rpc.followUpUpdate(
            threadId: widget.threadId,
            followUpId: _editingFollowUpId!,
            prompt: prompt,
            attachments: _attachments.isEmpty ? null : List.of(_attachments),
          );
          _cancelEditingFollowUp();
        } else {
          await rpc.followUpEnqueue(
            threadId: widget.threadId,
            prompt: prompt,
            attachments: _attachments.isEmpty ? null : List.of(_attachments),
          );
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
          final sendRuntimeConfig = downgradeAuxiliaryDependentFeatures(
            runtimeConfig,
          );
          if (sendRuntimeConfig.bashReviewMode !=
              runtimeConfig.bashReviewMode) {
            ref.read(runtimeConfigProvider.notifier).state = sendRuntimeConfig;
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(context.l10n.auxiliaryModelAutoReviewFallback),
                ),
              );
            }
          }
          await rpc.continueThread(
            threadId: widget.threadId,
            prompt: prompt,
            attachments: _attachments.isEmpty ? null : List.of(_attachments),
            runtimeConfig: sendRuntimeConfig,
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
}

class _ThreadSessionFeedPane extends ConsumerWidget {
  const _ThreadSessionFeedPane({
    required this.threadId,
    required this.scrollController,
    required this.scrollCoordinator,
    required this.isRunning,
    required this.feedBottomInset,
    required this.controlsBottomInset,
  });

  final String threadId;
  final ScrollController scrollController;
  final ActivityFeedScrollCoordinator scrollCoordinator;
  final bool isRunning;
  final double feedBottomInset;
  final double controlsBottomInset;

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
          feedBottomInset: feedBottomInset,
          controlsBottomInset: controlsBottomInset,
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
    required this.feedBottomInset,
    required this.controlsBottomInset,
  });

  final String threadId;
  final ScrollController scrollController;
  final ActivityFeedScrollCoordinator scrollCoordinator;
  final bool isRunning;
  final double feedBottomInset;
  final double controlsBottomInset;

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
    final modelSettings = ref.watch(modelSettingsProvider).valueOrNull;
    final runtimeConfig = ref.watch(
      threadSessionProvider(
        threadId,
      ).select((state) => state.thread?.runtimeConfig),
    );
    final snapshot = runtimeConfig == null
        ? null
        : resolveThreadOrchestrationSnapshot(modelSettings, runtimeConfig);
    final themeSource = SubagentThemeSource.fromSnapshot(snapshot);
    final feedEntries = buildActivityFeed(
      threadPrompt: threadPrompt,
      threadId: threadId,
      runProjection: runProjection,
      subagentSessions: subagentSessions,
      l10n: context.l10n,
    );
    final projectionReady = isProjectionFeedReady(runProjection);
    final displayFeedEntries =
        shouldAppendPendingAgentThinking(
          isRunning: isRunning,
          entries: feedEntries,
        )
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
            isRunning
                ? context.l10n.threadProjectionLoading
                : context.l10n.threadProjectionUnavailable,
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
      themeSource: themeSource,
      scrollJumpBottomInset: controlsBottomInset,
      padding: EdgeInsets.fromLTRB(
        threadSessionFeedHorizontalPadding,
        sessionContentTopPadding(context),
        threadSessionFeedHorizontalPadding,
        feedBottomInset,
      ),
      onOpenAgentDetail: (entry) =>
          unawaited(_openAgentProjectionDetail(context, ref, threadId, entry)),
      loadToolDetail: (entry) =>
          _loadToolProjectionDetail(context, ref, threadId, entry),
      loadImageView: (entry) => _loadImageViewForEntry(ref, entry),
      onLoadUserMessageEdit: (activityLineId) async {
        final rpc = ref.read(desktopRpcProvider);
        if (rpc == null) {
          throw const AppErrorCodeException(
            AppErrorCode.threadProjectionNoPcSelected,
          );
        }
        return rpc.getUserMessageEdit(
          threadId: threadId,
          activityLineId: activityLineId,
        );
      },
      onRewriteUserMessage:
          ({
            required activityLineId,
            required prompt,
            required attachments,
            required expectedHistoryRevision,
          }) async {
            final rpc = ref.read(desktopRpcProvider);
            if (rpc == null) {
              throw const AppErrorCodeException(
                AppErrorCode.threadProjectionNoPcSelected,
              );
            }
            final thread = await rpc.rewriteThreadFromMessage(
              threadId: threadId,
              activityLineId: activityLineId,
              prompt: prompt,
              attachments: attachments,
              expectedHistoryRevision: expectedHistoryRevision,
            );
            await ref
                .read(threadSessionProvider(threadId).notifier)
                .acceptRewrittenThread(thread);
          },
      hasEarlier: runProjection?.hasEarlier == true,
      onLoadEarlier: () => ref
          .read(threadSessionProvider(threadId).notifier)
          .loadEarlierProjection(),
      onLoadEarlierError: (error) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.threadEarlierHistoryLoadFailed)),
        );
      },
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
  final missionSource = entry.missionPrompt?.trim().isNotEmpty == true
      ? entry.missionPrompt!
      : entry.text;
  final projection = ref.read(threadSessionProvider(threadId)).runProjection;
  final agent = projection == null
      ? null
      : findProjectionAgentById(projection, agentId);
  final role = agent?.role.trim().isNotEmpty == true
      ? agent!.role
      : entry.subagentRole ?? '';
  final title = resolveSubagentDetailTitle(
    roleLabel: resolveSubagentRunDisplayTitle(role, context.l10n),
    nickname: agent?.nickname,
    taskName: agent?.taskName ?? entry.taskName,
  );
  await _showProjectionDetailSheet(
    context: context,
    ref: ref,
    threadId: threadId,
    loadImageView: (entry) => _loadImageViewForEntry(ref, entry),
    loadFuture: loadFuture,
    emptyText: context.l10n.threadNoSubagentDetails,
    title: title,
    missionText: resolveMissionDisplayText(missionSource),
    injectMainThreadUserPrompts: false,
    timelineBuilder: (projection) {
      final agent = projection == null
          ? null
          : findProjectionAgentById(projection, agentId);
      return agent?.timeline ?? const [];
    },
  );
}

Future<ImageViewReadData> _loadImageViewForEntry(
  WidgetRef ref,
  ActivityFeedEntry entry,
) {
  final imageView = entry.imageView;
  final path = imageView?.path.trim();
  if (path == null || path.isEmpty) {
    return Future.error(
      const ImageViewReadException(ImageViewReadFailureCode.invalidResponse),
    );
  }
  final rpc = ref.read(desktopRpcProvider);
  if (rpc == null) {
    return Future.error(
      const ImageViewReadException(ImageViewReadFailureCode.bridgeUnavailable),
    );
  }
  return rpc.readImageView(path);
}

Future<List<ActivityFeedEntry>> _loadToolProjectionDetail(
  BuildContext context,
  WidgetRef ref,
  String threadId,
  ActivityFeedEntry entry,
) async {
  final toolUseId = entry.toolUseId?.trim();
  if (toolUseId == null || toolUseId.isEmpty) {
    return const [];
  }
  final baseProjection = ref
      .read(threadSessionProvider(threadId))
      .runProjection;
  final cachedTimeline = _projectionToolDetailItems(baseProjection, toolUseId);
  final detail = await ref
      .read(threadSessionProvider(threadId).notifier)
      .loadProjectionDetail(kind: 'tool', key: toolUseId);
  if (!context.mounted) return const [];
  return buildProjectionDetailEntries(
    threadId: threadId,
    base: ref.read(threadSessionProvider(threadId)).runProjection,
    cachedTimeline: cachedTimeline,
    detail: detail,
    l10n: context.l10n,
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
  required ActivityFeedImageViewLoader loadImageView,
  required Future<ThreadRunProjectionDetailResult?> loadFuture,
  required String emptyText,
  required _ProjectionDetailTimelineBuilder timelineBuilder,
  String? title,
  String? missionText,
  bool injectMainThreadUserPrompts = true,
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
            color: ecoColors(context).bgFeed,
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
                    emptyText: emptyText,
                    loadFuture: loadFuture,
                    loadImageView: loadImageView,
                    baseProjection: projection,
                    cachedTimeline: timelineBuilder(projection),
                    title: title,
                    missionText: missionText,
                    injectMainThreadUserPrompts: injectMainThreadUserPrompts,
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
  bool normalizeItems = true,
}) {
  return ThreadRunProjectionSnapshot(
    threadId: base?.threadId ?? threadId,
    status: base?.status ?? '',
    generatedAt: base?.generatedAt ?? '',
    sourceEventCount: timeline.isNotEmpty ? timeline.length : 0,
    agents: const [],
    timeline: normalizeItems
        ? timeline.map(_projectionDetailTimelineItem).toList()
        : timeline,
    requestSpans: base?.requestSpans ?? const [],
    attempts: base?.attempts ?? const [],
  );
}

/// Legacy tool-detail mapper: keep agent-scoped tool/message items visible in
/// the shared feed builder by projecting them onto main scope.
ThreadRunProjectionTimelineItem _projectionDetailTimelineItem(
  ThreadRunProjectionTimelineItem item,
) {
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
    runAttemptId: item.runAttemptId,
    requestId: item.requestId,
    streamKey: item.streamKey,
    metadata: item.metadata,
  );
}

/// Desktop-aligned subagent detail rules:
/// - mission is shown once as a leading user bubble
/// - `@mission` envelopes / lifecycle events are suppressed
/// - agent-scope `message.user` follow-ups become user bubbles
/// - duplicate mission prompts are suppressed
ThreadRunProjectionTimelineItem? _projectionAgentDetailTimelineItem(
  ThreadRunProjectionTimelineItem item,
  String missionDisplay,
) {
  if (item.eventType == 'agent.started' ||
      item.eventType == 'agent.stopped' ||
      item.eventType == 'agent.abandoned') {
    return null;
  }
  if (item.eventType == 'thinking.final' && item.text.trim().isEmpty) {
    return null;
  }
  if (isSubagentMissionEnvelope(item.text)) {
    return null;
  }
  if (_isProjectionSubagentPromptItem(item)) {
    final text = resolveMissionDisplayText(item.text).trim();
    if (text.isEmpty) return null;
    if (missionDisplay.isNotEmpty && text == missionDisplay) return null;
    return ThreadRunProjectionTimelineItem(
      id: item.id,
      sequence: item.sequence,
      eventType: 'thread.status',
      scope: 'main',
      text: text,
      at: item.at,
      role: 'user',
      agentId: item.agentId,
      runAttemptId: item.runAttemptId,
      requestId: item.requestId,
      streamKey: item.streamKey,
      metadata: {...?item.metadata, 'liveType': 'thread.user_prompt'},
    );
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
    runAttemptId: item.runAttemptId,
    requestId: item.requestId,
    streamKey: item.streamKey,
    metadata: item.metadata,
  );
}

bool _isProjectionSubagentPromptItem(ThreadRunProjectionTimelineItem item) {
  final liveType = item.metadata?['liveType'];
  return item.scope == 'agent' &&
      liveType == 'message.user' &&
      item.text.trim().isNotEmpty;
}

List<ThreadRunProjectionTimelineItem> _normalizeAgentDetailTimeline(
  List<ThreadRunProjectionTimelineItem> timeline, {
  required String missionDisplay,
}) {
  final mapped = <ThreadRunProjectionTimelineItem>[];
  for (final item in timeline) {
    final next = _projectionAgentDetailTimelineItem(item, missionDisplay);
    if (next != null) mapped.add(next);
  }

  // Match desktop: put follow-up prompt bubbles before their request.started.
  final ordered = <ThreadRunProjectionTimelineItem>[];
  for (var index = 0; index < mapped.length; index += 1) {
    final item = mapped[index];
    final next = index + 1 < mapped.length ? mapped[index + 1] : null;
    final itemLiveType = item.metadata?['liveType'];
    final nextLiveType = next?.metadata?['liveType'];
    if (item.eventType == 'request.started' &&
        item.requestId != null &&
        item.requestId!.isNotEmpty &&
        next != null &&
        next.requestId == item.requestId &&
        nextLiveType == 'thread.user_prompt' &&
        itemLiveType != 'thread.user_prompt') {
      ordered.add(next);
      ordered.add(item);
      index += 1;
      continue;
    }
    ordered.add(item);
  }

  if (missionDisplay.isEmpty) return ordered;
  return [
    ThreadRunProjectionTimelineItem(
      id: 'subagent-mission-prompt',
      sequence: -1,
      eventType: 'thread.status',
      scope: 'main',
      text: missionDisplay,
      at: ordered.isNotEmpty ? ordered.first.at : '',
      role: 'user',
      metadata: const {'liveType': 'thread.user_prompt'},
    ),
    ...ordered,
  ];
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
    required this.emptyText,
    required this.loadFuture,
    required this.loadImageView,
    required this.baseProjection,
    required this.cachedTimeline,
    this.title,
    this.missionText,
    this.injectMainThreadUserPrompts = true,
  });

  final String threadId;
  final String emptyText;
  final Future<ThreadRunProjectionDetailResult?> loadFuture;
  final ActivityFeedImageViewLoader loadImageView;
  final ThreadRunProjectionSnapshot? baseProjection;
  final List<ThreadRunProjectionTimelineItem> cachedTimeline;
  final String? title;
  final String? missionText;
  final bool injectMainThreadUserPrompts;

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
    final title = widget.title?.trim() ?? '';
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 8, 4),
          child: Row(
            children: [
              if (title.isNotEmpty) ...[
                Icon(EcoIcons.agent, size: 18, color: eco.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: eco.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ] else
                const Spacer(),
              Tooltip(
                message: context.l10n.commonClose,
                child: IconButton(
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
            final entries = buildProjectionDetailEntries(
              threadId: widget.threadId,
              base: widget.baseProjection,
              cachedTimeline: widget.cachedTimeline,
              detail: snapshot.data,
              l10n: context.l10n,
              missionText: widget.missionText,
              injectMainThreadUserPrompts: widget.injectMainThreadUserPrompts,
            );
            Widget body;
            if (entries.isEmpty && loading) {
              body = _ProjectionDetailStatusList(
                scrollController: _scrollController,
                title: context.l10n.threadRequestingDetails,
                loading: true,
              );
            } else if (entries.isEmpty) {
              if (snapshot.hasError) {
                body = _ProjectionDetailStatusList(
                  scrollController: _scrollController,
                  title: context.l10n.threadDetailsFailed,
                  detail: localizedAppError(snapshot.error!, context.l10n),
                );
              } else {
                final detail = snapshot.data;
                body = _ProjectionDetailStatusList(
                  scrollController: _scrollController,
                  title: detail == null
                      ? context.l10n.threadNoDetailsResponse
                      : detail.timeline.isEmpty
                      ? context.l10n.threadZeroDetails
                      : widget.emptyText,
                  detail: detail == null
                      ? context.l10n.threadDetailsUnparseable
                      : detail.timeline.isEmpty
                      ? context.l10n.threadDetailsComplete(
                          detail.kind,
                          detail.key,
                        )
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
                      shrinkWrap: true,
                      showScrollJumpButton: false,
                      loadImageView: widget.loadImageView,
                      padding: const EdgeInsets.fromLTRB(
                        threadSessionFeedHorizontalPadding,
                        12,
                        threadSessionFeedHorizontalPadding,
                        8,
                      ),
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
            return ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: _projectionDetailMaxBodyHeight(context),
              ),
              child: body,
            );
          },
        ),
      ],
    );
  }
}

double _projectionDetailMaxBodyHeight(BuildContext context) =>
    MediaQuery.sizeOf(context).height * 0.66;

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
      shrinkWrap: true,
      primary: false,
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

List<ActivityFeedEntry> buildProjectionDetailEntries({
  required String threadId,
  required ThreadRunProjectionSnapshot? base,
  required List<ThreadRunProjectionTimelineItem> cachedTimeline,
  required ThreadRunProjectionDetailResult? detail,
  required AppLocalizations l10n,
  String? missionText,
  bool injectMainThreadUserPrompts = true,
}) {
  final timeline = _mergeProjectionDetailTimeline(
    cachedTimeline,
    detail?.timeline ?? const [],
  );
  final missionDisplay = resolveMissionDisplayText(missionText ?? '').trim();

  if (!injectMainThreadUserPrompts) {
    final normalized = _normalizeAgentDetailTimeline(
      timeline,
      missionDisplay: missionDisplay,
    );
    final detailProjection = _projectionDetailSnapshot(
      threadId: threadId,
      base: base,
      timeline: normalized,
      normalizeItems: false,
    );
    return buildActivityFeed(
      threadPrompt: '',
      threadId: threadId,
      runProjection: detailProjection,
      l10n: l10n,
    );
  }

  // Tool rows expand a scoped timeline, not a chat turn.
  final detailProjection = _projectionDetailSnapshot(
    threadId: threadId,
    base: base,
    timeline: timeline,
  );
  return buildActivityFeed(
    threadPrompt: '',
    threadId: threadId,
    runProjection: detailProjection,
    l10n: l10n,
    groupTurns: false,
    groupActions: false,
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

class _EditingFollowUpBanner extends StatelessWidget {
  const _EditingFollowUpBanner({required this.onCancel});

  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: composerStackOuterPadding,
      child: ComposerStackCard(
        padding: composerStackRowPadding,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(EcoIcons.followUp, size: 16, color: eco.accentText),
            const SizedBox(width: 8),
            Text(
              context.l10n.threadEditingGuidance,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: eco.composerPillText),
            ),
            const SizedBox(width: 4),
            IconButton(
              onPressed: onCancel,
              icon: const Icon(EcoIcons.close, size: 16),
              tooltip: context.l10n.commonCancel,
              style: TextButton.styleFrom(
                foregroundColor: eco.composerPillText,
                padding: EdgeInsets.zero,
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
