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
    this.bashRun,
    this.toolUseId,
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
  final BashRunCardDisplay? bashRun;
  final String? toolUseId;
}

List<ActivityItem> _resolveEffectiveActivityLines({
  required List<ActivityItem> lines,
  ThreadRunProjectionSnapshot? runProjection,
  String? threadPrompt,
  String? threadId,
}) {
  if (lines.any((line) => line.role == 'user')) {
    return lines;
  }
  String? userPrompt;
  String? userPromptId;
  for (final item in runProjection?.timeline ?? const []) {
    if (item.eventType == 'thread.user_prompt' && item.text.trim().isNotEmpty) {
      userPrompt = item.text.trim();
      userPromptId = item.id;
      break;
    }
  }
  userPrompt ??= threadPrompt?.trim();
  if (userPrompt == null || userPrompt.isEmpty) {
    return lines;
  }
  return [
    ActivityItem(
      id: userPromptId ?? 'user-prompt-${threadId ?? 'thread'}',
      role: 'user',
      message: userPrompt,
    ),
    ...lines,
  ];
}

List<ActivityFeedEntry> buildActivityFeed({
  required List<ActivityItem> lines,
  String? threadPrompt,
  String? threadId,
  ThreadRunProjectionSnapshot? runProjection,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
}) {
  final effectiveLines = _resolveEffectiveActivityLines(
    lines: lines,
    runProjection: runProjection,
    threadPrompt: threadPrompt,
    threadId: threadId,
  );
  final bashApprovalByToolUseId = buildBashApprovalIndexByToolUseId(runProjection);

  final output = <ActivityFeedEntry>[];
  final entrySourceLineIndex = <String, int>{};
  var narrative = '';
  String? narrativeId;
  int? narrativeSourceLineIndex;
  var narrativeStreaming = false;
  var thinking = '';
  String? thinkingId;
  int? thinkingSourceLineIndex;
  var thinkingStreaming = false;
  String? pendingUsageBadge;

  void bindEntryToLine(String entryId, int lineIndex) {
    entrySourceLineIndex[entryId] = lineIndex;
  }

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
      final entryId = thinkingId ?? 'thinking-${output.length}';
      output.add(
        ActivityFeedEntry(
          id: entryId,
          kind: ActivityFeedKind.thinking,
          text: text,
          streaming: stillStreaming,
        ),
      );
      if (thinkingSourceLineIndex != null) {
        bindEntryToLine(entryId, thinkingSourceLineIndex!);
      }
    }
    thinking = '';
    thinkingId = null;
    thinkingSourceLineIndex = null;
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
    final entryId = narrativeId ?? 'narrative-${output.length}';
    output.add(
      ActivityFeedEntry(
        id: entryId,
        kind: ActivityFeedKind.assistant,
        text: text,
        streaming: narrativeStreaming,
        usageBadge: pendingUsageBadge,
      ),
    );
    if (narrativeSourceLineIndex != null) {
      bindEntryToLine(entryId, narrativeSourceLineIndex!);
    }
    narrative = '';
    narrativeId = null;
    narrativeSourceLineIndex = null;
    narrativeStreaming = false;
    pendingUsageBadge = null;
  }

  void flushTextBuffers({bool atEnd = false}) {
    flushThinking(atEnd: atEnd);
    flushNarrative();
  }

  void upsertAction({
    required String id,
    required int lineIndex,
    required String label,
    required ActivityActionIcon icon,
    ToolActionLifecycle? lifecycle,
    String? subagentRole,
    BashRunCardDisplay? bashRun,
    String? toolUseId,
  }) {
    var existingIndex = -1;
    if (toolUseId != null && toolUseId.isNotEmpty) {
      existingIndex = output.lastIndexWhere(
        (entry) =>
            entry.kind == ActivityFeedKind.action && entry.toolUseId == toolUseId,
      );
    }
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
        bashRun: bashRun ?? existing.bashRun,
        toolUseId: toolUseId ?? existing.toolUseId,
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
        bashRun: bashRun,
        toolUseId: toolUseId,
      ),
    );
    bindEntryToLine(id, lineIndex);
  }

  BashRunCardDisplay? resolveActionBashRun(
    ThreadRunToolMetadata tool,
    String message,
  ) {
    if (tool.name != 'Bash') return null;
    return resolveBashRunCardDisplayFromTool(tool, summaryText: message);
  }

  ToolActionLifecycle resolveStructuredToolLifecycle({
    required ThreadRunToolMetadata tool,
    ThreadRunBashApprovalMetadata? bashApproval,
  }) {
    final approvalLifecycle = bashApprovalPhaseToLifecycle(bashApproval?.phase);
    if (approvalLifecycle != null) {
      return approvalLifecycle;
    }
    return toolLifecycleFromMetadata(tool);
  }

  void upsertPhase(String summary, {String? detail, required int lineIndex}) {
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
    final phaseId = 'phase-${output.length}';
    output.add(
      ActivityFeedEntry(
        id: phaseId,
        kind: ActivityFeedKind.phase,
        text: summary,
        detail: detail,
      ),
    );
    bindEntryToLine(phaseId, lineIndex);
  }

  for (var lineIndex = 0; lineIndex < effectiveLines.length; lineIndex++) {
    final line = effectiveLines[lineIndex];
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
      bindEntryToLine(line.id, lineIndex);
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
      bindEntryToLine(line.id, lineIndex);
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
        bindEntryToLine(line.id, lineIndex);
      }
      continue;
    }

    if (line.role == 'thinking') {
      flushNarrative();
      final text = line.stream ? message : message.trim();
      thinkingSourceLineIndex ??= lineIndex;
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

    if (line.apiError != null) {
      flushTextBuffers();
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.error,
          text: line.apiError!.message,
        ),
      );
      bindEntryToLine(line.id, lineIndex);
      continue;
    }

    if (line.tool != null) {
      flushTextBuffers();
      final tool = line.tool!;
      final bashApproval = tool.toolUseId != null
          ? bashApprovalByToolUseId[tool.toolUseId!]
          : null;
      upsertAction(
        id: line.id,
        lineIndex: lineIndex,
        toolUseId: tool.toolUseId,
        label: formatToolDisplayLabel(
          bashApproval?.toolName ?? tool.name,
          bashApproval?.detail ?? tool.detail,
        ),
        icon: iconForToolName(bashApproval?.toolName ?? tool.name),
        lifecycle: resolveStructuredToolLifecycle(
          tool: tool,
          bashApproval: bashApproval,
        ),
        subagentRole: agentRole,
        bashRun: resolveActionBashRun(tool, message),
      );
      continue;
    }

    if (isThreadFollowUpActivityMessage(message)) {
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
      bindEntryToLine(line.id, lineIndex);
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
      narrativeSourceLineIndex ??= lineIndex;
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
      narrativeSourceLineIndex ??= lineIndex;
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
  if (runProjection != null) {
    _syncProjectionSubagentCards(
      output,
      runProjection,
      effectiveLines,
      entrySourceLineIndex,
    );
    _enrichSubagentEntries(
      output,
      runProjection: runProjection,
      subagentSessions: subagentSessions,
    );
    _sortFeedEntriesByTriggerTime(
      output,
      entrySourceLineIndex,
      effectiveLines,
      runProjection,
    );
  }
  return output;
}

