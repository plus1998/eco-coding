import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/models/thread_run_projection.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/stream_text.dart';
import '../../core/utils/subagent_projection_feed.dart';
import '../../core/utils/subagent_session_timing.dart';
import '../../core/widgets/eco_markdown.dart';
import '../../core/widgets/shimmer_text.dart';
import 'thread_providers.dart';

enum ActivityFeedKind {
  user,
  assistant,
  thinking,
  action,
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
    this.subagentRole,
    this.detail,
    this.streaming = false,
    this.usageBadge,
    this.lifecycle,
    this.missionPrompt,
    this.agentId,
    this.running = false,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
  });

  final String id;
  final ActivityFeedKind kind;
  final String text;
  final ActivityActionIcon? actionIcon;
  final String? subagentRole;
  final String? detail;
  final bool streaming;
  final String? usageBadge;
  final ToolActionLifecycle? lifecycle;
  final String? missionPrompt;
  final String? agentId;
  final bool running;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;
}

List<ActivityFeedEntry> buildActivityFeed({
  required List<ActivityItem> lines,
  String? threadPrompt,
  String? threadId,
  ThreadRunProjectionSnapshot? runProjection,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
}) {
  var effectiveLines = lines;
  if (!lines.any((line) => line.role == 'user') &&
      threadPrompt != null &&
      threadPrompt.trim().isNotEmpty) {
    effectiveLines = [
      ActivityItem(
        id: 'legacy-${threadId ?? 'thread'}',
        role: 'user',
        message: threadPrompt,
      ),
      ...lines,
    ];
  }

  final output = <ActivityFeedEntry>[];
  var narrative = '';
  String? narrativeId;
  var narrativeStreaming = false;
  var thinking = '';
  String? thinkingId;
  var thinkingStreaming = false;
  String? pendingUsageBadge;

  void flushThinking({bool atEnd = false}) {
    final text = stripActivityStatusNoise(thinking).trim();
    final stillStreaming = thinkingStreaming && atEnd;
    if (text.isEmpty && !stillStreaming) {
      thinking = '';
      thinkingId = null;
      thinkingStreaming = false;
      return;
    }
    final last = output.isNotEmpty ? output.last : null;
    if (text.isNotEmpty &&
        last != null &&
        last.kind == ActivityFeedKind.thinking &&
        shouldMergeThinkingBlocks(last.text, text)) {
      output[output.length - 1] = ActivityFeedEntry(
        id: last.id,
        kind: ActivityFeedKind.thinking,
        text: mergeThinkingBlocks(last.text, text),
        streaming: stillStreaming,
      );
    } else {
      output.add(
        ActivityFeedEntry(
          id: thinkingId ?? 'thinking-${output.length}',
          kind: ActivityFeedKind.thinking,
          text: text,
          streaming: stillStreaming,
        ),
      );
    }
    thinking = '';
    thinkingId = null;
    thinkingStreaming = false;
  }

  void flushNarrative() {
    final text = stripActivityStatusNoise(narrative).trim();
    if (text.isEmpty) {
      narrative = '';
      narrativeId = null;
      narrativeStreaming = false;
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: narrativeId ?? 'narrative-${output.length}',
        kind: ActivityFeedKind.assistant,
        text: text,
        streaming: narrativeStreaming,
        usageBadge: pendingUsageBadge,
      ),
    );
    narrative = '';
    narrativeId = null;
    narrativeStreaming = false;
    pendingUsageBadge = null;
  }

  void flushTextBuffers({bool atEnd = false}) {
    flushThinking(atEnd: atEnd);
    flushNarrative();
  }

  void upsertAction({
    required String id,
    required String label,
    required ActivityActionIcon icon,
    ToolActionLifecycle? lifecycle,
    String? subagentRole,
  }) {
    final actionKey = activityActionKey(
      subagent: subagentRole,
      label: label,
      icon: icon,
    );
    final existingIndex = output.indexWhere(
      (entry) =>
          entry.kind == ActivityFeedKind.action &&
          activityActionKey(
                subagent: entry.subagentRole,
                label: entry.text,
                icon: entry.actionIcon,
              ) ==
              actionKey,
    );
    if (existingIndex >= 0) {
      final existing = output[existingIndex];
      ToolActionLifecycle? nextLifecycle = lifecycle;
      if (existing.lifecycle != null && lifecycle != null) {
        nextLifecycle =
            compareToolActionLifecyclePriority(lifecycle, existing.lifecycle!) >=
                    0
                ? lifecycle
                : existing.lifecycle;
      } else {
        nextLifecycle ??= existing.lifecycle;
      }
      output[existingIndex] = ActivityFeedEntry(
        id: existing.id,
        kind: ActivityFeedKind.action,
        text: label,
        actionIcon: icon,
        subagentRole: subagentRole ?? existing.subagentRole,
        lifecycle: nextLifecycle,
      );
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: id,
        kind: ActivityFeedKind.action,
        text: label,
        actionIcon: icon,
        subagentRole: subagentRole,
        lifecycle: lifecycle,
      ),
    );
  }

  void upsertPhase(String summary, {String? detail}) {
    final last = output.isNotEmpty ? output.last : null;
    if (last != null &&
        last.kind == ActivityFeedKind.phase &&
        last.text == summary) {
      if (detail != null && detail.isNotEmpty) {
        output[output.length - 1] = ActivityFeedEntry(
          id: last.id,
          kind: ActivityFeedKind.phase,
          text: summary,
          detail: detail,
        );
      }
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: 'phase-${output.length}',
        kind: ActivityFeedKind.phase,
        text: summary,
        detail: detail,
      ),
    );
  }

  for (final line in effectiveLines) {
    final cleaned = stripActivityStatusNoise(line.message);
    final message = stripSubagentBracketPrefix(cleaned);
    if ((message.isEmpty && line.role != 'thinking') ||
        isUsageNoiseMessage(message)) {
      continue;
    }

    if (line.role == 'system' || isInternalAgentActivityRole(line.role)) {
      continue;
    }

    if (line.role != 'thinking' && isInternalActivityMessage(message)) {
      continue;
    }

    if (isUsageBadgeText(message)) {
      flushTextBuffers();
      pendingUsageBadge = message.trim();
      continue;
    }

    final mission = parseSubagentMissionMessage(message);
    if (mission != null && isSubagentDisplayRole(mission.role)) {
      flushTextBuffers();
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.subagentMission,
          text: mission.summary,
          subagentRole: mission.role,
          missionPrompt:
              mission.prompt.isNotEmpty ? mission.prompt : null,
        ),
      );
      continue;
    }

    if (line.role == 'user') {
      flushTextBuffers();
      if (!isUserPromptActivityLine(role: line.role, message: line.message)) {
        continue;
      }
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.user,
          text: line.message.trim(),
        ),
      );
      continue;
    }

    final agentRole = normalizeAgentDisplayRole(line.role);
    if (agentRole != null && isSubagentDisplayRole(agentRole)) {
      flushTextBuffers();
      final summary = message.trim();
      if (summary.length >= 8 &&
          !summary.startsWith('Tool:') &&
          !summary.startsWith('Reading ') &&
          !summary.startsWith('Running ')) {
        output.add(
          ActivityFeedEntry(
            id: line.id,
            kind: ActivityFeedKind.subagentMission,
            text: summary,
            subagentRole: agentRole,
          ),
        );
      }
      continue;
    }

    if (line.role == 'thinking') {
      flushNarrative();
      final text = line.stream ? message : message.trim();
      if (line.stream) {
        thinking =
            thinking.isEmpty ? text : mergeStreamText(thinking, text);
        thinkingStreaming = true;
        thinkingId ??= line.id;
      } else {
        thinking = thinking.isEmpty ? text : mergeStreamText(thinking, text);
        thinkingStreaming = false;
        thinkingId ??= line.id;
      }
      continue;
    }

    final reconnect = parseReconnectActivityMessage(message);
    if (reconnect != null) {
      flushTextBuffers();
      upsertPhase(reconnect.summary, detail: reconnect.detail);
      continue;
    }

    if (isThreadFollowUpActivityMessage(message)) {
      continue;
    }

    final parsedApproval = parseBashApprovalActivityText(message);
    if (parsedApproval != null) {
      flushTextBuffers();
      upsertAction(
        id: line.id,
        label: formatToolDisplayLabel(
          parsedApproval.toolName,
          parsedApproval.detail,
        ),
        icon: iconForToolName(parsedApproval.toolName),
        lifecycle: parsedApproval.phase,
        subagentRole: agentRole,
      );
      continue;
    }

    if (looksLikeToolActionMessage(message)) {
      flushTextBuffers();
      upsertAction(
        id: line.id,
        label: parseToolActionDisplayLabel(message),
        icon: iconForActivityMessage(message),
        lifecycle: ToolActionLifecycle.running,
        subagentRole: agentRole,
      );
      continue;
    }

    if (_looksLikeApiError(message)) {
      flushTextBuffers();
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.error,
          text: message,
        ),
      );
      continue;
    }

    if (line.role != 'thinking' &&
        (isActivityNoiseMessage(message) || isActivityStatusNoise(message))) {
      continue;
    }

    if (line.role == 'planner' ||
        line.role == 'assistant' ||
        line.role == 'main') {
      flushThinking();
      if (line.stream) {
        narrative += message;
        narrativeId ??= line.id;
        narrativeStreaming = true;
      } else {
        narrative += message;
        narrativeId ??= line.id;
        narrativeStreaming = false;
      }
      continue;
    }

    if (shouldShowLineInMainFeed(role: line.role) && message.trim().isNotEmpty) {
      flushThinking();
      narrative += message;
      narrativeId ??= line.id;
      narrativeStreaming = line.stream;
    }
  }

  flushThinking(atEnd: true);
  flushNarrative();
  _enrichSubagentEntries(
    output,
    runProjection: runProjection,
    subagentSessions: subagentSessions,
  );
  return output;
}

