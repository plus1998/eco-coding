import 'dart:async';
import 'dart:convert';

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/locale/app_error_localizations.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/image_view_models.dart';
import '../../core/models/thread_run_projection.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/feed_action_kind.dart';
import '../../core/utils/file_change.dart';
import '../../core/utils/feed_text.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/stream_text.dart';
import '../../core/utils/prompt_image_attachment.dart';
import '../../core/utils/subagent_projection_feed.dart';
import '../../core/utils/subagent_session_timing.dart'
    show formatSubagentDuration;
import '../../core/widgets/activity_feed_block.dart';
import '../../core/widgets/eco_markdown.dart';
import '../../core/widgets/eco_surface_card.dart';
import '../../core/widgets/paced_stream_text.dart';
import '../../core/widgets/shimmer_text.dart';
import '../../core/theme/subagent_theme.dart';
import '../../l10n/generated/app_localizations.dart';
import 'activity_feed_scroll_coordinator.dart';
import 'projection_activity_feed.dart';
import 'thread_session_layout.dart';

/// Feed primary text shares the theme body size across all entry types.
const activityFeedBodyFontScale = 1.0;
const activityFeedLoadEarlierThreshold = 160.0;
const activityFeedLoadingIndicatorSize = 24.0;
const _scrollToBottomButtonSize = 36.0;
const _scrollToBottomButtonAlignedBottomGap = 6.0;

typedef ActivityFeedEntryCallback = void Function(ActivityFeedEntry entry);
typedef ActivityFeedToolDetailLoader =
    Future<List<ActivityFeedEntry>> Function(ActivityFeedEntry entry);
typedef ActivityFeedImageViewLoader =
    Future<ImageViewReadData> Function(ActivityFeedEntry entry);
typedef ActivityFeedEarlierLoader = Future<void> Function();
typedef ActivityFeedLoadErrorCallback = void Function(Object error);
typedef ActivityFeedUserMessageEditLoader =
    Future<ThreadUserMessageEditGetResult> Function(String activityLineId);
typedef ActivityFeedUserMessageRewriteHandler =
    Future<void> Function({
      required String activityLineId,
      required String prompt,
      required List<PromptImageAttachment> attachments,
      required int expectedHistoryRevision,
    });

bool shouldLoadEarlierActivityFeed({
  required double extentAfter,
  required bool hasEarlier,
  required bool loadingEarlier,
  required bool shrinkWrap,
  double threshold = activityFeedLoadEarlierThreshold,
}) {
  return !shrinkWrap &&
      hasEarlier &&
      !loadingEarlier &&
      extentAfter <= threshold;
}

TextStyle? activityFeedBodyStyle(
  BuildContext context, {
  Color? color,
  double height = 1.55,
}) {
  final base = Theme.of(context).textTheme.bodyMedium;
  return base?.copyWith(
    fontSize: (base.fontSize ?? 13) * activityFeedBodyFontScale,
    height: height,
    color: color,
  );
}

String _formatTurnDurationMs(int ms) {
  final totalSeconds = (ms ~/ 1000).clamp(0, 1 << 31);
  // Sub-second (or zero) durations omit the label — avoid "已思考 0s".
  if (totalSeconds <= 0) {
    return '';
  }
  final hours = totalSeconds ~/ 3600;
  final minutes = (totalSeconds % 3600) ~/ 60;
  final seconds = totalSeconds % 60;
  final parts = <String>[];
  if (hours > 0) {
    parts.add('${hours}h');
  }
  if (minutes > 0) {
    parts.add('${minutes}m');
  }
  if (seconds > 0 || parts.isEmpty) {
    parts.add('${seconds}s');
  }
  return parts.join(' ');
}

enum ActivityFeedKind {
  turn,
  user,
  clarificationAnswer,
  assistant,
  thinking,
  reasoningStage,
  action,
  imageView,
  actionGroup,
  phase,
  subagentMission,
  error,
}

class ActivityFeedEntry {
  const ActivityFeedEntry({
    required this.id,
    required this.kind,
    required this.text,
    this.actionIcon,
    this.toolName,
    this.subagentRole,
    this.detail,
    this.streaming = false,
    this.usageBadge,
    this.lifecycle,
    this.missionPrompt,
    this.taskName,
    this.agentId,
    this.running = false,
    this.turnStatus,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
    this.bashRun,
    this.fileChange,
    this.webSearch,
    this.imageView,
    this.mcpDiscovery,
    this.toolUseId,
    this.reconnecting = false,
    this.actionChildren = const [],
    this.attachments = const [],
    this.runAttemptId,
    this.requestId,
    this.at,
    this.startedAt,
    this.endedAt,
    this.processEntries = const [],
    this.finalOutput,
    this.rewindTarget,
    this.activityLineId,
    this.historyRevision = 0,
    this.sequence = 0,
  });

  final String id;
  final ActivityFeedKind kind;
  final String text;
  final ActivityActionIcon? actionIcon;
  final String? toolName;
  final String? subagentRole;
  final String? detail;
  final bool streaming;
  final String? usageBadge;
  final ToolActionLifecycle? lifecycle;
  final String? missionPrompt;
  final String? taskName;
  final String? agentId;
  final bool running;
  final String? turnStatus;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;
  final BashRunCardDisplay? bashRun;
  final FileChangeCardDisplay? fileChange;
  final WebSearchCardDisplay? webSearch;
  final ImageViewDisplay? imageView;
  final ActionKindMcpDiscovery? mcpDiscovery;
  final String? toolUseId;
  final bool reconnecting;
  final List<ActivityFeedEntry> actionChildren;
  final List<PromptImageAttachment> attachments;
  final String? runAttemptId;
  final String? requestId;
  final String? at;
  final String? startedAt;
  final String? endedAt;
  final List<ActivityFeedEntry> processEntries;
  final ActivityFeedEntry? finalOutput;
  final ThreadActivityRewindTarget? rewindTarget;
  final String? activityLineId;
  final int historyRevision;
  final int sequence;

  ActivityFeedEntry withSequence(int sequence) {
    if (this.sequence == sequence) return this;
    return ActivityFeedEntry(
      id: id,
      kind: kind,
      text: text,
      actionIcon: actionIcon,
      toolName: toolName,
      subagentRole: subagentRole,
      detail: detail,
      streaming: streaming,
      usageBadge: usageBadge,
      lifecycle: lifecycle,
      missionPrompt: missionPrompt,
      taskName: taskName,
      agentId: agentId,
      running: running,
      turnStatus: turnStatus,
      durationMs: durationMs,
      statusText: statusText,
      timeline: timeline,
      bashRun: bashRun,
      fileChange: fileChange,
      webSearch: webSearch,
      imageView: imageView,
      mcpDiscovery: mcpDiscovery,
      toolUseId: toolUseId,
      reconnecting: reconnecting,
      actionChildren: actionChildren,
      attachments: attachments,
      runAttemptId: runAttemptId,
      requestId: requestId,
      at: at,
      startedAt: startedAt,
      endedAt: endedAt,
      processEntries: processEntries,
      finalOutput: finalOutput,
      rewindTarget: rewindTarget,
      activityLineId: activityLineId,
      historyRevision: historyRevision,
      sequence: sequence,
    );
  }
}

bool isProjectionFeedReady(ThreadRunProjectionSnapshot? projection) {
  return projection != null && projection.sourceEventCount > 0;
}

List<ActivityFeedEntry> buildActivityFeed({
  String? threadPrompt,
  String? threadId,
  ThreadRunProjectionSnapshot? runProjection,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
  AppLocalizations? l10n,
  bool groupTurns = true,
  bool groupActions = true,
}) {
  if (!isProjectionFeedReady(runProjection)) {
    return const [];
  }
  final strings = l10n ?? lookupAppLocalizations(const Locale('zh'));
  final projected = buildProjectionActivityFeed(
    projection: runProjection!,
    threadPrompt: threadPrompt,
    threadId: threadId,
    subagentSessions: subagentSessions,
    l10n: strings,
  );
  final groupedActions = groupActions
      ? groupActivityFeedActionEntries(projected, l10n: strings)
      : projected;
  final groupedThinking = groupConsecutiveThinkingEntries(groupedActions);
  return groupTurns
      ? groupProjectionActivityFeedTurns(groupedThinking, runProjection)
      : groupedThinking;
}

List<ActivityFeedEntry> groupActivityFeedActionEntries(
  List<ActivityFeedEntry> entries, {
  AppLocalizations? l10n,
}) {
  final strings = l10n ?? lookupAppLocalizations(const Locale('zh'));
  final grouped = <ActivityFeedEntry>[];
  var pending = <ActivityFeedEntry>[];

  void flush() {
    if (pending.isNotEmpty) {
      grouped.add(_buildActionGroupEntry(pending, strings));
    }
    pending = <ActivityFeedEntry>[];
  }

  for (final entry in entries) {
    if (entry.kind == ActivityFeedKind.action) {
      pending.add(entry);
      continue;
    }
    flush();
    grouped.add(entry);
  }
  flush();
  return grouped;
}

/// Combines adjacent thinking rows into one collapsible panel.
///
/// Reasoning-stage rows stay distinct from raw thinking. Any non-thinking
/// row, agent, or run attempt change ends the current group.
List<ActivityFeedEntry> groupConsecutiveThinkingEntries(
  List<ActivityFeedEntry> entries,
) {
  final grouped = <ActivityFeedEntry>[];
  var pending = <ActivityFeedEntry>[];

  void flush() {
    if (pending.isEmpty) return;
    grouped.add(
      pending.length == 1 ? pending.first : _buildThinkingGroupEntry(pending),
    );
    pending = <ActivityFeedEntry>[];
  }

  for (final entry in entries) {
    if (entry.kind == ActivityFeedKind.thinking &&
        (pending.isEmpty || _canJoinThinkingEntries(pending.last, entry))) {
      pending.add(entry);
      continue;
    }
    flush();
    if (entry.kind == ActivityFeedKind.thinking) {
      pending.add(entry);
    } else {
      grouped.add(entry);
    }
  }
  flush();
  return grouped;
}

bool _canJoinThinkingEntries(
  ActivityFeedEntry previous,
  ActivityFeedEntry next,
) {
  return previous.kind == ActivityFeedKind.thinking &&
      next.kind == ActivityFeedKind.thinking &&
      _sameThinkingContext(previous.agentId, next.agentId) &&
      _sameThinkingContext(previous.runAttemptId, next.runAttemptId) &&
      _sameThinkingContext(previous.requestId, next.requestId);
}

bool _sameThinkingContext(String? left, String? right) {
  return (left?.trim() ?? '') == (right?.trim() ?? '');
}

ActivityFeedEntry _buildThinkingGroupEntry(List<ActivityFeedEntry> entries) {
  final first = entries.first;
  final last = entries.last;
  final streaming = entries.any((entry) => entry.streaming);
  final startedAt = entries
      .map((entry) => entry.startedAt?.trim())
      .whereType<String>()
      .firstWhere((value) => value.isNotEmpty, orElse: () => '');
  final text = entries
      .map((entry) => entry.text.trim())
      .where((value) => value.isNotEmpty)
      .join('\n\n');

  return ActivityFeedEntry(
    id: first.id,
    kind: ActivityFeedKind.thinking,
    text: text,
    streaming: streaming,
    agentId: first.agentId,
    runAttemptId: first.runAttemptId,
    requestId: first.requestId,
    at: first.at,
    startedAt: startedAt.isEmpty ? null : startedAt,
    endedAt: streaming ? null : last.endedAt,
    durationMs: entries.fold(0, (total, entry) => total + entry.durationMs),
    sequence: first.sequence,
  );
}

ActivityFeedEntry _buildActionGroupEntry(
  List<ActivityFeedEntry> entries,
  AppLocalizations l10n,
) {
  final first = entries.first;
  final summary = _summarizeActionEntries(entries, l10n);
  return ActivityFeedEntry(
    id: 'action-group:${first.id}',
    kind: ActivityFeedKind.actionGroup,
    text: summary.label,
    actionIcon: summary.icon,
    lifecycle: _resolveActionGroupLifecycle(entries),
    actionChildren: List<ActivityFeedEntry>.unmodifiable(entries),
    runAttemptId: _sharedRunAttemptId(entries),
    at: first.at,
    sequence: first.sequence,
  );
}

String? _sharedRunAttemptId(List<ActivityFeedEntry> entries) {
  final ids = entries
      .map((entry) => entry.runAttemptId?.trim())
      .whereType<String>()
      .where((id) => id.isNotEmpty)
      .toSet();
  return ids.length == 1 ? ids.single : null;
}