void _syncProjectionSubagentCards(
  List<ActivityFeedEntry> output,
  ThreadRunProjectionSnapshot projection,
  List<ActivityItem> lines,
  Map<String, int> entrySourceLineIndex,
) {
  final subagents = projection.agents
      .where((agent) => agent.kind == 'subagent')
      .toList()
    ..sort((left, right) => left.startedAt.compareTo(right.startedAt));
  if (subagents.isEmpty) return;

  final coveredAgentIds = <String>{
    for (final entry in output)
      if (entry.kind == ActivityFeedKind.subagentMission &&
          entry.agentId != null &&
          entry.agentId!.isNotEmpty)
        entry.agentId!,
  };

  for (final agent in subagents) {
    if (coveredAgentIds.contains(agent.agentId)) continue;

    final claimIndex = _findUnclaimedMissionIndex(
      output,
      agent,
      projection,
      coveredAgentIds,
    );
    if (claimIndex >= 0) {
      final entry = output[claimIndex];
      output[claimIndex] = ActivityFeedEntry(
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
        subagentRole: entry.subagentRole,
        missionPrompt: entry.missionPrompt,
        agentId: agent.agentId,
        running: entry.running,
        durationMs: entry.durationMs,
        statusText: entry.statusText,
        timeline: entry.timeline,
        bashRun: entry.bashRun,
        toolUseId: entry.toolUseId,
      );
      coveredAgentIds.add(agent.agentId);
      continue;
    }

    final delegation = readProjectionAgentDelegation(agent);
    final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
    final cardId = 'projection-agent-${agent.agentId}';
    final card = ActivityFeedEntry(
      id: cardId,
      kind: ActivityFeedKind.subagentMission,
      text: delegation?.summary ?? resolveSubagentRunDisplayTitle(role),
      subagentRole: role,
      missionPrompt: delegation?.prompt,
      agentId: agent.agentId,
    );
    output.add(card);
    final triggerLineIndex = _resolveAgentTriggerLineIndex(
      agent,
      lines,
      projection,
    );
    if (triggerLineIndex != null) {
      entrySourceLineIndex[cardId] = triggerLineIndex;
    }
    coveredAgentIds.add(agent.agentId);
  }
}