void _enrichSubagentEntries(
  List<ActivityFeedEntry> output, {
  ThreadRunProjectionSnapshot? runProjection,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
}) {
  if (runProjection == null &&
      subagentSessions.isEmpty &&
      !output.any((entry) => entry.kind == ActivityFeedKind.subagentMission)) {
    return;
  }

  final agentsByRole =
      runProjection != null ? groupSubagentAgentsByRole(runProjection) : {};
  final sessionsByAgentId = indexSubagentSessionsByAgentId(subagentSessions);
  final roleUseIndex = <String, int>{};
  final absorbedActionKeys = <String>{};

  for (var index = 0; index < output.length; index++) {
    final entry = output[index];
    if (entry.kind != ActivityFeedKind.subagentMission) continue;

    final role =
        normalizeAgentDisplayRole(entry.subagentRole) ?? entry.subagentRole ?? '';
    ThreadRunProjectionAgent? agent;
    final agents = agentsByRole[role];
    if (agents != null && agents.isNotEmpty) {
      final useIndex = roleUseIndex[role] ?? 0;
      if (useIndex < agents.length) {
        agent = agents[useIndex];
        roleUseIndex[role] = useIndex + 1;
      }
    }

    final timing =
        agent != null ? sessionsByAgentId[agent.agentId] : null;
    final running = resolveSubagentRunning(agent: agent, timing: timing);
    final durationMs = resolveSubagentDurationMs(agent: agent, timing: timing);
    final timeline = agent != null
        ? buildSubagentTimelineFromProjection(agent.timeline)
        : _collectFallbackTimeline(output, index, role);
    final statusText = agent != null
        ? resolveProjectionAgentStatusText(agent)
        : (running ? '工作中' : null);
    final missionPrompt = entry.missionPrompt ??
        agent?.delegationPrompt ??
        (agent?.delegationSummary?.trim().isNotEmpty == true
            ? agent!.delegationSummary
            : null);

    for (final item in timeline) {
      if (item.icon != null) {
        absorbedActionKeys.add(
          activityActionKey(
            subagent: role,
            label: item.label,
            icon: item.icon,
          ),
        );
      }
    }

    output[index] = ActivityFeedEntry(
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      subagentRole: entry.subagentRole,
      missionPrompt: missionPrompt,
      agentId: agent?.agentId,
      running: running,
      durationMs: durationMs,
      statusText: statusText,
      timeline: timeline,
    );
  }

  if (absorbedActionKeys.isEmpty) return;
  output.removeWhere(
    (entry) =>
        entry.kind == ActivityFeedKind.action &&
        entry.subagentRole != null &&
        entry.actionIcon != null &&
        absorbedActionKeys.contains(
          activityActionKey(
            subagent: entry.subagentRole,
            label: entry.text,
            icon: entry.actionIcon,
          ),
        ),
  );
}