/// Prefer human-readable bash title over the raw command for collapsed
/// action-group summaries (especially while a command is still running).
String _actionSummaryTarget(ActivityFeedEntry entry) {
  final webSearch = entry.webSearch;
  if (webSearch != null && webSearch.query.trim().isNotEmpty) {
    return webSearch.query.trim();
  }
  final bashRun = entry.bashRun;
  if (bashRun != null) {
    final title = bashRun.title.trim();
    if (title.isNotEmpty && title != 'Shell') return title;
    final command = bashRun.command?.trim() ?? '';
    if (command.isNotEmpty) return command;
  }
  final path = entry.fileChange?.path.trim();
  if (path != null && path.isNotEmpty) return path;
  return entry.text;
}

ActionKindPayload _payloadFromEntry(ActivityFeedEntry entry) {
  final fileChange = entry.fileChange;
  final webSearch = entry.webSearch;
  final imageView = entry.imageView;
  final bashRun = entry.bashRun;
  return ActionKindPayload(
    fileChange: fileChange == null
        ? null
        : ActionKindFileChange(
            path: fileChange.path,
            fileName: fileChange.fileName,
          ),
    webSearch: webSearch == null
        ? null
        : ActionKindWebSearch(
            mode: webSearch.kind == 'fetch' ? 'fetch' : 'search',
            query: webSearch.query,
            url: webSearch.url,
          ),
    imageView: imageView == null
        ? null
        : ActionKindImageView(path: imageView.path),
    bashRun: bashRun == null
        ? null
        : ActionKindBashRun(command: bashRun.command),
    mcpDiscovery: entry.mcpDiscovery,
  );
}

String? _toolNameForActionIcon(ActivityActionIcon? icon) {
  return switch (icon) {
    ActivityActionIcon.search => 'Grep',
    ActivityActionIcon.read => 'Read',
    ActivityActionIcon.file => 'Read',
    ActivityActionIcon.edit => 'Edit',
    ActivityActionIcon.terminal => 'Bash',
    ActivityActionIcon.agent => 'Agent',
    ActivityActionIcon.network => 'WebSearch',
    ActivityActionIcon.image => 'ViewImage',
    ActivityActionIcon.images => 'ViewImage',
    ActivityActionIcon.browser => 'mcp__eco_agent_browser__browser',
    ActivityActionIcon.tool || ActivityActionIcon.context || null => null,
  };
}

ResolvedAction _resolveFeedEntryAction(ActivityFeedEntry entry) {
  final toolName = entry.toolName?.trim() ?? '';
  final payload = _payloadFromEntry(entry);
  if (toolName.isNotEmpty) {
    return resolveActionKind(toolName: toolName, payload: payload);
  }
  final fromPayload = resolveActionKind(payload: payload);
  if (fromPayload.kind != ActionKind.tool) {
    return fromPayload;
  }
  return resolveActionKind(
    toolName: _toolNameForActionIcon(entry.actionIcon),
    payload: payload,
  );
}

String _formatFeedActionLine(
  ActivityFeedEntry entry,
  ActionLinePhase phase,
  AppLocalizations l10n,
) {
  return formatActionLine(
    resolved: _resolveFeedEntryAction(entry),
    phase: phase,
    rawTarget: _actionSummaryTarget(entry),
    payload: _payloadFromEntry(entry),
    l10n: l10n,
  );
}

({String label, ActivityActionIcon icon}) _summarizeActionLine(
  ActivityFeedEntry entry,
  ActionLinePhase phase,
  AppLocalizations l10n,
) {
  final resolved = _resolveFeedEntryAction(entry);
  return (
    label: formatActionLine(
      resolved: resolved,
      phase: phase,
      rawTarget: _actionSummaryTarget(entry),
      payload: _payloadFromEntry(entry),
      l10n: l10n,
    ),
    icon: resolved.icon,
  );
}

({String label, ActivityActionIcon icon}) _summarizeActionEntries(
  List<ActivityFeedEntry> entries,
  AppLocalizations l10n,
) {
  for (final entry in entries.reversed) {
    if (entry.lifecycle == ToolActionLifecycle.failed) {
      return _summarizeActionLine(entry, ActionLinePhase.done, l10n);
    }
  }
  for (final entry in entries.reversed) {
    if (entry.lifecycle == ToolActionLifecycle.running) {
      return _summarizeActionLine(entry, ActionLinePhase.running, l10n);
    }
  }
  if (entries.length == 1) {
    return _summarizeActionLine(entries.single, ActionLinePhase.done, l10n);
  }

  final fileBucketKeys = <ActionGroupBucket, Set<String>>{};
  final items = <ResolvedAction>[];
  for (final entry in entries) {
    final action = _resolveFeedEntryAction(entry);
    if (action.bucket == ActionGroupBucket.readFiles ||
        action.bucket == ActionGroupBucket.writtenFiles ||
        action.bucket == ActionGroupBucket.editedFiles) {
      final key = entry.fileChange?.path.trim().isNotEmpty == true
          ? entry.fileChange!.path.trim()
          : _actionSummaryTarget(entry);
      final seen = fileBucketKeys.putIfAbsent(action.bucket, () => <String>{});
      if (!seen.add(key)) continue;
    }
    items.add(action);
  }
  return summarizeActionGroup(items, l10n);
}

String _formatActionChildLabel(ActivityFeedEntry entry, AppLocalizations l10n) {
  return _formatFeedActionLine(entry, ActionLinePhase.done, l10n);
}

ToolActionLifecycle? _resolveActionGroupLifecycle(
  List<ActivityFeedEntry> entries,
) {
  final lifecycles = entries
      .map((entry) => entry.lifecycle)
      .whereType<ToolActionLifecycle>()
      .toSet();
  if (lifecycles.contains(ToolActionLifecycle.failed)) {
    return ToolActionLifecycle.failed;
  }
  if (lifecycles.contains(ToolActionLifecycle.running)) {
    return ToolActionLifecycle.running;
  }
  if (lifecycles.contains(ToolActionLifecycle.approvalPending)) {
    return ToolActionLifecycle.approvalPending;
  }
  if (lifecycles.contains(ToolActionLifecycle.approvalRejected)) {
    return ToolActionLifecycle.approvalRejected;
  }
  if (lifecycles.contains(ToolActionLifecycle.approvalApproved)) {
    return ToolActionLifecycle.approvalApproved;
  }
  return lifecycles.isNotEmpty ? ToolActionLifecycle.completed : null;
}

bool shouldAutoScrollActivityFeed({
  required List<ActivityFeedEntry> previous,
  required List<ActivityFeedEntry> next,
}) {
  if (next.length <= previous.length) return false;
  final previousIds = {for (final entry in previous) entry.id};
  final added = next.where((entry) => !previousIds.contains(entry.id)).toList();
  if (added.isEmpty) return false;
  if (added.any(
    (entry) =>
        entry.kind == ActivityFeedKind.action ||
        entry.kind == ActivityFeedKind.imageView ||
        entry.kind == ActivityFeedKind.actionGroup ||
        entry.kind == ActivityFeedKind.subagentMission ||
        entry.kind == ActivityFeedKind.phase,
  )) {
    return false;
  }
  final firstNewIndex = next.indexWhere(
    (entry) => !previousIds.contains(entry.id),
  );
  return firstNewIndex >= previous.length;
}

bool shouldFollowStreamingTail({
  required List<ActivityFeedEntry> previous,
  required List<ActivityFeedEntry> next,
}) {
  if (next.isEmpty) return false;
  final last = _liveFeedTail(next);
  if (!_isLiveThinkingStatus(last)) return false;
  if (previous.isEmpty) return true;
  final previousLast = _liveFeedTail(previous);
  if (previousLast.id != last.id) return false;
  return last.text.length > previousLast.text.length;
}

bool shouldAppendPendingAgentThinking({
  required bool isRunning,
  required List<ActivityFeedEntry> entries,
}) {
  if (!isRunning) return false;
  if (entries.any(_containsRunningContextCompaction)) return false;
  return !entries.any(_containsLiveThinkingStatus);
}

ActivityFeedEntry _liveFeedTail(List<ActivityFeedEntry> entries) {
  final last = entries.last;
  if (last.kind == ActivityFeedKind.turn && last.processEntries.isNotEmpty) {
    return last.processEntries.last;
  }
  return last;
}

bool _isLiveThinkingStatus(ActivityFeedEntry entry) {
  if (entry.kind == ActivityFeedKind.reasoningStage) {
    return true;
  }
  return (entry.kind == ActivityFeedKind.assistant ||
          entry.kind == ActivityFeedKind.thinking) &&
      entry.streaming;
}

bool _containsLiveThinkingStatus(ActivityFeedEntry entry) {
  if (_isLiveThinkingStatus(entry)) {
    return true;
  }
  if (entry.processEntries.any(_containsLiveThinkingStatus)) {
    return true;
  }
  if (entry.actionChildren.any(_containsLiveThinkingStatus)) {
    return true;
  }
  final finalOutput = entry.finalOutput;
  return finalOutput != null && _containsLiveThinkingStatus(finalOutput);
}

bool _containsRunningContextCompaction(ActivityFeedEntry entry) {
  if (entry.actionIcon == ActivityActionIcon.context &&
      entry.lifecycle == ToolActionLifecycle.running) {
    return true;
  }
  if (entry.processEntries.any(_containsRunningContextCompaction)) {
    return true;
  }
  if (entry.actionChildren.any(_containsRunningContextCompaction)) {
    return true;
  }
  final finalOutput = entry.finalOutput;
  return finalOutput != null && _containsRunningContextCompaction(finalOutput);
}

String activityFeedLayoutSignature(List<ActivityFeedEntry> entries) {
  if (entries.isEmpty) return '';
  final last = entries.last;
  return '${entries.length}:${_activityFeedEntrySignature(last)}';
}

bool activityFeedContentChanged({
  required List<ActivityFeedEntry> previous,
  required List<ActivityFeedEntry> next,
}) {
  if (previous.length != next.length) return true;
  for (var index = 0; index < previous.length; index += 1) {
    final before = previous[index];
    final after = next[index];
    if (before.id != after.id) return true;
    if (_activityFeedEntrySignature(before) !=
        _activityFeedEntrySignature(after)) {
      return true;
    }
  }
  return false;
}

String _activityFeedEntrySignature(ActivityFeedEntry entry) {
  final childSignature = entry.actionChildren
      .map((child) => '${child.id}:${child.text.length}:${child.lifecycle}')
      .join(',');
  final processSignature = entry.processEntries
      .map((child) => '${child.id}:${child.text.length}:${child.streaming}')
      .join(',');
  return [
    entry.id,
    entry.kind,
    entry.text.length,
    entry.streaming,
    entry.lifecycle,
    entry.actionChildren.length,
    childSignature,
    entry.running,
    entry.durationMs,
    processSignature,
    entry.finalOutput?.id ?? '',
    entry.finalOutput?.text.length ?? 0,
    entry.imageView?.path ?? '',
  ].join(':');
}

List<ActivityFeedEntry> listMiddleInsertedFeedEntries({
  required List<ActivityFeedEntry> previous,
  required List<ActivityFeedEntry> next,
}) {
  if (next.length <= previous.length) return const [];
  var prefix = 0;
  while (prefix < previous.length &&
      prefix < next.length &&
      previous[prefix].id == next[prefix].id) {
    prefix += 1;
  }
  if (prefix >= previous.length) {
    return const [];
  }
  final previousIds = {for (final entry in previous) entry.id};
  final inserted = <ActivityFeedEntry>[];
  for (var index = prefix; index < next.length; index += 1) {
    final entry = next[index];
    if (!previousIds.contains(entry.id)) {
      inserted.add(entry);
    } else {
      break;
    }
  }
  return inserted;
}

class ActivityFeedList extends StatefulWidget {
  const ActivityFeedList({
    super.key,
    required this.entries,
    required this.scrollController,
    this.scrollCoordinator,
    this.themeSource,
    this.onOpenAgentDetail,
    this.loadToolDetail,
    this.loadImageView,
    this.onLoadUserMessageEdit,
    this.onRewriteUserMessage,
    this.hasEarlier = false,
    this.onLoadEarlier,
    this.onLoadEarlierError,
    this.expandUserPrompts = false,
    this.shrinkWrap = false,
    this.showScrollJumpButton = true,
    this.scrollJumpBottomInset = 0,
    this.padding,
  });