int _findUnclaimedMissionIndex(
  List<ActivityFeedEntry> output,
  ThreadRunProjectionAgent agent,
  ThreadRunProjectionSnapshot projection,
  Set<String> coveredAgentIds,
) {
  final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
  final occurrence = _projectionSubagentRoleOccurrence(projection, agent);
  var seen = 0;
  for (var index = 0; index < output.length; index++) {
    final entry = output[index];
    if (entry.kind != ActivityFeedKind.subagentMission) continue;
    final entryAgentId = entry.agentId?.trim();
    if (entryAgentId != null && entryAgentId.isNotEmpty) {
      if (entryAgentId == agent.agentId) return index;
      continue;
    }
    final entryRole =
        normalizeAgentDisplayRole(entry.subagentRole) ?? entry.subagentRole ?? '';
    if (entryRole != role) continue;
    if (seen == occurrence) return index;
    seen++;
  }
  return -1;
}

int _projectionSubagentRoleOccurrence(
  ThreadRunProjectionSnapshot projection,
  ThreadRunProjectionAgent agent,
) {
  final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
  final sameRoleAgents = projection.agents
      .where((entry) => entry.kind == 'subagent')
      .where(
        (entry) => (normalizeAgentDisplayRole(entry.role) ?? entry.role) == role,
      )
      .toList()
    ..sort((left, right) => left.startedAt.compareTo(right.startedAt));
  for (var index = 0; index < sameRoleAgents.length; index++) {
    if (sameRoleAgents[index].agentId == agent.agentId) {
      return index;
    }
  }
  return sameRoleAgents.length;
}

int? _resolveAgentTriggerLineIndex(
  ThreadRunProjectionAgent agent,
  List<ActivityItem> lines,
  ThreadRunProjectionSnapshot projection,
) {
  final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
  final occurrence = _projectionSubagentRoleOccurrence(projection, agent);
  var seen = 0;
  for (var index = 0; index < lines.length; index++) {
    final line = lines[index];
    final mission = parseSubagentMissionMessage(line.message);
    if (mission != null && isSubagentDisplayRole(mission.role)) {
      final missionRole =
          normalizeAgentDisplayRole(mission.role) ?? mission.role;
      if (missionRole == role) {
        if (seen == occurrence) return index;
        seen++;
      }
      continue;
    }
    final lineRole = normalizeAgentDisplayRole(line.role);
    if (lineRole != role) continue;
    final message =
        stripSubagentBracketPrefix(stripActivityStatusNoise(line.message)).trim();
    if (message.length >= 8 &&
        !message.startsWith('Tool:') &&
        !message.startsWith('Reading ') &&
        !message.startsWith('Running ')) {
      if (seen == occurrence) return index;
      seen++;
    }
  }
  return null;
}