List<SubagentTimelineEntry> _collectFallbackTimeline(
  List<ActivityFeedEntry> output,
  int missionIndex,
  String role,
) {
  final timeline = <SubagentTimelineEntry>[];
  for (var index = missionIndex + 1; index < output.length; index++) {
    final entry = output[index];
    if (entry.kind == ActivityFeedKind.subagentMission ||
        entry.kind == ActivityFeedKind.user ||
        entry.kind == ActivityFeedKind.assistant ||
        entry.kind == ActivityFeedKind.thinking) {
      break;
    }
    if (entry.kind == ActivityFeedKind.action &&
        normalizeAgentDisplayRole(entry.subagentRole) == role) {
      timeline.add(
        SubagentTimelineEntry(
          id: entry.id,
          label: entry.text,
          icon: entry.actionIcon,
          lifecycle: entry.lifecycle,
        ),
      );
    }
  }
  return timeline;
}

bool _looksLikeApiError(String message) {
  final trimmed = message.trim();
  return trimmed.startsWith('API error') ||
      trimmed.startsWith('Tool failed:') ||
      trimmed.startsWith('工具调用失败');
}

class ActivityFeedList extends StatelessWidget {
  const ActivityFeedList({
    super.key,
    required this.entries,
    required this.scrollController,
  });