  final List<ActivityFeedEntry> entries;
  final ScrollController scrollController;
  final ActivityFeedScrollCoordinator? scrollCoordinator;
  final SubagentThemeSource? themeSource;
  final ActivityFeedEntryCallback? onOpenAgentDetail;
  final ActivityFeedToolDetailLoader? loadToolDetail;
  final ActivityFeedImageViewLoader? loadImageView;
  final ActivityFeedUserMessageEditLoader? onLoadUserMessageEdit;
  final ActivityFeedUserMessageRewriteHandler? onRewriteUserMessage;
  final bool hasEarlier;
  final ActivityFeedEarlierLoader? onLoadEarlier;
  final ActivityFeedLoadErrorCallback? onLoadEarlierError;
  final bool expandUserPrompts;
  final bool shrinkWrap;
  final bool showScrollJumpButton;
  final double scrollJumpBottomInset;
  final EdgeInsetsGeometry? padding;

  @override
  State<ActivityFeedList> createState() => _ActivityFeedListState();
}

class _ActivityFeedListState extends State<ActivityFeedList> {
  late ActivityFeedScrollCoordinator _coordinator;
  String _layoutSignature = '';
  bool _showScrollJump = false;
  bool _loadingEarlier = false;
  bool _loadEarlierFailed = false;

  @override
  void initState() {
    super.initState();
    _coordinator =
        widget.scrollCoordinator ??
        ActivityFeedScrollCoordinator(widget.scrollController);
    _layoutSignature = activityFeedLayoutSignature(widget.entries);
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadEarlier());
  }

  @override
  void didUpdateWidget(ActivityFeedList oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextSignature = activityFeedLayoutSignature(widget.entries);
    if (nextSignature != _layoutSignature) {
      _layoutSignature = nextSignature;
      _scheduleLayoutScroll();
    }
    if (nextSignature != activityFeedLayoutSignature(oldWidget.entries) ||
        (!oldWidget.hasEarlier && widget.hasEarlier)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadEarlier());
    }
  }

  void _scheduleLayoutScroll() {
    if (widget.shrinkWrap) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _coordinator.scrollToEnd();
      _syncScrollJumpVisibility();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _coordinator.scrollToEnd();
        _syncScrollJumpVisibility();
      });
    });
  }

  void _syncScrollJumpVisibility() {
    final next = _coordinator.userDetachedFromBottom;
    if (next != _showScrollJump) {
      setState(() => _showScrollJump = next);
    }
  }

  Future<void> _maybeLoadEarlier({bool userInitiated = false}) async {
    if (!mounted || !widget.scrollController.hasClients) return;
    if (_loadEarlierFailed && !userInitiated) return;
    if (userInitiated) {
      _loadEarlierFailed = false;
    }
    if (widget.onLoadEarlier == null ||
        !shouldLoadEarlierActivityFeed(
          extentAfter: widget.scrollController.position.extentAfter,
          hasEarlier: widget.hasEarlier,
          loadingEarlier: _loadingEarlier,
          shrinkWrap: widget.shrinkWrap,
        )) {
      return;
    }
    setState(() => _loadingEarlier = true);
    var failed = false;
    try {
      await widget.onLoadEarlier!();
    } catch (error) {
      failed = true;
      _loadEarlierFailed = true;
      widget.onLoadEarlierError?.call(error);
    } finally {
      if (mounted) {
        setState(() => _loadingEarlier = false);
      }
    }
    if (!failed && mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadEarlier());
    }
  }

  @override
  Widget build(BuildContext context) {
    final displayEntries = widget.entries.reversed.toList(growable: false);

    return Stack(
      clipBehavior: Clip.hardEdge,
      children: [
        GestureDetector(
          onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
          behavior: HitTestBehavior.translucent,
          child: NotificationListener<ScrollNotification>(
            onNotification: (notification) {
              _coordinator.onScrollNotification(notification);
              _syncScrollJumpVisibility();
              unawaited(
                _maybeLoadEarlier(
                  userInitiated:
                      notification is ScrollUpdateNotification &&
                      notification.dragDetails != null,
                ),
              );
              return false;
            },
            child: ListView.builder(
              controller: widget.scrollController,
              reverse: true,
              shrinkWrap: widget.shrinkWrap,
              primary: widget.shrinkWrap ? false : null,
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding:
                  widget.padding ??
                  const EdgeInsets.fromLTRB(
                    threadSessionFeedHorizontalPadding,
                    threadSessionComposerGap,
                    threadSessionFeedHorizontalPadding,
                    0,
                  ),
              itemCount: displayEntries.length + (_loadingEarlier ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == displayEntries.length) {
                  return const SizedBox(
                    height: 44,
                    child: Center(
                      child: SizedBox.square(
                        dimension: activityFeedLoadingIndicatorSize,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                }
                final entry = displayEntries[index];
                return _ActivityFeedEntryTile(
                  key: ValueKey(entry.id),
                  entry: entry,
                  themeSource: widget.themeSource,
                  onOpenAgentDetail: widget.onOpenAgentDetail,
                  loadToolDetail: widget.loadToolDetail,
                  loadImageView: widget.loadImageView,
                  onLoadUserMessageEdit: widget.onLoadUserMessageEdit,
                  onRewriteUserMessage: widget.onRewriteUserMessage,
                  expandUserPrompts: widget.expandUserPrompts,
                );
              },
            ),
          ),
        ),
        if (widget.showScrollJumpButton && _showScrollJump)
          Positioned(
            left: 12,
            bottom:
                _scrollToBottomButtonAlignedBottomGap +
                widget.scrollJumpBottomInset,
            child: _ScrollToBottomButton(
              onPressed: () {
                _coordinator.forceScrollToEnd();
                setState(() => _showScrollJump = false);
              },
            ),
          ),
      ],
    );
  }
}

class _ScrollToBottomButton extends StatelessWidget {
  const _ScrollToBottomButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final buttonChild = Semantics(
      button: true,
      label: context.l10n.threadBackToBottom,
      child: SizedBox(
        width: _scrollToBottomButtonSize,
        height: _scrollToBottomButtonSize,
        child: Icon(
          Icons.arrow_downward_rounded,
          size: 18,
          color: colors.textPrimary,
        ),
      ),
    );

    if (PlatformInfo.isIOS) {
      return Tooltip(
        message: context.l10n.threadBackToBottom,
        child: AdaptiveButton.child(
          onPressed: onPressed,
          style: AdaptiveButtonStyle.glass,
          size: AdaptiveButtonSize.medium,
          minSize: const Size(
            _scrollToBottomButtonSize,
            _scrollToBottomButtonSize,
          ),
          enabled: true,
          useSmoothRectangleBorder: false,
          child: buttonChild,
        ),
      );
    }

    return Material(
      color: colors.cardSurface.withValues(alpha: 0.92),
      elevation: 2,
      shadowColor: Colors.black26,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(20),
        child: Tooltip(
          message: context.l10n.threadBackToBottom,
          child: buttonChild,
        ),
      ),
    );
  }
}

class _ActivityFeedEntryTile extends StatelessWidget {
  const _ActivityFeedEntryTile({
    super.key,
    required this.entry,
    this.themeSource,
    this.onOpenAgentDetail,
    this.loadToolDetail,
    this.loadImageView,
    this.onLoadUserMessageEdit,
    this.onRewriteUserMessage,
    this.expandUserPrompts = false,
  });

  final ActivityFeedEntry entry;
  final SubagentThemeSource? themeSource;
  final ActivityFeedEntryCallback? onOpenAgentDetail;
  final ActivityFeedToolDetailLoader? loadToolDetail;
  final ActivityFeedImageViewLoader? loadImageView;
  final ActivityFeedUserMessageEditLoader? onLoadUserMessageEdit;
  final ActivityFeedUserMessageRewriteHandler? onRewriteUserMessage;
  final bool expandUserPrompts;

  @override
  Widget build(BuildContext context) {
    switch (entry.kind) {
      case ActivityFeedKind.turn:
        return _TurnFeedTile(
          entry: entry,
          themeSource: themeSource,
          onOpenAgentDetail: onOpenAgentDetail,
          loadToolDetail: loadToolDetail,
          loadImageView: loadImageView,
        );
      case ActivityFeedKind.user:
        return _UserPromptTile(
          text: entry.text,
          attachments: entry.attachments,
          rewindTarget: entry.rewindTarget,
          historyRevision: entry.historyRevision,
          onLoadUserMessageEdit: onLoadUserMessageEdit,
          onRewriteUserMessage: onRewriteUserMessage,
          initiallyExpanded: expandUserPrompts,
        );
      case ActivityFeedKind.clarificationAnswer:
        return _ClarificationAnswerTile(text: entry.text);
      case ActivityFeedKind.assistant:
        return _AssistantNarrativeTile(
          text: entry.text,
          streaming: entry.streaming,
          usageBadge: entry.usageBadge,
        );
      case ActivityFeedKind.thinking:
        return _ThinkingTile(
          text: entry.text,
          streaming: entry.streaming,
          startedAt: entry.startedAt,
          endedAt: entry.endedAt,
          durationMs: entry.durationMs,
        );
      case ActivityFeedKind.reasoningStage:
        return _WaitingThinkingLine(label: entry.text);
      case ActivityFeedKind.action:
        return _ActionTile(
          label: entry.text,
          icon: entry.actionIcon ?? ActivityActionIcon.file,
          lifecycle: entry.lifecycle,
          bashRun: entry.bashRun,
          fileChange: entry.fileChange,
          webSearch: entry.webSearch,
          toolUseId: entry.toolUseId,
          loadToolDetail: loadToolDetail != null
              ? () => loadToolDetail!(entry)
              : null,
        );
      case ActivityFeedKind.imageView:
        return _ImageViewTile(entry: entry, loadImageView: loadImageView);
      case ActivityFeedKind.actionGroup:
        return _ActionGroupTile(entry: entry, loadToolDetail: loadToolDetail);
      case ActivityFeedKind.phase:
        if (entry.reconnecting) {
          return _ReconnectPhaseTile(summary: entry.text, detail: entry.detail);
        }
        return _PhaseTile(
          text: entry.text,
          detail: entry.detail,
          icon: entry.actionIcon,
          lifecycle: entry.lifecycle,
        );
      case ActivityFeedKind.subagentMission:
        return _SubagentMissionTile(
          role: entry.subagentRole ?? '',
          summary: entry.text,
          prompt: entry.missionPrompt,
          taskName: entry.taskName,
          agentId: entry.agentId,
          attachments: entry.attachments,
          themeSource: themeSource,
          running: entry.running,
          durationMs: entry.durationMs,
          statusText: entry.statusText,
          timeline: entry.timeline,
          onOpenDetail: onOpenAgentDetail != null && entry.attachments.isEmpty
              ? () => onOpenAgentDetail!(entry)
              : null,
        );
      case ActivityFeedKind.error:
        return _ErrorTile(text: entry.text);
    }
  }
}

class _TurnFeedTile extends StatefulWidget {
  const _TurnFeedTile({
    required this.entry,
    this.themeSource,
    this.onOpenAgentDetail,
    this.loadToolDetail,
    this.loadImageView,
  });

  final ActivityFeedEntry entry;
  final SubagentThemeSource? themeSource;
  final ActivityFeedEntryCallback? onOpenAgentDetail;
  final ActivityFeedToolDetailLoader? loadToolDetail;
  final ActivityFeedImageViewLoader? loadImageView;

  @override
  State<_TurnFeedTile> createState() => _TurnFeedTileState();
}