void _sortFeedEntriesByTriggerTime(
  List<ActivityFeedEntry> output,
  Map<String, int> entrySourceLineIndex,
  List<ActivityItem> lines,
  ThreadRunProjectionSnapshot projection,
) {
  final sortAtById = <String, String>{
    for (final entry in output)
      entry.id: _resolveFeedEntrySortAt(
        entry,
        entrySourceLineIndex,
        lines,
        projection,
      ),
  };
  final stableIndex = <String, int>{
    for (var index = 0; index < output.length; index++) output[index].id: index,
  };
  output.sort((left, right) {
    final atDelta = sortAtById[left.id]!.compareTo(sortAtById[right.id]!);
    if (atDelta != 0) return atDelta;
    return stableIndex[left.id]!.compareTo(stableIndex[right.id]!);
  });
}

String _resolveFeedEntrySortAt(
  ActivityFeedEntry entry,
  Map<String, int> entrySourceLineIndex,
  List<ActivityItem> lines,
  ThreadRunProjectionSnapshot projection,
) {
  final agentId = entry.agentId?.trim();
  if (entry.kind == ActivityFeedKind.subagentMission &&
      agentId != null &&
      agentId.isNotEmpty) {
    final agent = findProjectionAgentById(projection, agentId);
    if (agent != null && agent.startedAt.trim().isNotEmpty) {
      return agent.startedAt;
    }
  }
  for (final item in projection.timeline) {
    if (item.id == entry.id && item.at.trim().isNotEmpty) {
      return item.at;
    }
  }
  for (final agent in projection.agents) {
    for (final item in agent.timeline) {
      if (item.id == entry.id && item.at.trim().isNotEmpty) {
        return item.at;
      }
    }
  }
  final lineIndex = entrySourceLineIndex[entry.id];
  if (lineIndex != null) {
    return _interpolateLineTriggeredAt(lineIndex, lines.length, projection);
  }
  return '9999-12-31T23:59:59.999Z';
}

String _interpolateLineTriggeredAt(
  int lineIndex,
  int lineCount,
  ThreadRunProjectionSnapshot projection,
) {
  final anchors = <String>[];
  for (final item in projection.timeline) {
    final at = item.at.trim();
    if (at.isNotEmpty) anchors.add(at);
  }
  for (final agent in projection.agents) {
    final startedAt = agent.startedAt.trim();
    if (startedAt.isNotEmpty) anchors.add(startedAt);
    final endedAt = agent.endedAt?.trim();
    if (endedAt != null && endedAt.isNotEmpty) anchors.add(endedAt);
  }
  if (anchors.isEmpty) {
    final padded = lineIndex.toString().padLeft(4, '0');
    return '1970-01-01T00:00:$padded.000Z';
  }
  anchors.sort();
  if (lineCount <= 1) return anchors.first;
  final ratio = lineIndex / (lineCount - 1);
  final minMs = DateTime.parse(anchors.first).millisecondsSinceEpoch;
  final maxMs = DateTime.parse(anchors.last).millisecondsSinceEpoch;
  final ms = minMs + ((maxMs - minMs) * ratio).round();
  return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true).toIso8601String();
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

  final sessionsByAgentId = indexSubagentSessionsByAgentId(subagentSessions);
  final absorbedToolUseIds = <String>{};
  final roleOccurrence = <String, int>{};

  for (var index = 0; index < output.length; index++) {
    final entry = output[index];
    if (entry.kind != ActivityFeedKind.subagentMission) continue;

    final role =
        normalizeAgentDisplayRole(entry.subagentRole) ?? entry.subagentRole ?? '';
    ThreadRunProjectionAgent? agent;
    if (entry.agentId != null &&
        entry.agentId!.isNotEmpty &&
        runProjection != null) {
      agent = findProjectionAgentById(runProjection, entry.agentId!);
    } else if (runProjection != null) {
      final occurrence = roleOccurrence[role] ?? 0;
      roleOccurrence[role] = occurrence + 1;
      agent = findProjectionAgentForMission(runProjection, role, occurrence);
    }

    final timing =
        agent != null ? sessionsByAgentId[agent.agentId] : null;
    final running = resolveSubagentRunning(agent: agent, timing: timing);
    final durationMs = resolveSubagentDurationMs(agent: agent, timing: timing);
    final timeline = agent != null
        ? buildSubagentTimelineFromProjection(agent.timeline)
        : const <SubagentTimelineEntry>[];
    final statusText = agent != null
        ? resolveProjectionAgentStatusText(agent)
        : (running ? '工作中' : null);
    final missionPrompt = entry.missionPrompt ??
        agent?.delegationPrompt ??
        (agent?.delegationSummary?.trim().isNotEmpty == true
            ? agent!.delegationSummary
            : null);
    final summary = entry.text.trim().isNotEmpty
        ? entry.text
        : (agent != null
            ? (readProjectionAgentDelegation(agent)?.summary ??
                resolveSubagentRunDisplayTitle(role))
            : resolveSubagentRunDisplayTitle(role));

    for (final item in timeline) {
      final toolUseId = item.toolUseId;
      if (toolUseId != null && toolUseId.isNotEmpty) {
        absorbedToolUseIds.add(toolUseId);
      }
    }

    output[index] = ActivityFeedEntry(
      id: entry.id,
      kind: entry.kind,
      text: summary,
      subagentRole: entry.subagentRole,
      missionPrompt: missionPrompt,
      agentId: agent?.agentId ?? entry.agentId,
      running: running,
      durationMs: durationMs,
      statusText: statusText,
      timeline: timeline,
    );
  }

  if (absorbedToolUseIds.isEmpty) return;
  output.removeWhere(
    (entry) =>
        entry.kind == ActivityFeedKind.action &&
        entry.toolUseId != null &&
        absorbedToolUseIds.contains(entry.toolUseId),
  );
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
    this.topPadding = 8,
  });

  final List<ActivityFeedEntry> entries;
  final ScrollController scrollController;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: ListView.builder(
        controller: scrollController,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(12, topPadding, 12, 12),
        cacheExtent: 1200,
        itemCount: entries.length,
        itemBuilder: (context, index) {
          final entry = entries[index];
          return RepaintBoundary(
            child: _ActivityFeedEntryTile(
              key: ValueKey(entry.id),
              entry: entry,
            ),
          );
        },
      ),
    );
  }
}