  final List<ActivityFeedEntry> entries;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      itemCount: entries.length,
      itemBuilder: (context, index) => _ActivityFeedEntryTile(
        entry: entries[index],
      ),
    );
  }
}

class _ActivityFeedEntryTile extends StatelessWidget {
  const _ActivityFeedEntryTile({required this.entry});

  final ActivityFeedEntry entry;

  @override
  Widget build(BuildContext context) {
    switch (entry.kind) {
      case ActivityFeedKind.user:
        return _UserPromptTile(text: entry.text);
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
        );
      case ActivityFeedKind.action:
        return _ActionTile(
          label: entry.text,
          icon: entry.actionIcon ?? ActivityActionIcon.file,
        );
      case ActivityFeedKind.phase:
        return _PhaseTile(text: entry.text, detail: entry.detail);
      case ActivityFeedKind.subagentMission:
        return _SubagentMissionTile(
          role: entry.subagentRole ?? '',
          summary: entry.text,
          prompt: entry.missionPrompt,
          agentId: entry.agentId,
          running: entry.running,
          durationMs: entry.durationMs,
          statusText: entry.statusText,
          timeline: entry.timeline,
        );
      case ActivityFeedKind.error:
        return _ErrorTile(text: entry.text);
    }
  }
}

class _UserPromptTile extends StatelessWidget {
  const _UserPromptTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.88,
        ),
        decoration: BoxDecoration(
          color: eco.userBubble,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: eco.borderSubtle),
        ),
        child: Text(
          text,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                height: 1.45,
                color: EcoColors.textPrimary,
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
    final eco = ecoThemeExtras(context);
    if (text.isEmpty && usageBadge != null) {
      return _UsageBadgeLine(badge: usageBadge!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text.isNotEmpty) EcoMarkdown(text: text),
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
                      color: eco.textMuted,
                    ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ThinkingTile extends StatefulWidget {
  const _ThinkingTile({
    required this.text,
    this.streaming = false,
  });

  final String text;
  final bool streaming;

  @override
  State<_ThinkingTile> createState() => _ThinkingTileState();
}

class _ThinkingTileState extends State<_ThinkingTile> {
  var _collapsed = false;

  bool get _hasBody => widget.text.trim().isNotEmpty;

  bool get _expanded =>
      (widget.streaming && _hasBody) || (!_collapsed && _hasBody);

  @override
  void initState() {
    super.initState();
    _collapsed = !widget.streaming && widget.text.trim().isNotEmpty;
  }

  @override
  void didUpdateWidget(covariant _ThinkingTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.streaming && _hasBody) {
      _collapsed = false;
    } else if (oldWidget.streaming &&
        !widget.streaming &&
        _hasBody &&
        !_collapsed) {
      _collapsed = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final preview = _hasBody ? thinkingPreviewLine(widget.text) : '';
    final showPreview = _hasBody && _collapsed && !widget.streaming;
    final labelStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
          color: eco.textMuted,
          fontWeight: FontWeight.w500,
          letterSpacing: 0.2,
        );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: eco.cardSurface.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: eco.borderSubtle.withValues(alpha: 0.8)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: widget.streaming && !_hasBody
                    ? null
                    : () {
                        if (widget.streaming || !_hasBody) return;
                        setState(() => _collapsed = !_collapsed);
                      },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      if (widget.streaming && !_hasBody)
                        ShimmerText(
                          text: '思考',
                          style: labelStyle,
                          baseColor: eco.textMuted,
                          highlightColor: eco.textSecondary,
                        )
                      else
                        Text('思考', style: labelStyle),
                      if (showPreview) ...[
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            preview,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(
                                  color: eco.textMuted.withValues(alpha: 0.85),
                                  height: 1.3,
                                ),
                          ),
                        ),
                      ],
                      if (_hasBody && !widget.streaming) ...[
                        const Spacer(),
                        Icon(
                          _expanded
                              ? Icons.expand_less
                              : Icons.expand_more,
                          size: 18,
                          color: eco.textMuted,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            if (_hasBody && _expanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: EcoMarkdown(
                  text: widget.text,
                  compact: true,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _UsageBadgeLine extends StatelessWidget {
  const _UsageBadgeLine({required this.badge});

  final String badge;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Text(
      badge,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: eco.textMuted,
            fontSize: 11,
            letterSpacing: 0.2,
          ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.label, required this.icon});

  final String label;
  final ActivityActionIcon icon;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: Row(
        children: [
          Icon(
            _materialIcon(icon),
            size: 15,
            color: eco.textMuted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted,
                    height: 1.35,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) {
    switch (icon) {
      case ActivityActionIcon.search:
        return Icons.search;
      case ActivityActionIcon.edit:
        return Icons.edit_outlined;
      case ActivityActionIcon.terminal:
        return Icons.terminal;
      case ActivityActionIcon.agent:
        return Icons.smart_toy_outlined;
      case ActivityActionIcon.file:
        return Icons.description_outlined;
    }
  }
}

class _PhaseTile extends StatelessWidget {
  const _PhaseTile({required this.text, this.detail});

  final String text;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted,
                  fontStyle: FontStyle.italic,
                ),
          ),
          if (detail != null && detail!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.35,
                    ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SubagentMissionTile extends StatefulWidget {
  const _SubagentMissionTile({
    required this.role,
    required this.summary,
    this.prompt,
    this.agentId,
    this.running = false,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
  });

  final String role;
  final String summary;
  final String? prompt;
  final String? agentId;
  final bool running;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;

  @override
  State<_SubagentMissionTile> createState() => _SubagentMissionTileState();
}

class _SubagentMissionTileState extends State<_SubagentMissionTile> {
  var _expanded = false;
  late int _liveDurationMs;
  Timer? _durationTimer;

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
    final eco = ecoThemeExtras(context);
    final role = normalizeAgentDisplayRole(widget.role) ?? widget.role;
    final trimmedPrompt = widget.prompt?.trim() ?? '';
    final trimmedSummary = widget.summary.trim();
    final fullText =
        trimmedPrompt.isNotEmpty ? trimmedPrompt : trimmedSummary;
    final borderColor = subagentMissionBorderColor(role);
    final statusText = widget.statusText?.trim();
    final showStatus = statusText != null && statusText.isNotEmpty;
    final durationLabel = formatSubagentDuration(
      widget.running ? _liveDurationMs : widget.durationMs,
      running: widget.running,
    );

    return Semantics(
      button: true,
      expanded: _expanded,
      label: '${resolveSubagentRunDisplayTitle(role)} 子代理任务',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            decoration: BoxDecoration(
              color: widget.running
                  ? Color.alphaBlend(
                      borderColor.withValues(alpha: 0.08),
                      eco.cardSurface,
                    )
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Color.alphaBlend(
                  borderColor.withValues(alpha: widget.running ? 0.55 : 0.45),
                  eco.borderSubtle,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Text(
                            resolveSubagentRunDisplayTitle(role),
                            style:
                                Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: EcoColors.accentText,
                                      fontWeight: FontWeight.w600,
                                    ),
                          ),
                          if (widget.agentId != null) ...[
                            const SizedBox(width: 6),
                            Text(
                              '#${shortSubagentAgentId(widget.agentId!)}',
                              style:
                                  Theme.of(context).textTheme.labelSmall?.copyWith(
                                        color: eco.textMuted,
                                        fontSize: 10,
                                      ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (durationLabel.isNotEmpty) ...[
                      Text(
                        durationLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: widget.running
                                  ? EcoColors.accentText
                                  : eco.textMuted,
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: widget.running
                            ? EcoColors.accentSoft
                            : eco.cardSurface,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: widget.running
                              ? EcoColors.accent.withValues(alpha: 0.45)
                              : eco.borderSubtle,
                        ),
                      ),
                      child: Text(
                        widget.running ? '运行中' : '已完成',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: widget.running
                                  ? EcoColors.accentText
                                  : eco.textMuted,
                              fontSize: 10,
                            ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(
                        Icons.expand_more,
                        size: 18,
                        color: eco.textMuted,
                      ),
                    ),
                  ],
                ),
                if (showStatus) ...[
                  const SizedBox(height: 6),
                  Text(
                    statusText,
                    maxLines: _expanded ? null : 1,
                    overflow: _expanded ? null : TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textSecondary,
                          height: 1.35,
                        ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  '任务目标',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: eco.textMuted,
                        fontSize: 11,
                        letterSpacing: 0.3,
                      ),
                ),
                const SizedBox(height: 4),
                if (fullText.isEmpty)
                  Text(
                    '等待任务说明…',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                          fontStyle: FontStyle.italic,
                          height: 1.4,
                        ),
                  )
                else
                  AnimatedSize(
                    duration: const Duration(milliseconds: 150),
                    curve: Curves.easeOut,
                    alignment: Alignment.topLeft,
                    child: Text(
                      fullText,
                      maxLines: _expanded ? null : 2,
                      overflow:
                          _expanded ? null : TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: eco.textSecondary,
                            height: 1.45,
                          ),
                    ),
                  ),
                if (_expanded && widget.timeline.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Divider(height: 1, color: eco.borderSubtle),
                  const SizedBox(height: 8),
                  ...widget.timeline.map(
                    (item) => _SubagentTimelineRow(entry: item),
                  ),
                ] else if (_expanded && widget.running) ...[
                  const SizedBox(height: 10),
                  Text(
                    '等待执行事件…',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                          fontStyle: FontStyle.italic,
                        ),
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

class _SubagentTimelineRow extends StatelessWidget {
  const _SubagentTimelineRow({required this.entry});

  final SubagentTimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
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
                    ? EcoColors.statusDenyText
                    : eco.textMuted,
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
                      ? EcoColors.statusDenyText
                      : eco.textMuted,
                ),
              ),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              entry.label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: entry.isError
                        ? EcoColors.statusDenyText
                        : eco.textMuted,
                    height: 1.35,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) {
    switch (icon) {
      case ActivityActionIcon.search:
        return Icons.search;
      case ActivityActionIcon.edit:
        return Icons.edit_outlined;
      case ActivityActionIcon.terminal:
        return Icons.terminal;
      case ActivityActionIcon.agent:
        return Icons.smart_toy_outlined;
      case ActivityActionIcon.file:
        return Icons.description_outlined;
    }
  }
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
        color: EcoColors.statusDenyBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: EcoColors.statusDenyBorder),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: EcoColors.statusDenyText,
              height: 1.4,
            ),
      ),
    );
  }
}