class _TurnFeedTileState extends State<_TurnFeedTile> {
  late bool _expanded;
  late int _durationMs;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _expanded = widget.entry.running;
    _durationMs = _resolveDurationMs();
    _syncTimer();
  }

  @override
  void didUpdateWidget(covariant _TurnFeedTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.entry.id != widget.entry.id) {
      _expanded = widget.entry.running;
    } else if (widget.entry.running) {
      _expanded = true;
    } else if (oldWidget.entry.running && !widget.entry.running) {
      _expanded = false;
    }
    _durationMs = _resolveDurationMs();
    _syncTimer();
  }

  int _resolveDurationMs() {
    final startedAt = DateTime.tryParse(widget.entry.startedAt ?? '');
    final endedAt = DateTime.tryParse(widget.entry.endedAt ?? '');
    if (startedAt == null) return widget.entry.durationMs;
    final end = endedAt ?? DateTime.now();
    return end.difference(startedAt).inMilliseconds.clamp(0, 1 << 31);
  }

  void _syncTimer() {
    _timer?.cancel();
    _timer = null;
    if (!widget.entry.running) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _durationMs = _resolveDurationMs());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final status = _formatTurnStatusLabel(
      entry: widget.entry,
      durationMs: _durationMs,
      l10n: context.l10n,
    );
    final process = widget.entry.processEntries;

    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: !widget.entry.running,
            expanded: _expanded,
            label: widget.entry.running
                ? context.l10n.activityExecutionProcess
                : context.l10n.activityExecutionResult,
            child: InkWell(
              onTap: widget.entry.running
                  ? null
                  : () => setState(() => _expanded = !_expanded),
              borderRadius: BorderRadius.circular(4),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Text(
                          status,
                          style: activityFeedBodyStyle(
                            context,
                            height: 1.4,
                            color: eco.textMuted,
                          )?.copyWith(fontWeight: FontWeight.w500),
                        ),
                        if (!widget.entry.running) ...[
                          const SizedBox(width: 3),
                          AnimatedRotation(
                            turns: _expanded ? 0.25 : 0,
                            duration: const Duration(milliseconds: 180),
                            curve: Curves.easeOut,
                            child: Icon(
                              Icons.chevron_right_rounded,
                              size: 18,
                              color: eco.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                    Divider(height: 1, color: eco.borderSubtle),
                  ],
                ),
              ),
            ),
          ),
          ClipRect(
            child: AnimatedSize(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              alignment: Alignment.topCenter,
              child: _expanded
                  ? Padding(
                      padding: const EdgeInsets.only(top: 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final child in process)
                            _ActivityFeedEntryTile(
                              key: ValueKey(child.id),
                              entry: child,
                              themeSource: widget.themeSource,
                              onOpenAgentDetail: widget.onOpenAgentDetail,
                              loadToolDetail: widget.loadToolDetail,
                              loadImageView: widget.loadImageView,
                            ),
                        ],
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ),
          if (widget.entry.finalOutput != null)
            Padding(
              padding: const EdgeInsets.only(top: 9),
              child: Semantics(
                label: context.l10n.activityFinalOutput,
                child: _ActivityFeedEntryTile(
                  entry: widget.entry.finalOutput!,
                  themeSource: widget.themeSource,
                  onOpenAgentDetail: widget.onOpenAgentDetail,
                  loadToolDetail: widget.loadToolDetail,
                  loadImageView: widget.loadImageView,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String _formatTurnStatusLabel({
  required ActivityFeedEntry entry,
  required int durationMs,
  required AppLocalizations l10n,
}) {
  if (entry.running) {
    final duration = _formatTurnDurationMs(durationMs);
    return duration.isEmpty
        ? l10n.activityProcessing
        : '${l10n.activityProcessing} $duration';
  }

  if (entry.turnStatus == 'cancelled' || entry.turnStatus == 'failed') {
    final duration = _formatStoppedTurnDurationMs(durationMs, l10n.localeName);
    if (entry.turnStatus == 'cancelled') {
      return duration.isEmpty
          ? l10n.activityStoppedByYou
          : l10n.activityStoppedByYouAfter(duration);
    }
    return duration.isEmpty
        ? l10n.activityStoppedUnexpectedly
        : l10n.activityStoppedUnexpectedlyAfter(duration);
  }

  final duration = _formatTurnDurationMs(durationMs);
  return duration.isEmpty
      ? l10n.activityProcessed
      : '${l10n.activityProcessed} $duration';
}

String _formatStoppedTurnDurationMs(int ms, String localeName) {
  final duration = _formatTurnDurationMs(ms);
  if (duration.isEmpty || !localeName.toLowerCase().startsWith('zh')) {
    return duration;
  }
  return duration
      .replaceAllMapped(RegExp(r'(\d+)h\b'), (match) => '${match.group(1)}小时')
      .replaceAllMapped(RegExp(r'(\d+)m\b'), (match) => '${match.group(1)}分')
      .replaceAllMapped(RegExp(r'(\d+)s\b'), (match) => '${match.group(1)}秒');
}

class _UserPromptTile extends StatefulWidget {
  const _UserPromptTile({
    required this.text,
    this.attachments = const [],
    this.rewindTarget,
    this.historyRevision = 0,
    this.onLoadUserMessageEdit,
    this.onRewriteUserMessage,
    this.initiallyExpanded = false,
  });

  final String text;
  final List<PromptImageAttachment> attachments;
  final ThreadActivityRewindTarget? rewindTarget;
  final int historyRevision;
  final ActivityFeedUserMessageEditLoader? onLoadUserMessageEdit;
  final ActivityFeedUserMessageRewriteHandler? onRewriteUserMessage;
  final bool initiallyExpanded;

  @override
  State<_UserPromptTile> createState() => _UserPromptTileState();
}

class _UserPromptTileState extends State<_UserPromptTile> {
  static const _collapsedMaxLines = 5;
  static const _maxEditImages = 5;

  late var _expanded = widget.initiallyExpanded;
  final _editController = TextEditingController();
  final _picker = ImagePicker();
  var _editing = false;
  var _editLoading = false;
  var _editSaving = false;
  var _editAttachments = <PromptImageAttachment>[];
  var _editRevision = 0;
  String? _editError;
  var _editRequest = 0;

  bool get _canEdit =>
      widget.rewindTarget != null &&
      widget.onLoadUserMessageEdit != null &&
      widget.onRewriteUserMessage != null;

  @override
  void initState() {
    super.initState();
    _editController.text = widget.text;
    _editRevision = widget.historyRevision;
    _editAttachments = List.of(widget.attachments);
  }

  @override
  void didUpdateWidget(covariant _UserPromptTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.text != widget.text ||
        oldWidget.initiallyExpanded != widget.initiallyExpanded ||
        oldWidget.historyRevision != widget.historyRevision ||
        oldWidget.rewindTarget?.activityLineId !=
            widget.rewindTarget?.activityLineId) {
      _expanded = widget.initiallyExpanded;
      _editRequest += 1;
      _editing = false;
      _editLoading = false;
      _editSaving = false;
      _editError = null;
      _editController.text = widget.text;
      _editRevision = widget.historyRevision;
      _editAttachments = List.of(widget.attachments);
    }
  }

  @override
  void dispose() {
    _editController.dispose();
    _editFocusNode.dispose();
    super.dispose();
  }

  Future<void> _beginEdit() async {
    final target = widget.rewindTarget;
    final loader = widget.onLoadUserMessageEdit;
    if (!_canEdit || target == null || loader == null) return;
    final request = ++_editRequest;
    setState(() {
      _editing = true;
      _editLoading = true;
      _editSaving = false;
      _editError = null;
      _editController.text = widget.text;
      _editRevision = widget.historyRevision;
      _editAttachments = List.of(widget.attachments);
    });
    try {
      final result = await loader(target.activityLineId);
      if (!mounted || request != _editRequest) return;
      if (!result.capability.isReady) {
        setState(() {
          _editError = result.capability.reason?.trim().isNotEmpty == true
              ? result.capability.reason!.trim()
              : _editUnavailableText(context);
        });
        return;
      }
      setState(() {
        _editController.text = result.text;
        _editController.selection = TextSelection.collapsed(
          offset: result.text.length,
        );
        _editAttachments = List.of(result.attachments);
        _editRevision = result.historyRevision;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || request != _editRequest) return;
        FocusScope.of(context).requestFocus(_editFocusNode);
      });
    } catch (error) {
      if (mounted && request == _editRequest) {
        setState(() => _editError = error.toString());
      }
    } finally {
      if (mounted && request == _editRequest) {
        setState(() => _editLoading = false);
      }
    }
  }

  final _editFocusNode = FocusNode();

  String _editUnavailableText(BuildContext context) =>
      context.l10n.commonUnavailable;

  void _cancelEdit() {
    _editRequest += 1;
    setState(() {
      _editing = false;
      _editLoading = false;
      _editSaving = false;
      _editError = null;
      _editController.text = widget.text;
      _editRevision = widget.historyRevision;
      _editAttachments = List.of(widget.attachments);
    });
  }

  Future<void> _pickEditImage() async {
    if (_editLoading ||
        _editSaving ||
        _editAttachments.length >= _maxEditImages) {
      return;
    }
    final file = await _picker.pickImage(source: ImageSource.gallery);
    if (file == null || !mounted) return;
    final attachment = await promptImageAttachmentFromXFile(file);
    if (!mounted) return;
    if (attachment == null) {
      setState(() => _editError = context.l10n.composerUnsupportedImage);
      return;
    }
    setState(() {
      _editAttachments = [..._editAttachments, attachment];
      _editError = null;
    });
  }

  Future<void> _submitEdit() async {
    final target = widget.rewindTarget;
    final rewrite = widget.onRewriteUserMessage;
    if (target == null || rewrite == null || _editLoading || _editSaving) {
      return;
    }
    final prompt = _editController.text.trim();
    if (prompt.isEmpty && _editAttachments.isEmpty) {
      setState(() => _editError = _emptyEditMessageText(context));
      return;
    }
    setState(() {
      _editSaving = true;
      _editError = null;
    });
    try {
      await rewrite(
        activityLineId: target.activityLineId,
        prompt: prompt,
        attachments: List.of(_editAttachments),
        expectedHistoryRevision: _editRevision,
      );
      if (mounted) {
        setState(() {
          _editing = false;
          _editSaving = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _editSaving = false;
          _editError = error.toString();
        });
      }
    }
  }

  String _emptyEditMessageText(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'zh'
      ? '消息不能为空'
      : 'Message cannot be empty';

  Widget _buildImage(PromptImageAttachment attachment, {double size = 108}) {
    try {
      return Image.memory(
        base64Decode(attachment.data),
        width: size,
        height: size,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) =>
            const Center(child: Icon(Icons.broken_image_outlined)),
      );
    } on FormatException {
      return const Center(child: Icon(Icons.broken_image_outlined));
    }
  }

  Widget _buildEditBubble(BuildContext context, double maxBubbleWidth) {
    final eco = ecoColors(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      decoration: BoxDecoration(
        color: eco.userBubble,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _editController,
            focusNode: _editFocusNode,
            minLines: 2,
            maxLines: 8,
            enabled: !_editLoading && !_editSaving,
            textInputAction: TextInputAction.newline,
            decoration: InputDecoration(
              hintText: context.l10n.threadEditGuidanceHint,
              border: InputBorder.none,
              isDense: true,
              contentPadding: EdgeInsets.zero,
            ),
            style: activityFeedBodyStyle(
              context,
              height: 1.45,
              color: eco.textPrimary,
            ),
          ),
          if (_editAttachments.isNotEmpty) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 88,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _editAttachments.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (context, index) {
                  final attachment = _editAttachments[index];
                  return Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: SizedBox.square(
                          dimension: 88,
                          child: _buildImage(attachment, size: 88),
                        ),
                      ),
                      Positioned(
                        top: 2,
                        right: 2,
                        child: IconButton(
                          onPressed: _editLoading || _editSaving
                              ? null
                              : () => setState(
                                  () => _editAttachments = [
                                    ..._editAttachments.take(index),
                                    ..._editAttachments.skip(index + 1),
                                  ],
                                ),
                          icon: const Icon(Icons.close, size: 16),
                          tooltip: context.l10n.commonDelete,
                          visualDensity: VisualDensity.compact,
                          style: IconButton.styleFrom(
                            backgroundColor: Colors.black54,
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.zero,
                            minimumSize: const Size(26, 26),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
          Row(
            children: [
              IconButton(
                onPressed:
                    _editLoading ||
                        _editSaving ||
                        _editAttachments.length >= _maxEditImages
                    ? null
                    : _pickEditImage,
                icon: const Icon(Icons.add_photo_alternate_outlined, size: 20),
                tooltip: context.l10n.composerAddImage,
                visualDensity: VisualDensity.compact,
              ),
              const Spacer(),
              IconButton(
                onPressed: _editSaving ? null : _cancelEdit,
                icon: const Icon(Icons.close, size: 19),
                tooltip: context.l10n.commonCancel,
                visualDensity: VisualDensity.compact,
              ),
              IconButton(
                onPressed: _editLoading || _editSaving ? null : _submitEdit,
                icon: _editSaving
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check, size: 20),
                tooltip: context.l10n.commonSubmit,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          if (_editLoading)
            Text(
              context.l10n.commonLoading,
              style: Theme.of(
                context,
              ).textTheme.labelSmall?.copyWith(color: eco.textMuted),
            ),
          if (_editError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                _editError!,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildReadOnlyBubble(BuildContext context, double maxBubbleWidth) {
    final eco = ecoColors(context);
    const horizontalPadding = 28.0;
    final textStyle = activityFeedBodyStyle(
      context,
      height: 1.45,
      color: eco.textPrimary,
    );

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: eco.userBubble,
        borderRadius: BorderRadius.circular(16),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bodyMaxWidth = (constraints.maxWidth - horizontalPadding).clamp(
            0.0,
            maxBubbleWidth - horizontalPadding,
          );
          final canExpand = _textExceedsLineLimit(
            text: widget.text,
            style: textStyle,
            maxWidth: bodyMaxWidth,
            maxLines: _collapsedMaxLines,
            textDirection: Directionality.of(context),
          );
          final showCollapsed = canExpand && !_expanded;
          final galleryWidth = (widget.attachments.length * 108.0).clamp(
            0.0,
            maxBubbleWidth - horizontalPadding,
          );

          return IntrinsicWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (widget.attachments.isNotEmpty) ...[
                  SizedBox(
                    width: galleryWidth,
                    height: 108,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: widget.attachments.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 6),
                      itemBuilder: (context, index) => ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: SizedBox.square(
                          dimension: 108,
                          child: _buildImage(widget.attachments[index]),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                AnimatedSize(
                  duration: const Duration(milliseconds: 150),
                  curve: Curves.easeOut,
                  alignment: Alignment.topRight,
                  child: showCollapsed
                      ? ShaderMask(
                          blendMode: BlendMode.dstIn,
                          shaderCallback: (bounds) {
                            return const LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Color(0xFF000000),
                                Color(0xFF000000),
                                Color(0x00000000),
                              ],
                              stops: [0, 0.45, 1],
                            ).createShader(bounds);
                          },
                          child: Text(
                            widget.text,
                            maxLines: _collapsedMaxLines,
                            overflow: TextOverflow.clip,
                            style: textStyle,
                          ),
                        )
                      : Text(widget.text, style: textStyle),
                ),
                if (canExpand)
                  Align(
                    alignment: Alignment.center,
                    child: TextButton(
                      onPressed: () => setState(() => _expanded = !_expanded),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity: VisualDensity.compact,
                      ),
                      child: Text(
                        _expanded
                            ? context.l10n.commonCollapse
                            : context.l10n.activityExpandFull,
                        style: Theme.of(
                          context,
                        ).textTheme.labelSmall?.copyWith(color: eco.textMuted),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final maxBubbleWidth = MediaQuery.of(context).size.width * 0.88;
    final editButtonWidth = _canEdit ? 42.0 : 0.0;

    return Align(
      alignment: Alignment.centerRight,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: maxBubbleWidth - editButtonWidth,
            ),
            child: _editing
                ? _buildEditBubble(context, maxBubbleWidth - editButtonWidth)
                : _buildReadOnlyBubble(
                    context,
                    maxBubbleWidth - editButtonWidth,
                  ),
          ),
          if (_canEdit && !_editing)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: IconButton(
                onPressed: _beginEdit,
                icon: const Icon(Icons.edit_outlined, size: 18),
                tooltip: context.l10n.activityEditing,
                visualDensity: VisualDensity.compact,
                style: IconButton.styleFrom(
                  foregroundColor: ecoColors(context).textMuted,
                  minimumSize: const Size(38, 38),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ClarificationAnswerTile extends StatelessWidget {
  const _ClarificationAnswerTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final rows = parseClarificationAnswersSummary(text) ?? const [];
    final eco = ecoColors(context);

    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.88,
        ),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          decoration: BoxDecoration(
            color: eco.userBubble,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: eco.borderSubtle),
          ),
          child: IntrinsicWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  context.l10n.activityClarificationAnswer,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: eco.textMuted,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 10),
                for (var index = 0; index < rows.length; index++) ...[
                  if (index > 0) const SizedBox(height: 10),
                  Text(
                    rows[index].question,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    rows[index].answer.isEmpty
                        ? context.l10n.activityNoneSelected
                        : rows[index].answer,
                    style: activityFeedBodyStyle(context, height: 1.45),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantNarrativeTile extends StatelessWidget {
  const _AssistantNarrativeTile({
    required this.text,
    this.streaming = false,
    this.usageBadge,
  });

  final String text;
  final bool streaming;
  final String? usageBadge;

  @override
  Widget build(BuildContext context) {
    final sanitizedText = sanitizeFeedText(text);
    return PacedStreamText(
      text: sanitizedText,
      streaming: streaming,
      builder: (context, displayText, revealing) => _AssistantNarrativeContent(
        text: displayText,
        streaming: streaming || revealing,
        usageBadge: usageBadge,
      ),
    );
  }
}

class _AssistantNarrativeContent extends StatelessWidget {
  const _AssistantNarrativeContent({
    required this.text,
    required this.streaming,
    this.usageBadge,
  });

  final String text;
  final bool streaming;
  final String? usageBadge;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty && usageBadge != null) {
      return _UsageBadgeLine(badge: usageBadge!);
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text.isNotEmpty)
            streaming
                ? _StreamingFeedMarkdown(
                    text: text,
                    color: ecoColors(context).textHeading,
                  )
                : EcoMarkdown(
                    text: text,
                    selectable: false,
                    fontSizeScale: activityFeedBodyFontScale,
                  ),
          if (usageBadge != null) ...[
            const SizedBox(height: 6),
            _UsageBadgeLine(badge: usageBadge!),
          ],
          if (streaming && text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '…',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).textMuted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StreamingFeedMarkdown extends StatelessWidget {
  const _StreamingFeedMarkdown({
    required this.text,
    this.compact = false,
    this.muted = false,
    this.color,
  });

  final String text;
  final bool compact;
  final bool muted;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final partition = partitionStreamingMarkdown(text, streaming: true);
    final structuralTail = isStructuralStreamingTail(partition.tail);
    final tailStyle = activityFeedBodyStyle(
      context,
      color: color ?? ecoColors(context).textMuted,
      height: compact ? 1.45 : 1.55,
    );
    if (!structuralTail) {
      return EcoMarkdown(
        text: text,
        compact: compact,
        muted: muted,
        selectable: false,
        fontSizeScale: activityFeedBodyFontScale,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (partition.stable.trim().isNotEmpty)
          EcoMarkdown(
            text: partition.stable,
            compact: compact,
            muted: muted,
            selectable: false,
            fontSizeScale: activityFeedBodyFontScale,
          ),
        if (partition.tail.isNotEmpty) Text(partition.tail, style: tailStyle),
      ],
    );
  }
}

/// Empty/live thinking status — same shell for "正在思考" and ephemeral
/// reasoning summary.
class _WaitingThinkingLine extends StatelessWidget {
  const _WaitingThinkingLine({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
      child: ShimmerText(
        key: const ValueKey('activity-waiting-thinking'),
        text: label,
        style: activityFeedBodyStyle(context, height: 1.4),
        baseColor: ecoColors(context).textMuted,
        highlightColor: ecoColors(context).textSecondary,
      ),
    );
  }
}

class _ThinkingTile extends StatelessWidget {
  const _ThinkingTile({
    required this.text,
    this.streaming = false,
    this.startedAt,
    this.endedAt,
    this.durationMs = 0,
  });

  final String text;
  final bool streaming;
  final String? startedAt;
  final String? endedAt;
  final int durationMs;

  @override
  Widget build(BuildContext context) {
    final sanitizedText = sanitizeFeedText(text);
    return PacedStreamText(
      text: sanitizedText,
      streaming: streaming,
      builder: (context, displayText, revealing) => _ThinkingTileBody(
        text: displayText,
        streaming: streaming,
        revealing: revealing,
        startedAt: startedAt,
        endedAt: endedAt,
        durationMs: durationMs,
      ),
    );
  }
}

class _ThinkingTileBody extends StatefulWidget {
  const _ThinkingTileBody({
    required this.text,
    required this.streaming,
    required this.revealing,
    this.startedAt,
    this.endedAt,
    this.durationMs = 0,
  });

  final String text;
  final bool streaming;
  final bool revealing;
  final String? startedAt;
  final String? endedAt;
  final int durationMs;

  @override
  State<_ThinkingTileBody> createState() => _ThinkingTileBodyState();
}

class _ThinkingTileBodyState extends State<_ThinkingTileBody> {
  var _expanded = false;
  var _settling = false;
  late int _durationMs;
  Timer? _timer;
  Timer? _settleTimer;

  bool get _activelyStreaming => widget.streaming || widget.revealing;

  @override
  void initState() {
    super.initState();
    _expanded = _activelyStreaming;
    _durationMs = _resolveDurationMs();
    _syncTimer();
  }

  @override
  void didUpdateWidget(covariant _ThinkingTileBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    final wasActive = oldWidget.streaming || oldWidget.revealing;
    final isActive = _activelyStreaming;
    if (wasActive && !isActive) {
      _expanded = false;
      _startSettling();
    } else if (isActive && !_expanded) {
      _cancelSettling();
      _expanded = true;
    }
    _durationMs = _resolveDurationMs();
    _syncTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _settleTimer?.cancel();
    super.dispose();
  }

  void _cancelSettling() {
    _settleTimer?.cancel();
    _settleTimer = null;
    if (_settling) _settling = false;
  }

  void _startSettling() {
    _cancelSettling();
    _settling = true;
    _settleTimer = Timer(const Duration(milliseconds: 480), () {
      if (!mounted) return;
      setState(() {
        _settling = false;
        _settleTimer = null;
      });
    });
  }

  int _resolveDurationMs() {
    final startedAt = DateTime.tryParse(widget.startedAt ?? '');
    final endedAt = DateTime.tryParse(widget.endedAt ?? '');
    if (startedAt == null) return widget.durationMs;
    final end = endedAt ?? DateTime.now();
    final measured = end.difference(startedAt).inMilliseconds.clamp(0, 1 << 31);
    return measured > widget.durationMs ? measured : widget.durationMs;
  }

  void _syncTimer() {
    _timer?.cancel();
    _timer = null;
    if (!_activelyStreaming || widget.startedAt == null) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _durationMs = _resolveDurationMs());
    });
  }

  @override
  Widget build(BuildContext context) {
    final hasBody = widget.text.trim().isNotEmpty;
    if (!_activelyStreaming && !hasBody) {
      return const SizedBox.shrink();
    }

    // Empty streaming keeps the original shimmer-only waiting row (no fold icon).
    if (_activelyStreaming && !hasBody) {
      return _WaitingThinkingLine(label: context.l10n.activityThinking);
    }

    final isExpanded = _activelyStreaming || _expanded || _settling;
    final showDetails = hasBody && isExpanded;
    final eco = ecoColors(context);
    final baseLabel = _activelyStreaming
        ? context.l10n.activityThinking
        : context.l10n.activityDeepThinkingDone;
    final duration = _formatTurnDurationMs(_durationMs);
    final label = duration.isEmpty ? baseLabel : '$baseLabel $duration';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ActionSummaryLine(
            label: label,
            icon: EcoIcons.sparkles,
            iconKey: const ValueKey('activity-thinking-icon'),
            lifecycle: _activelyStreaming ? ToolActionLifecycle.running : null,
            // Chevron only after a manual expand — never while auto-open
            // (streaming / settle), matching desktop hover-only disclosure.
            expanded: _expanded && !_activelyStreaming,
            onTap: () {
              if (_activelyStreaming) return;
              if (_settling) {
                setState(() => _cancelSettling());
                return;
              }
              setState(() => _expanded = !_expanded);
            },
          ),
          ClipRect(
            child: AnimatedSize(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              alignment: Alignment.topCenter,
              child: showDetails
                  ? Padding(
                      padding: const EdgeInsets.only(left: 12, top: 8),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border(
                            left: BorderSide(color: eco.borderSubtle),
                          ),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.only(left: 12),
                          child: _activelyStreaming
                              ? _StreamingFeedMarkdown(
                                  text: widget.text,
                                  compact: true,
                                  muted: true,
                                  color: eco.textMuted.withValues(alpha: 0.9),
                                )
                              : EcoMarkdown(
                                  text: widget.text,
                                  compact: true,
                                  muted: true,
                                  selectable: false,
                                  fontSizeScale: activityFeedBodyFontScale,
                                ),
                        ),
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ),
        ],
      ),
    );
  }
}

class _UsageBadgeLine extends StatelessWidget {
  const _UsageBadgeLine({required this.badge});

  final String badge;

  @override
  Widget build(BuildContext context) {
    return Text(
      badge,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
        color: ecoColors(context).textMuted,
        fontSize: 11,
        letterSpacing: 0.2,
      ),
    );
  }
}

class _ActionGroupTile extends StatefulWidget {
  const _ActionGroupTile({required this.entry, this.loadToolDetail});

  final ActivityFeedEntry entry;
  final ActivityFeedToolDetailLoader? loadToolDetail;

  @override
  State<_ActionGroupTile> createState() => _ActionGroupTileState();
}

class _ActionGroupTileState extends State<_ActionGroupTile> {
  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final children = widget.entry.actionChildren;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ActionSummaryLine(
            label: widget.entry.text,
            icon: EcoIcons.activityAction(
              widget.entry.actionIcon ?? ActivityActionIcon.file,
            ),
            // Aggregated group titles never show the failure dot; failed Bash
            // children keep their own subtle indicator on the row/detail title.
            lifecycle: widget.entry.lifecycle == ToolActionLifecycle.failed
                ? ToolActionLifecycle.completed
                : widget.entry.lifecycle,
            expanded: _expanded,
            onTap: () => setState(() => _expanded = !_expanded),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.only(left: 12, top: 8),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border(
                    left: BorderSide(color: ecoColors(context).borderSubtle),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.only(left: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final child in children)
                        _ActionTile(
                          key: ValueKey(child.id),
                          label: _formatActionChildLabel(child, context.l10n),
                          icon: child.actionIcon ?? ActivityActionIcon.file,
                          lifecycle: child.lifecycle,
                          bashRun: child.bashRun,
                          fileChange: child.fileChange,
                          webSearch: child.webSearch,
                          toolUseId: child.toolUseId,
                          loadToolDetail: widget.loadToolDetail != null
                              ? () => widget.loadToolDetail!(child)
                              : null,
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
}

class _ActionTile extends StatefulWidget {
  const _ActionTile({
    super.key,
    required this.label,
    required this.icon,
    this.lifecycle,
    this.bashRun,
    this.fileChange,
    this.webSearch,
    this.toolUseId,
    this.loadToolDetail,
  });

  final String label;
  final ActivityActionIcon icon;
  final ToolActionLifecycle? lifecycle;
  final BashRunCardDisplay? bashRun;
  final FileChangeCardDisplay? fileChange;
  final WebSearchCardDisplay? webSearch;
  final String? toolUseId;
  final Future<List<ActivityFeedEntry>> Function()? loadToolDetail;

  @override
  State<_ActionTile> createState() => _ActionTileState();
}

class _ActionTileState extends State<_ActionTile> {
  var _expanded = false;
  Future<List<ActivityFeedEntry>>? _detailFuture;
  BashRunCardDisplay? _loadedBashRun;
  Object? _bashDetailError;

  void _toggleDetails() {
    setState(() {
      _expanded = !_expanded;
      final needsBashDetail =
          widget.bashRun != null &&
          widget.bashRun!.output?.trim().isEmpty != false &&
          widget.toolUseId?.trim().isNotEmpty == true &&
          widget.loadToolDetail != null;
      final shouldLoadDetail =
          widget.webSearch == null &&
          (widget.bashRun == null || needsBashDetail);
      if (_expanded &&
          shouldLoadDetail &&
          widget.fileChange == null &&
          _detailFuture == null) {
        _detailFuture = widget.loadToolDetail?.call();
        if (widget.bashRun != null && _detailFuture != null) {
          _detailFuture!.then(
            (entries) {
              if (!mounted) return;
              final bashRun = _findBashRunDetail(entries);
              if (bashRun == null) return;
              setState(() => _loadedBashRun = bashRun);
            },
            onError: (Object error) {
              if (!mounted) return;
              setState(() => _bashDetailError = error);
            },
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final fileChange = widget.fileChange;
    final bashRun = _loadedBashRun ?? widget.bashRun;
    final webSearch = widget.webSearch;
    final needsBashDetail =
        bashRun != null &&
        bashRun.output?.trim().isEmpty != false &&
        widget.toolUseId?.trim().isNotEmpty == true &&
        widget.loadToolDetail != null;
    final canExpand =
        fileChange != null ||
        bashRun != null ||
        webSearch != null ||
        (widget.toolUseId?.trim().isNotEmpty == true &&
            widget.loadToolDetail != null);

    if (webSearch != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ActionSummaryLine(
              label: widget.label.trim().isNotEmpty
                  ? widget.label
                  : _webSearchActionSummaryLabel(
                      webSearch,
                      widget.lifecycle,
                      context.l10n,
                    ),
              icon: EcoIcons.activityAction(widget.icon),
              lifecycle: widget.lifecycle,
              expanded: _expanded,
              onTap: _toggleDetails,
            ),
            if (_expanded)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _WebSearchCard(
                  display: webSearch,
                  lifecycle: widget.lifecycle,
                ),
              ),
          ],
        ),
      );
    }
    if (fileChange != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ActionSummaryLine(
              label: widget.label.trim().isNotEmpty
                  ? widget.label
                  : fileChange.fileName,
              icon: EcoIcons.activityAction(widget.icon),
              lifecycle: widget.lifecycle,
              expanded: _expanded,
              additions: fileChange.additions,
              deletions: fileChange.deletions,
              onTap: _toggleDetails,
            ),
            if (_expanded)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _FileChangeCard(
                  display: fileChange,
                  lifecycle: widget.lifecycle,
                ),
              ),
          ],
        ),
      );
    }
    if (bashRun != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ActionSummaryLine(
              label: _bashActionSummaryLabel(
                bashRun,
                widget.lifecycle,
                context.l10n,
              ),
              icon: EcoIcons.activityAction(widget.icon),
              lifecycle: widget.lifecycle,
              expanded: _expanded,
              onTap: _toggleDetails,
            ),
            if (_expanded)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _BashRunCard(
                      display: bashRun,
                      lifecycle: widget.lifecycle,
                      showHeader: false,
                    ),
                    if (needsBashDetail &&
                        _detailFuture != null &&
                        _loadedBashRun == null &&
                        _bashDetailError == null)
                      const Padding(
                        padding: EdgeInsets.only(top: 10),
                        child: Center(
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      ),
                    if (_bashDetailError != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          localizedAppError(_bashDetailError!, context.l10n),
                          style: activityFeedBodyStyle(
                            context,
                            color: ecoColors(context).statusDenyText,
                            height: 1.4,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ActionSummaryLine(
            label: widget.label,
            icon: EcoIcons.activityAction(widget.icon),
            lifecycle: widget.lifecycle,
            expanded: canExpand ? _expanded : false,
            onTap: canExpand ? _toggleDetails : null,
          ),
          if (_expanded && _detailFuture != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _InlineToolDetail(future: _detailFuture!),
            ),
        ],
      ),
    );
  }
}

class _ImageViewTile extends StatefulWidget {
  const _ImageViewTile({required this.entry, this.loadImageView});

  final ActivityFeedEntry entry;
  final ActivityFeedImageViewLoader? loadImageView;

  @override
  State<_ImageViewTile> createState() => _ImageViewTileState();
}

class _ImageViewTileState extends State<_ImageViewTile> {
  var _expanded = false;
  Future<ImageViewReadData>? _imageFuture;

  @override
  void didUpdateWidget(covariant _ImageViewTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldImage = oldWidget.entry.imageView;
    final image = widget.entry.imageView;
    if (oldImage?.path != image?.path || oldImage?.eventId != image?.eventId) {
      _expanded = false;
      _imageFuture = null;
    }
  }

  Future<ImageViewReadData> _loadImage() async {
    final loader = widget.loadImageView;
    await Future<void>.value();
    if (loader == null) {
      throw const ImageViewReadException(
        ImageViewReadFailureCode.bridgeUnavailable,
      );
    }
    return loader(widget.entry);
  }

  Future<ImageViewReadData> _startImageLoad() {
    final future = _loadImage();
    // A fast failure can complete before FutureBuilder attaches its listener.
    future.then<void>(
      (_) {},
      onError: (Object error, StackTrace stackTrace) {},
    );
    return future;
  }

  void _toggleDetails() {
    if (_expanded) {
      setState(() => _expanded = false);
      return;
    }
    setState(() {
      _expanded = true;
      _imageFuture ??= _startImageLoad();
    });
  }

  void _retry() {
    final future = _startImageLoad();
    setState(() {
      _imageFuture = future;
    });
  }

  Future<void> _openLightbox(ImageViewReadData image) {
    return showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.94),
      builder: (context) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: SafeArea(
          child: Stack(
            fit: StackFit.expand,
            children: [
              InteractiveViewer(
                minScale: 0.5,
                maxScale: 6,
                boundaryMargin: const EdgeInsets.all(48),
                child: Center(
                  child: Image.memory(
                    image.bytes,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              ),
              Positioned(
                top: 8,
                left: 16,
                right: 64,
                child: Text(
                  image.fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
              Positioned(
                top: 0,
                right: 4,
                child: Tooltip(
                  message: context.l10n.commonClose,
                  child: IconButton(
                    icon: const Icon(EcoIcons.close),
                    color: Colors.white,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildImageBody(BuildContext context, ImageViewReadData image) {
    final ratio = image.width > 0 && image.height > 0
        ? (image.width / image.height).clamp(0.25, 4.0).toDouble()
        : 1.0;
    return Semantics(
      button: true,
      label: context.l10n.activityImageViewOpen(image.fileName),
      child: InkWell(
        key: ValueKey('activity-image-view-preview-${widget.entry.id}'),
        onTap: () => unawaited(_openLightbox(image)),
        borderRadius: BorderRadius.circular(8),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 320),
          child: AspectRatio(
            aspectRatio: ratio,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: ColoredBox(
                color: Colors.black12,
                child: Image.memory(
                  image.bytes,
                  key: ValueKey('activity-image-view-image-${widget.entry.id}'),
                  semanticLabel: context.l10n.activityImageViewPreviewAlt(
                    image.fileName,
                  ),
                  fit: BoxFit.contain,
                  gaplessPlayback: true,
                  filterQuality: FilterQuality.medium,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildExpandedBody(BuildContext context) {
    final future = _imageFuture;
    if (future == null) return const SizedBox.shrink();
    return FutureBuilder<ImageViewReadData>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Semantics(
            liveRegion: true,
            label: context.l10n.activityImageViewLoading,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    context.l10n.activityImageViewLoading,
                    style: activityFeedBodyStyle(
                      context,
                      color: ecoColors(context).textMuted,
                    ),
                  ),
                ],
              ),
            ),
          );
        }
        if (snapshot.hasError || !snapshot.hasData) {
          final error =
              snapshot.error ??
              const ImageViewReadException(
                ImageViewReadFailureCode.invalidResponse,
              );
          final message = localizedAppError(error, context.l10n);
          return Semantics(
            liveRegion: true,
            label: message,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    EcoIcons.error,
                    size: 17,
                    color: ecoColors(context).statusDenyText,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      message,
                      style: activityFeedBodyStyle(
                        context,
                        color: ecoColors(context).statusDenyText,
                        height: 1.4,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: context.l10n.commonRetry,
                    visualDensity: VisualDensity.compact,
                    icon: Icon(EcoIcons.refresh, size: 17),
                    onPressed: _retry,
                  ),
                ],
              ),
            ),
          );
        }
        return _buildImageBody(context, snapshot.data!);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ActionSummaryLine(
            key: ValueKey('activity-image-view-summary-${widget.entry.id}'),
            label: widget.entry.text,
            icon: EcoIcons.activityAction(
              widget.entry.actionIcon ?? ActivityActionIcon.images,
            ),
            lifecycle: widget.entry.lifecycle,
            expanded: _expanded,
            onTap: _toggleDetails,
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _buildExpandedBody(context),
            ),
        ],
      ),
    );
  }
}

BashRunCardDisplay? _findBashRunDetail(List<ActivityFeedEntry> entries) {
  for (final entry in entries) {
    final bashRun = entry.bashRun;
    if (bashRun?.output?.trim().isNotEmpty == true) {
      return bashRun;
    }
    final nested = _findBashRunDetail(entry.actionChildren);
    if (nested != null) return nested;
  }
  return null;
}

List<ActivityFeedEntry> _flattenInlineToolDetailEntries(
  List<ActivityFeedEntry> entries,
) {
  final flattened = <ActivityFeedEntry>[];
  void add(ActivityFeedEntry entry) {
    if (entry.kind == ActivityFeedKind.actionGroup) {
      for (final child in entry.actionChildren) {
        add(child);
      }
      return;
    }
    flattened.add(entry);
  }

  for (final entry in entries) {
    add(entry);
  }
  return flattened;
}

bool _inlineToolDetailEntryHasBody(ActivityFeedEntry entry) {
  if (entry.kind != ActivityFeedKind.action) return true;
  return entry.bashRun != null ||
      entry.fileChange != null ||
      entry.webSearch != null ||
      (entry.detail ?? entry.text).trim().isNotEmpty;
}

Widget _inlineToolDetailBody(BuildContext context, ActivityFeedEntry entry) {
  if (entry.kind == ActivityFeedKind.action) {
    final bashRun = entry.bashRun;
    if (bashRun != null) {
      return _BashRunCard(
        display: bashRun,
        lifecycle: entry.lifecycle,
        showHeader: false,
      );
    }
    final fileChange = entry.fileChange;
    if (fileChange != null) {
      return _FileChangeCard(display: fileChange, lifecycle: entry.lifecycle);
    }
    final webSearch = entry.webSearch;
    if (webSearch != null) {
      return _WebSearchCard(display: webSearch, lifecycle: entry.lifecycle);
    }
    return EcoMarkdown(
      text: (entry.detail ?? entry.text).trim(),
      compact: true,
      muted: true,
      selectable: false,
      fontSizeScale: activityFeedBodyFontScale,
    );
  }
  return _ActivityFeedEntryTile(entry: entry);
}

class _InlineToolDetail extends StatelessWidget {
  const _InlineToolDetail({required this.future});

  final Future<List<ActivityFeedEntry>> future;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ActivityFeedEntry>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        if (snapshot.hasError) {
          return Text(
            localizedAppError(snapshot.error!, context.l10n),
            style: activityFeedBodyStyle(
              context,
              color: ecoColors(context).statusDenyText,
              height: 1.4,
            ),
          );
        }
        final entries = _flattenInlineToolDetailEntries(
          snapshot.data ?? const [],
        ).where(_inlineToolDetailEntryHasBody).toList();
        if (entries.isEmpty) {
          return Text(
            context.l10n.threadNoToolDetails,
            style: activityFeedBodyStyle(
              context,
              color: ecoColors(context).textMuted,
              height: 1.4,
            ),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(left: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final entry in entries)
                KeyedSubtree(
                  key: ValueKey('inline-tool-detail:${entry.id}'),
                  child: _inlineToolDetailBody(context, entry),
                ),
            ],
          ),
        );
      },
    );
  }
}

String _bashActionSummaryLabel(
  BashRunCardDisplay display,
  ToolActionLifecycle? lifecycle,
  AppLocalizations l10n,
) {
  final command = display.command?.trim();
  final title = display.title.trim();
  final payload = ActionKindPayload(
    bashRun: ActionKindBashRun(
      command: command == null || command.isEmpty ? null : command,
    ),
  );
  final rawTarget = command != null && command.isNotEmpty
      ? command
      : (title.isNotEmpty && title != 'Shell' ? title : null);
  return formatActionLine(
    resolved: resolveActionKind(toolName: 'Bash', payload: payload),
    phase: lifecycle == ToolActionLifecycle.running
        ? ActionLinePhase.running
        : ActionLinePhase.done,
    rawTarget: rawTarget,
    payload: payload,
    l10n: l10n,
  );
}

String _webSearchActionSummaryLabel(
  WebSearchCardDisplay display,
  ToolActionLifecycle? lifecycle,
  AppLocalizations l10n,
) {
  final title = display.title.trim();
  if (title.isEmpty) {
    return display.kind == 'fetch'
        ? l10n.activityWebSearchFetch
        : l10n.activityWebSearch;
  }
  return title;
}

String? _webSearchStatusText(
  WebSearchCardDisplay display,
  ToolActionLifecycle? lifecycle,
  AppLocalizations l10n,
) {
  switch (display.status) {
    case 'started':
      return display.kind == 'fetch'
          ? l10n.activityWebSearchFetching
          : l10n.activityWebSearchSearching;
    case 'failed':
      return l10n.activityWebSearchFailed;
    case 'completed':
      return l10n.activityWebSearchCompleted;
  }
  if (lifecycle == ToolActionLifecycle.running) {
    return display.kind == 'fetch'
        ? l10n.activityWebSearchFetching
        : l10n.activityWebSearchSearching;
  }
  if (lifecycle == ToolActionLifecycle.failed) {
    return l10n.activityWebSearchFailed;
  }
  return null;
}

class _WebSearchCard extends StatelessWidget {
  const _WebSearchCard({required this.display, this.lifecycle});

  final WebSearchCardDisplay display;
  final ToolActionLifecycle? lifecycle;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final status = _webSearchStatusText(display, lifecycle, context.l10n);
    final rows = <Widget>[];

    void addRow(String label, String? value) {
      final normalized = value?.trim();
      if (normalized == null || normalized.isEmpty) return;
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: rows.isEmpty ? 0 : 7),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 48,
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: eco.textMuted,
                    height: 1.35,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  normalized,
                  style: activityFeedBodyStyle(
                    context,
                    color: eco.textSecondary,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    addRow(context.l10n.activityWebSearchQuery, display.query);
    addRow(context.l10n.activityWebSearchStatus, status);
    addRow(context.l10n.activityWebSearchAction, display.actionLabel);
    addRow('URL', display.url);
    addRow(context.l10n.activityWebSearchPattern, display.pattern);
    if (display.queries.length > 1) {
      addRow(
        context.l10n.activityWebSearchQueries,
        display.queries.join(
          context.l10n.localeName.startsWith('zh') ? '、' : ', ',
        ),
      );
    }
    if (display.meta != null) {
      addRow(context.l10n.activityWebSearchDuration, display.meta);
    }

    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(left: 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: eco.borderSubtle)),
        ),
        child: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: rows,
          ),
        ),
      ),
    );
  }
}

class _ActionSummaryLine extends StatelessWidget {
  const _ActionSummaryLine({
    super.key,
    required this.label,
    required this.icon,
    this.iconKey,
    this.lifecycle,
    this.expanded = false,
    this.additions = 0,
    this.deletions = 0,
    this.onTap,
  });

  final String label;
  final IconData icon;
  final Key? iconKey;
  final ToolActionLifecycle? lifecycle;
  final bool expanded;
  final int additions;
  final int deletions;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final failed = lifecycle == ToolActionLifecycle.failed;

    final content = Row(
      children: [
        Icon(icon, key: iconKey, size: 15, color: eco.textMuted),
        const SizedBox(width: 8),
        Expanded(
          child: Row(
            children: [
              Flexible(
                child: lifecycle == ToolActionLifecycle.running
                    ? ShimmerText(
                        text: label,
                        baseColor: eco.textMuted,
                        highlightColor: eco.textSecondary,
                        style: activityFeedBodyStyle(
                          context,
                          color: eco.textMuted,
                          height: 1.35,
                        )?.copyWith(fontWeight: FontWeight.w500),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      )
                    : Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: activityFeedBodyStyle(
                          context,
                          color: eco.textMuted,
                          height: 1.35,
                        )?.copyWith(fontWeight: FontWeight.w500),
                      ),
              ),
              if (failed) ...[
                const SizedBox(width: 6),
                Semantics(
                  label: context.l10n.activityFailed,
                  child: Container(
                    key: const ValueKey('activity-tool-failure-dot'),
                    width: 4,
                    height: 4,
                    decoration: BoxDecoration(
                      color: eco.statusDenyText.withValues(alpha: 0.58),
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ],
              // Match desktop: no permanent disclosure chevron.
              // Only reveal after expand (hover is unavailable on mobile).
              if (onTap != null && expanded) ...[
                const SizedBox(width: 4),
                Icon(EcoIcons.expandUp, size: 17, color: eco.textMuted),
              ],
            ],
          ),
        ),
        if (additions > 0 || deletions > 0) ...[
          const SizedBox(width: 8),
          _InlineDiffStats(additions: additions, deletions: deletions),
        ],
      ],
    );

    if (onTap == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: content,
      );
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: content,
        ),
      ),
    );
  }
}

class _InlineDiffStats extends StatelessWidget {
  const _InlineDiffStats({required this.additions, required this.deletions});

  final int additions;
  final int deletions;

  @override
  Widget build(BuildContext context) {
    final diffPalette = FileChangeDiffPalette.of(ecoColors(context));
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (additions > 0)
          Text(
            '+$additions',
            style: TextStyle(
              color: diffPalette.addStat,
              fontWeight: FontWeight.w600,
              fontSize: 12,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        if (additions > 0 && deletions > 0) const SizedBox(width: 8),
        if (deletions > 0)
          Text(
            '-$deletions',
            style: TextStyle(
              color: diffPalette.removeStat,
              fontWeight: FontWeight.w600,
              fontSize: 12,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
      ],
    );
  }
}

class _BashRunCard extends StatefulWidget {
  const _BashRunCard({
    required this.display,
    this.lifecycle,
    this.showHeader = true,
  });

  final BashRunCardDisplay display;
  final ToolActionLifecycle? lifecycle;
  final bool showHeader;

  @override
  State<_BashRunCard> createState() => _BashRunCardState();
}

class _BashRunCardState extends State<_BashRunCard> {
  static const _collapsedCommandLines = 2;
  static const _collapsedOutputLines = 3;
  bool _bodyExpanded = false;

  @override
  Widget build(BuildContext context) {
    final display = widget.display;
    // Bash cards only surface failure — not a live "running" state (unlike
    // subagent missions). Lifecycle often stays `running` in projection data.
    final failed = widget.lifecycle == ToolActionLifecycle.failed;
    final eco = ecoColors(context);
    final command = display.command?.trim() ?? '';
    final output = display.output?.trim() ?? '';
    final bodyStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: eco.textSecondary,
      fontFamily: 'Menlo',
      height: 1.4,
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final bodyMaxWidth = constraints.maxWidth - 24;
        final textWidth = bodyMaxWidth > 0
            ? bodyMaxWidth
            : constraints.maxWidth;
        final commandCanExpand =
            command.isNotEmpty &&
            _textExceedsLineLimit(
              text: command,
              style: bodyStyle,
              maxWidth: textWidth - 18,
              maxLines: _collapsedCommandLines,
              textDirection: Directionality.of(context),
            );
        final outputCanExpand =
            output.isNotEmpty &&
            _textExceedsLineLimit(
              text: output,
              style: bodyStyle,
              maxWidth: textWidth,
              maxLines: _collapsedOutputLines,
              textDirection: Directionality.of(context),
            );
        final canExpand = commandCanExpand || outputCanExpand;

        return ActivityFeedBlock(
          onTap: canExpand
              ? () => setState(() => _bodyExpanded = !_bodyExpanded)
              : null,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.showHeader)
                ActivityFeedBlockHeader(
                  icon: EcoIcons.terminal,
                  title: display.title,
                  meta: display.meta,
                  iconColor: failed ? eco.danger : eco.textMuted,
                  titleColor: failed ? eco.danger : null,
                  expanded: canExpand ? _bodyExpanded : null,
                  trailing: failed
                      ? ActivityFeedStatusChip(
                          label: context.l10n.activityFailed,
                          danger: true,
                        )
                      : null,
                ),
              if (command.isNotEmpty || output.isNotEmpty) ...[
                if (widget.showHeader) const ActivityFeedBlockDivider(),
                if (command.isNotEmpty)
                  _BashCommandBody(
                    command: command,
                    style: bodyStyle,
                    expanded: _bodyExpanded || !commandCanExpand,
                  ),
                if (command.isNotEmpty && output.isNotEmpty)
                  const ActivityFeedBlockDivider(),
                if (output.isNotEmpty)
                  _BashOutputBody(
                    output: output,
                    style: bodyStyle,
                    expanded: _bodyExpanded || !outputCanExpand,
                  ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _BashCommandBody extends StatelessWidget {
  const _BashCommandBody({
    required this.command,
    required this.style,
    required this.expanded,
  });

  final String command;
  final TextStyle? style;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(r'$', style: style?.copyWith(color: eco.textMuted)),
          const SizedBox(width: 6),
          Expanded(
            child: expanded
                ? SelectableText(command, style: style)
                : Text(
                    command,
                    maxLines: _BashRunCardState._collapsedCommandLines,
                    overflow: TextOverflow.clip,
                    style: style,
                  ),
          ),
        ],
      ),
    );
  }
}

class _BashOutputBody extends StatelessWidget {
  const _BashOutputBody({
    required this.output,
    required this.style,
    required this.expanded,
  });

  final String output;
  final TextStyle? style;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: expanded
          ? SelectableText(output, style: style)
          : Text(
              output,
              maxLines: _BashRunCardState._collapsedOutputLines,
              overflow: TextOverflow.clip,
              style: style,
            ),
    );
  }
}

bool _textExceedsLineLimit({
  required String text,
  required TextStyle? style,
  required double maxWidth,
  required int maxLines,
  required TextDirection textDirection,
}) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    maxLines: maxLines,
    textDirection: textDirection,
  )..layout(maxWidth: maxWidth);
  return painter.didExceedMaxLines;
}