class _ActivityFeedEntryTile extends StatelessWidget {
  const _ActivityFeedEntryTile({super.key, required this.entry});

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
          lifecycle: entry.lifecycle,
          bashRun: entry.bashRun,
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
          if (text.isNotEmpty)
            EcoMarkdown(text: text, selectable: false),
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
    if (widget.streaming && !_hasBody) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
        child: ShimmerText(
          text: '正在思考',
          style: Theme.of(context).textTheme.bodySmall,
          baseColor: eco.textMuted,
          highlightColor: eco.textSecondary,
        ),
      );
    }

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
                          text: '正在思考',
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
                  muted: true,
                  selectable: false,
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
  const _ActionTile({
    required this.label,
    required this.icon,
    this.lifecycle,
    this.bashRun,
  });

  final String label;
  final ActivityActionIcon icon;
  final ToolActionLifecycle? lifecycle;
  final BashRunCardDisplay? bashRun;

  @override
  Widget build(BuildContext context) {
    if (bashRun != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: _BashRunCard(
          display: bashRun!,
          lifecycle: lifecycle,
        ),
      );
    }

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

class _BashRunCard extends StatelessWidget {
  const _BashRunCard({
    required this.display,
    this.lifecycle,
  });

  final BashRunCardDisplay display;
  final ToolActionLifecycle? lifecycle;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final running = lifecycle == ToolActionLifecycle.running;
    final failed = lifecycle == ToolActionLifecycle.failed;
    final borderColor = failed
        ? EcoColors.danger.withValues(alpha: 0.45)
        : running
            ? EcoColors.accent.withValues(alpha: 0.45)
            : eco.borderSubtle;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.cardSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Row(
              children: [
                Icon(
                  Icons.terminal,
                  size: 16,
                  color: running ? EcoColors.accentText : eco.textMuted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    display.title,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: EcoColors.textHeading,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                ),
                if (display.meta != null && display.meta!.isNotEmpty)
                  Text(
                    display.meta!,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: eco.textMuted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                  ),
              ],
            ),
          ),
          if (display.body != null && display.body!.isNotEmpty) ...[
            Divider(height: 1, color: eco.borderSubtle),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: SelectableText(
                display.body!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: eco.textSecondary,
                      fontFamily: 'Menlo',
                      height: 1.45,
                    ),
              ),
            ),
          ],
        ],
      ),
    );
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
