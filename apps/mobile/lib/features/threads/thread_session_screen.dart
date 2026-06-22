import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/git_models.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import '../../core/utils/thread_status.dart';
import '../approvals/approval_sheets.dart';
import '../composer/session_composer.dart';
import '../projects/project_providers.dart';
import 'activity_feed.dart';
import 'thread_info_sheets.dart';
import 'thread_menu_sheets.dart';
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
  final _attachments = <PromptImageAttachment>[];
  final _picker = ImagePicker();
  String? _shownApprovalKey;
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
    });
  }

  @override
  void didChangeMetrics() {
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final inset = MediaQuery.viewInsetsOf(context).bottom;
      if (inset > _lastKeyboardInset) {
        _scrollToBottom(animated: false);
      }
      _lastKeyboardInset = inset;
    });
  }

  void _scrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      final target = _scrollController.position.maxScrollExtent;
      if (animated) {
        _scrollController.animateTo(
          target,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      } else {
        _scrollController.jumpTo(target);
      }
    });
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

  bool _isAwaitingPlan(ThreadSummary? thread, ThreadSessionState session) {
    if (thread == null) return false;
    return session.pendingPlan?.threadId == thread.id;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    final gitStatusAsync = workspacePath.isNotEmpty
        ? ref.watch(gitStatusProvider(workspacePath))
        : const AsyncValue<GitWorkingTreeStatus?>.data(null);
    final gitStatus = gitStatusAsync.valueOrNull;
    final isRunning = _isRunning(thread);
    final isAwaitingPlan = _isAwaitingPlan(thread, session);
    final canStopThread = isRunning || isAwaitingPlan;
    final planFailureMessage = isAwaitingPlan
        ? extractPlanFailureMessage(thread?.message ?? '')
        : null;
    final followUpMode = isLiveFollowUpThreadStatus(thread?.status);
    final queuedFollowUps = queuedThreadFollowUps(session.followUps)
        .where((item) => item.id != _editingFollowUpId)
        .toList();

    ref.listen(threadSessionProvider(widget.threadId), (previous, next) {
      if (next.loading) return;
      final previousApprovalKey =
          previous == null ? null : _approvalKey(previous);
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
          _showApprovalSheets(next);
        }
      }
      final previousFeed = previous == null
          ? 0
          : buildActivityFeed(
              lines: previous.activities,
              threadPrompt: previous.thread?.prompt,
              threadId: widget.threadId,
              runProjection: previous.runProjection,
              subagentSessions: previous.subagentSessions,
            ).length;
      final nextFeed = buildActivityFeed(
        lines: next.activities,
        threadPrompt: next.thread?.prompt,
        threadId: widget.threadId,
        runProjection: next.runProjection,
        subagentSessions: next.subagentSessions,
      ).length;
      if (previousFeed != nextFeed) {
        _scrollToBottom();
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
        projectName: project?.name,
        runtimeConfig: runtimeConfig,
        isRunning: isRunning,
        gitStatus: gitStatus,
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: session.loading
                      ? const Center(child: CircularProgressIndicator())
                      : session.error != null
                          ? Center(child: Text(session.error!))
                          : showLanding
                              ? Padding(
                                  padding: EdgeInsets.fromLTRB(
                                    32,
                                    sessionToolbarFrostHeight(context),
                                    32,
                                    32,
                                  ),
                                  child: Align(
                                    alignment: Alignment.center,
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
                              : _ThreadSessionFeedPane(
                                  threadId: widget.threadId,
                                  scrollController: _scrollController,
                                  isRunning: isRunning,
                                  billing: session.billing,
                                  threadStatus: thread?.status,
                                ),
                ),
              ],
            ),
          ),
          AnimatedPadding(
            duration: const Duration(milliseconds: 100),
            curve: Curves.easeOut,
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (queuedFollowUps.isNotEmpty)
                  _FollowUpBar(
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
                    onViewPlan: () => _showApprovalSheets(session),
                    onApprove: () => _handlePlanApproval(
                      approve: true,
                    ),
                    onDismiss: () => _handlePlanApproval(
                      approve: false,
                    ),
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
                  hasActivity: session.activities.isNotEmpty,
                  inputHint: _editingFollowUpId != null
                      ? '编辑引导消息…'
                      : (showLanding ? composerLandingPlaceholder : null),
                  contextSnapshot: session.contextSnapshot,
                  threadStatus: thread?.status,
                  workspaceDiff: workspaceDiffAsync.valueOrNull,
                  diffLoading: workspaceDiffAsync.isReloading,
                  onPickImage: _pickImage,
                  onRemoveAttachment: (index) =>
                      setState(() => _attachments.removeAt(index)),
                  onSend: () => _sendMessage(runtimeConfig),
                  onStop: () => _stopThread(),
                  onRuntimeConfigChanged: (config) {
                    ref.read(runtimeConfigProvider.notifier).state = config;
                  },
                  onChangesTap: workspacePath.isNotEmpty
                      ? () => showWorkspaceDiffReviewSheet(
                            context: context,
                            ref: ref,
                            workspacePath: workspacePath,
                          )
                      : null,
                ),
              ],
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
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
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('运行中引导消息暂不支持图片附件。')),
            );
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
          await rpc.followUpEnqueue(
            threadId: widget.threadId,
            prompt: prompt,
          );
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    }
  }

  void _showApprovalSheets(ThreadSessionState session) {
    if (!_needsApprovalSheet(session)) return;
    final thread = session.thread;
    if (session.pendingPlan != null &&
        session.pendingPlan!.threadId == thread?.id) {
      showPlanApprovalSheet(
        context: context,
        plan: session.pendingPlan!,
        onApprove: () => _handlePlanApproval(approve: true),
        onDismiss: () => _handlePlanApproval(approve: false),
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

class _ThreadSessionFeedPane extends ConsumerWidget {
  const _ThreadSessionFeedPane({
    required this.threadId,
    required this.scrollController,
    required this.isRunning,
    required this.billing,
    this.threadStatus,
  });

  final String threadId;
  final ScrollController scrollController;
  final bool isRunning;
  final ThreadBillingSnapshot? billing;
  final String? threadStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(threadSessionProvider(threadId));
    final thread = session.thread;
    final feedEntries = buildActivityFeed(
      lines: session.activities,
      threadPrompt: thread?.prompt,
      threadId: threadId,
      runProjection: session.runProjection,
      subagentSessions: session.subagentSessions,
    );
    final hasStreamingThinking = feedEntries.any(
      (entry) => entry.kind == ActivityFeedKind.thinking && entry.streaming,
    );
    final hasStreamingAssistant = feedEntries.any(
      (entry) => entry.kind == ActivityFeedKind.assistant && entry.streaming,
    );
    final displayFeedEntries = isRunning &&
            !hasStreamingThinking &&
            !hasStreamingAssistant
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

    return Stack(
      children: [
        ActivityFeedList(
          entries: displayFeedEntries,
          scrollController: scrollController,
          topPadding: sessionContentTopPadding(context),
        ),
        Positioned(
          right: 8,
          bottom: 8,
          child: ThreadUsageFloatButtons(
            billing: billing,
            threadStatus: threadStatus,
          ),
        ),
      ],
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
    final eco = ecoColors(context);
    final retryMode = failureMessage != null;
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
                    retryMode ? '执行失败，计划待确认' : '计划已生成，等待确认',
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
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () => onApprove(),
                    child: Text(retryMode ? '重试执行' : '批准执行'),
                  ),
                ),
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
    final eco = ecoColors(context);
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

class _FollowUpBar extends StatelessWidget {
  const _FollowUpBar({
    required this.followUps,
    required this.cancelBusyId,
    required this.escalateBusyId,
    required this.onEscalate,
    required this.onEdit,
    required this.onDelete,
  });

  final List<ThreadPendingFollowUp> followUps;
  final String? cancelBusyId;
  final String? escalateBusyId;
  final Future<void> Function(ThreadPendingFollowUp followUp) onEscalate;
  final void Function(ThreadPendingFollowUp followUp) onEdit;
  final Future<void> Function(ThreadPendingFollowUp followUp) onDelete;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ecoColors(context).cardSurface,
        border: Border(top: BorderSide(color: ecoColors(context).borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  Icon(EcoIcons.subthread, size: 16, color: ecoColors(context).textMuted),
                  const SizedBox(width: 6),
                  Text('引导消息', style: Theme.of(context).textTheme.labelLarge),
                ],
              ),
            ),
            ...followUps.map((item) {
              final actionBusy =
                  cancelBusyId == item.id || escalateBusyId == item.id;
              final canEscalate = item.priority != 'escalated';
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: ecoColors(context).bgElevated,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: ecoColors(context).borderSubtle),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Icon(
                                EcoIcons.indent,
                                size: 16,
                                color: ecoColors(context).textMuted,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                formatThreadFollowUpPreview(item),
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            _FollowUpActionButton(
                              icon: escalateBusyId == item.id
                                  ? null
                                  : EcoIcons.indent,
                              label: escalateBusyId == item.id ? '处理中…' : '引导',
                              loading: escalateBusyId == item.id,
                              enabled: canEscalate && !actionBusy,
                              onPressed: canEscalate && !actionBusy
                                  ? () => onEscalate(item)
                                  : null,
                            ),
                            const SizedBox(width: 8),
                            _FollowUpActionButton(
                              icon: EcoIcons.edit,
                              label: '修改',
                              enabled: !actionBusy,
                              onPressed:
                                  !actionBusy ? () => onEdit(item) : null,
                            ),
                            const SizedBox(width: 8),
                            _FollowUpActionButton(
                              icon: cancelBusyId == item.id
                                  ? null
                                  : EcoIcons.delete,
                              label: cancelBusyId == item.id ? '删除中…' : '删除',
                              loading: cancelBusyId == item.id,
                              enabled: !actionBusy,
                              danger: true,
                              onPressed:
                                  !actionBusy ? () => onDelete(item) : null,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _FollowUpActionButton extends StatelessWidget {
  const _FollowUpActionButton({
    required this.label,
    required this.enabled,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.danger = false,
  });

  final String label;
  final bool enabled;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = !enabled
        ? ecoColors(context).textMuted
        : (danger ? ecoColors(context).danger : ecoColors(context).accentText);
    return TextButton(
      onPressed: enabled ? onPressed : null,
      style: TextButton.styleFrom(
        foregroundColor: color,
        disabledForegroundColor: ecoColors(context).textMuted,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (loading)
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: color,
              ),
            )
          else if (icon != null)
            Icon(icon, size: 14, color: color),
          if (loading || icon != null) const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.labelMedium),
        ],
      ),
    );
  }
}