class _FileChangeCard extends StatefulWidget {
  const _FileChangeCard({required this.display, this.lifecycle});

  final FileChangeCardDisplay display;
  final ToolActionLifecycle? lifecycle;

  @override
  State<_FileChangeCard> createState() => _FileChangeCardState();
}

class _FileChangeCardState extends State<_FileChangeCard> {
  static const _collapsedLineLimit = 6;
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final display = widget.display;
    final lifecycle = widget.lifecycle;
    final eco = ecoColors(context);
    final running = lifecycle == ToolActionLifecycle.running;
    final failed = lifecycle == ToolActionLifecycle.failed;
    final previewLines = _expanded
        ? display.previewLines
        : display.previewLines.take(_collapsedLineLimit).toList();
    final hasMore = display.previewLines.length > _collapsedLineLimit;

    final lineStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      fontFamily: 'Menlo',
      height: 1.45,
      color: eco.textSecondary,
    );
    final diffPalette = FileChangeDiffPalette.of(eco);

    String? diffMeta;
    if (display.additions > 0 || display.deletions > 0) {
      final parts = <String>[];
      if (display.additions > 0) parts.add('+${display.additions}');
      if (display.deletions > 0) parts.add('-${display.deletions}');
      diffMeta = parts.join(' ');
    }

    return ActivityFeedBlock(
      onTap: hasMore ? () => setState(() => _expanded = !_expanded) : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ActivityFeedBlockHeader(
            icon: EcoIcons.file,
            title: display.fileName,
            meta: diffMeta,
            iconColor: failed ? eco.danger : eco.textMuted,
            expanded: hasMore ? _expanded : null,
            trailing: failed
                ? ActivityFeedStatusChip(
                    label: context.l10n.activityFailed,
                    danger: true,
                  )
                : running
                ? ActivityFeedStatusChip(
                    label: context.l10n.threadRunRunning,
                    active: true,
                  )
                : null,
          ),
          const ActivityFeedBlockDivider(),
          EcoClippedFadeBody(
            expanded: _expanded,
            collapsedMaxHeight: 148,
            showFade: !_expanded && hasMore,
            child: Padding(
              padding: EdgeInsets.only(top: 6, bottom: _expanded ? 10 : 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final line in previewLines)
                    EcoDiffGutterLine(
                      text: line.text,
                      gutterColor: diffPalette.gutterFor(line.kind),
                      backgroundColor: diffPalette.backgroundFor(line.kind),
                      style: lineStyle,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PhaseTile extends StatelessWidget {
  const _PhaseTile({
    required this.text,
    this.detail,
    this.icon,
    this.lifecycle,
  });

  final String text;
  final String? detail;
  final ActivityActionIcon? icon;
  final ToolActionLifecycle? lifecycle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null)
            _ActionSummaryLine(
              label: text,
              icon: EcoIcons.activityAction(icon!),
              lifecycle: lifecycle,
            )
          else
            Text(
              text,
              style: activityFeedBodyStyle(
                context,
                color: ecoColors(context).textMuted,
                height: 1.4,
              ),
            ),
          if (detail != null && detail!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).textMuted,
                  height: 1.35,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ReconnectPhaseTile extends StatefulWidget {
  const _ReconnectPhaseTile({required this.summary, this.detail});

  final String summary;
  final String? detail;

  @override
  State<_ReconnectPhaseTile> createState() => _ReconnectPhaseTileState();
}

class _ReconnectPhaseTileState extends State<_ReconnectPhaseTile>
    with SingleTickerProviderStateMixin {
  var _expanded = false;
  late final AnimationController _spinController;

  @override
  void initState() {
    super.initState();
    _spinController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_isFailure) {
      _spinController.repeat();
    } else {
      _spinController.stop();
    }
  }

  @override
  void dispose() {
    _spinController.dispose();
    super.dispose();
  }

  bool get _isFailure =>
      widget.summary.startsWith(context.l10n.activityConnectionFailed);

  bool get _hasDetail =>
      widget.detail != null && widget.detail!.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final summaryColor = _isFailure ? eco.statusDenyText : eco.textSecondary;
    final iconColor = _isFailure ? eco.statusDenyText : eco.textMuted;

    final summaryRow = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_isFailure)
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(EcoIcons.error, size: 16, color: iconColor),
          )
        else
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: RotationTransition(
              turns: _spinController,
              child: Icon(EcoIcons.refresh, size: 16, color: iconColor),
            ),
          ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            widget.summary,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: summaryColor,
              fontWeight: FontWeight.w500,
              height: 1.35,
            ),
          ),
        ),
        if (_hasDetail)
          Icon(
            _expanded ? Icons.expand_less : Icons.expand_more,
            size: 18,
            color: eco.textMuted,
          ),
      ],
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _hasDetail
              ? () => setState(() => _expanded = !_expanded)
              : null,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                summaryRow,
                if (_hasDetail && _expanded)
                  Container(
                    margin: const EdgeInsets.only(left: 24, top: 6),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: eco.codeBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: eco.borderSubtle),
                    ),
                    child: SelectableText(
                      widget.detail!.trim(),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted,
                        fontFamily: 'monospace',
                        height: 1.4,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubagentMissionTile extends StatefulWidget {
  const _SubagentMissionTile({
    required this.role,
    required this.summary,
    this.prompt,
    this.taskName,
    this.agentId,
    this.attachments = const [],
    this.themeSource,
    this.running = false,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
    this.onOpenDetail,
  });

  final String role;
  final String summary;
  final String? prompt;
  final String? taskName;
  final String? agentId;
  final List<PromptImageAttachment> attachments;
  final SubagentThemeSource? themeSource;
  final bool running;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;
  final VoidCallback? onOpenDetail;

  @override
  State<_SubagentMissionTile> createState() => _SubagentMissionTileState();
}

class _SubagentMissionTileState extends State<_SubagentMissionTile> {
  var _expanded = false;
  late int _liveDurationMs;
  Timer? _durationTimer;
  String? _latchedAgentId;
  String _latchedMissionText = '';
  var _latchedHasTimeline = false;

  String _resolvedMissionText() {
    final trimmedPrompt = widget.prompt?.trim() ?? '';
    final trimmedSummary = widget.summary.trim();
    final incoming = resolveMissionDisplayText(
      trimmedPrompt.isNotEmpty ? trimmedPrompt : trimmedSummary,
    );
    if (_latchedAgentId != widget.agentId) {
      _latchedAgentId = widget.agentId;
      _latchedMissionText = '';
      _latchedHasTimeline = false;
    }
    if (incoming.isNotEmpty) {
      _latchedMissionText = incoming;
    }
    if (widget.timeline.isNotEmpty) {
      _latchedHasTimeline = true;
    }
    return _latchedMissionText.isNotEmpty ? _latchedMissionText : incoming;
  }

  @override
  void initState() {
    super.initState();
    _liveDurationMs = widget.durationMs;
    _syncDurationTimer();
  }

  @override
  void didUpdateWidget(covariant _SubagentMissionTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.running) {
      _liveDurationMs = widget.durationMs;
    } else if (oldWidget.durationMs != widget.durationMs) {
      _liveDurationMs = widget.durationMs;
    }
    _syncDurationTimer();
  }

  void _syncDurationTimer() {
    _durationTimer?.cancel();
    _durationTimer = null;
    if (!widget.running) return;
    final baselineMs = widget.durationMs;
    final anchorAt = DateTime.now();
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        _liveDurationMs =
            baselineMs + DateTime.now().difference(anchorAt).inMilliseconds;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final role = normalizeAgentDisplayRole(widget.role) ?? widget.role;
    final fullText = _resolvedMissionText();
    final previewText = thinkingPreviewLine(fullText);
    final hasTimeline = widget.timeline.isNotEmpty || _latchedHasTimeline;
    final roleColor = resolveSubagentThemeColor(
      role,
      agents: widget.themeSource?.agents ?? const [],
    );
    final statusText = widget.statusText?.trim();
    final showStatus =
        fullText.isEmpty && statusText != null && statusText.isNotEmpty;
    final durationLabel = formatSubagentDuration(
      widget.running ? _liveDurationMs : widget.durationMs,
      running: widget.running,
      l10n: context.l10n,
    );

    final onTap =
        widget.onOpenDetail ?? () => setState(() => _expanded = !_expanded);
    final expanded = widget.onOpenDetail == null && _expanded;
    final title = role == 'vision' && widget.attachments.isNotEmpty
        ? context.l10n.activityViewImages(widget.attachments.length)
        : resolveSubagentActivityTitle(
            resolveSubagentRunDisplayTitle(role, context.l10n),
            widget.taskName,
          );
    final titleStyle = activityFeedBodyStyle(
      context,
      color: eco.textMuted,
      height: 1.35,
    )?.copyWith(fontWeight: FontWeight.w500, fontSize: 13);
    final missionStyle = activityFeedBodyStyle(
      context,
      color: eco.textMuted,
      height: 1.45,
    )?.copyWith(fontSize: 12);

    return Semantics(
      button: true,
      expanded: expanded,
      label: context.l10n.activitySubagentTask(title),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(EcoIcons.agent, size: 14, color: roleColor),
                    const SizedBox(width: 6),
                    Flexible(
                      child: widget.running
                          ? ShimmerText(
                              text: title,
                              baseColor: eco.textMuted,
                              highlightColor: eco.textSecondary,
                              style: titleStyle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            )
                          : Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: titleStyle,
                            ),
                    ),
                    if (durationLabel.isNotEmpty) ...[
                      const SizedBox(width: 6),
                      Text(
                        durationLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: eco.textMuted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ],
                ),
                if (expanded && widget.attachments.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _SubagentImageStrip(attachments: widget.attachments),
                ],
                if (showStatus) ...[
                  const SizedBox(height: 4),
                  Text(
                    statusText,
                    maxLines: expanded ? null : 1,
                    overflow: expanded ? null : TextOverflow.ellipsis,
                    style: missionStyle,
                  ),
                ] else if (fullText.isEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    context.l10n.activityWaitingMission,
                    style: missionStyle?.copyWith(fontStyle: FontStyle.italic),
                  ),
                ] else ...[
                  const SizedBox(height: 4),
                  if (expanded)
                    Text(fullText, style: missionStyle)
                  else
                    EcoClippedFadeBody(
                      expanded: false,
                      collapsedMaxHeight: 40,
                      showFade: fullText.length > 80,
                      child: Text(
                        previewText,
                        maxLines: 2,
                        overflow: TextOverflow.clip,
                        style: missionStyle,
                      ),
                    ),
                ],
                if (expanded && hasTimeline) ...[
                  const SizedBox(height: 8),
                  ...widget.timeline.map(
                    (item) => _SubagentTimelineRow(entry: item),
                  ),
                ] else if (expanded && widget.running) ...[
                  const SizedBox(height: 8),
                  Text(
                    context.l10n.activityWaitingEvents,
                    style: missionStyle?.copyWith(fontStyle: FontStyle.italic),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    super.dispose();
  }
}

class _SubagentImageStrip extends StatelessWidget {
  const _SubagentImageStrip({required this.attachments});

  final List<PromptImageAttachment> attachments;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 88,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: attachments.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, index) => ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox.square(
            dimension: 88,
            child: Image.memory(
              base64Decode(attachments[index].data),
              fit: BoxFit.cover,
              gaplessPlayback: true,
              filterQuality: FilterQuality.medium,
            ),
          ),
        ),
      ),
    );
  }
}

class _SubagentTimelineRow extends StatelessWidget {
  const _SubagentTimelineRow({required this.entry});

  final SubagentTimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    if (entry.fileChange != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: _FileChangeCard(
          display: entry.fileChange!,
          lifecycle: entry.lifecycle,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.icon != null)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(
                _materialIcon(entry.icon!),
                size: 14,
                color: entry.isError
                    ? ecoColors(context).statusDenyText
                    : ecoColors(context).textMuted,
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Container(
                width: 5,
                height: 5,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: entry.isError
                      ? ecoColors(context).statusDenyText
                      : ecoColors(context).textMuted,
                ),
              ),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              entry.label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: entry.isError
                    ? ecoColors(context).statusDenyText
                    : ecoColors(context).textMuted,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) =>
      EcoIcons.activityAction(icon);
}

class _ErrorTile extends StatelessWidget {
  const _ErrorTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ecoColors(context).statusDenyBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: ecoColors(context).statusDenyBorder),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: ecoColors(context).statusDenyText,
          height: 1.4,
        ),
      ),
    );
  }
}
