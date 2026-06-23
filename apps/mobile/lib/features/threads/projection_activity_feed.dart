import '../../core/models/thread_run_projection.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/subagent_projection_feed.dart';
import 'activity_feed.dart';

class _ProjectionFeedSlot {
  const _ProjectionFeedSlot({
    required this.entry,
    required this.at,
    required this.sequence,
    required this.sortKey,
  });

  final ActivityFeedEntry entry;
  final String at;
  final int sequence;
  final String sortKey;
}

class _ProjectionSubagentCard {
  const _ProjectionSubagentCard({
    required this.agent,
    required this.displayTimeline,
    required this.statusText,
  });

  final ThreadRunProjectionAgent agent;
  final List<ThreadRunProjectionTimelineItem> displayTimeline;
  final String? statusText;
}

List<ActivityFeedEntry> buildProjectionActivityFeed({
  required ThreadRunProjectionSnapshot projection,
  String? threadPrompt,
  String? threadId,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
}) {
  final requestSpansById = {
    for (final span in projection.requestSpans) span.requestId: span,
  };
  final sessionsByAgentId = indexSubagentSessionsByAgentId(subagentSessions);
  final slots = <_ProjectionFeedSlot>[];

  final hasProjectedUserPrompt = projection.timeline.any(_isProjectionUserPromptItem);
  final prompt = threadPrompt?.trim();
  if (!hasProjectedUserPrompt && prompt != null && prompt.isNotEmpty) {
    slots.add(
      _ProjectionFeedSlot(
        entry: ActivityFeedEntry(
          id: 'user-prompt-${threadId ?? projection.threadId}',
          kind: ActivityFeedKind.user,
          text: prompt,
        ),
        at: '1970-01-01T00:00:00.000Z',
        sequence: 0,
        sortKey: 'user:prompt',
      ),
    );
  }

  for (final item in projection.timeline.where(_isProjectionUserPromptItem)) {
    slots.add(
      _ProjectionFeedSlot(
        entry: ActivityFeedEntry(
          id: item.id,
          kind: ActivityFeedKind.user,
          text: item.text.trim(),
        ),
        at: item.at,
        sequence: item.sequence,
        sortKey: 'user:${item.id}',
      ),
    );
  }

  final subagentCards = projection.agents
      .where((agent) => agent.kind == 'subagent')
      .map((agent) {
        final displayTimeline = _filterProjectionTimelineForDetailFeed(
          agent.timeline,
          requestSpansById,
        );
        final displayAgent = ThreadRunProjectionAgent(
          agentId: agent.agentId,
          role: agent.role,
          kind: agent.kind,
          status: agent.status,
          startedAt: agent.startedAt,
          durationMs: agent.durationMs,
          timeline: displayTimeline,
          delegationSummary: agent.delegationSummary,
          delegationPrompt: agent.delegationPrompt,
          parentToolUseId: agent.parentToolUseId,
          latestActivity: agent.latestActivity,
          endedAt: agent.endedAt,
        );
        return _ProjectionSubagentCard(
          agent: displayAgent,
          displayTimeline: displayTimeline,
          statusText: resolveProjectionAgentStatusText(displayAgent),
        );
      })
      .toList();

  final mainTimeline = _filterAbsorbedSubagentDelegations(
    _filterMainTimelineForFeed(
      _mainProjectionTimelineItems(projection),
      requestSpansById,
    ),
    subagentCards,
    requestSpansById,
  );

  for (final item in mainTimeline) {
    final entry = _projectionItemToFeedEntry(item);
    if (entry == null) continue;
    slots.add(
      _ProjectionFeedSlot(
        entry: entry,
        at: item.at,
        sequence: item.sequence,
        sortKey: 'main:${item.id}',
      ),
    );
  }

  for (final card in subagentCards) {
    final agent = card.agent;
    final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
    final delegation = readProjectionAgentDelegation(agent);
    final timing = sessionsByAgentId[agent.agentId];
    final running = resolveSubagentRunning(agent: agent, timing: timing);
    final durationMs = resolveSubagentDurationMs(agent: agent, timing: timing);
    final timeline = buildSubagentTimelineFromProjection(card.displayTimeline);

    slots.add(
      _ProjectionFeedSlot(
        entry: ActivityFeedEntry(
          id: 'projection-agent-${agent.agentId}',
          kind: ActivityFeedKind.subagentMission,
          text: delegation?.summary ?? resolveSubagentRunDisplayTitle(role),
          subagentRole: role,
          missionPrompt: delegation?.prompt,
          agentId: agent.agentId,
          running: running,
          durationMs: durationMs,
          statusText: card.statusText ?? (running ? '工作中' : null),
          timeline: timeline,
        ),
        at: agent.startedAt,
        sequence: card.displayTimeline.firstOrNull?.sequence ?? 0,
        sortKey: 'agent-card:${agent.agentId}',
      ),
    );

    for (final item in card.displayTimeline.where(_isAgentEchoTimelineItem)) {
      final entry = _projectionItemToFeedEntry(item, agentRole: role);
      if (entry == null) continue;
      slots.add(
        _ProjectionFeedSlot(
          entry: entry,
          at: item.at,
          sequence: item.sequence,
          sortKey: 'agent:${agent.agentId}:${item.id}',
        ),
      );
    }
  }

  slots.sort((left, right) {
    final atDelta = left.at.compareTo(right.at);
    if (atDelta != 0) return atDelta;
    final sequenceDelta = left.sequence.compareTo(right.sequence);
    if (sequenceDelta != 0) return sequenceDelta;
    return left.sortKey.compareTo(right.sortKey);
  });

  return slots.map((slot) => slot.entry).toList();
}

List<ThreadRunProjectionTimelineItem> _mainProjectionTimelineItems(
  ThreadRunProjectionSnapshot projection,
) {
  final items = <ThreadRunProjectionTimelineItem>[...projection.timeline];
  for (final agent in projection.agents) {
    if (agent.kind == 'subagent') continue;
    items.addAll(agent.timeline);
  }
  items.sort((left, right) {
    final atDelta = left.at.compareTo(right.at);
    if (atDelta != 0) return atDelta;
    final sequenceDelta = left.sequence.compareTo(right.sequence);
    if (sequenceDelta != 0) return sequenceDelta;
    return left.id.compareTo(right.id);
  });
  return items;
}

bool _isProjectionUserPromptItem(ThreadRunProjectionTimelineItem item) {
  return item.eventType == 'thread.user_prompt' &&
      item.text.trim().isNotEmpty &&
      !isThreadFollowUpActivityMessage(item.text);
}

bool _isAgentEchoTimelineItem(ThreadRunProjectionTimelineItem item) {
  if (_projectionLiveType(item) == 'todo.updated') return false;
  if (item.eventType != 'message.delta' &&
      item.eventType != 'message.final' &&
      item.eventType != 'thinking.delta' &&
      item.eventType != 'thinking.final') {
    return false;
  }
  return item.text.trim().isNotEmpty;
}

List<ThreadRunProjectionTimelineItem> _filterMainTimelineForFeed(
  List<ThreadRunProjectionTimelineItem> timeline,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final displayTimeline =
      _filterProjectionTimelineForDetailFeed(timeline, requestSpansById);
  return _filterCompactionTimelineForFeed(
    displayTimeline.where((item) => !_isMainTimelineNoiseItem(item)).toList(),
  );
}

List<ThreadRunProjectionTimelineItem> _filterAbsorbedSubagentDelegations(
  List<ThreadRunProjectionTimelineItem> timeline,
  List<_ProjectionSubagentCard> subagentCards,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final absorbedToolUseIds = _collectAgentTimelineToolUseIds(
    subagentCards,
    requestSpansById,
  );
  for (final card in subagentCards) {
    final parentToolUseId = card.agent.parentToolUseId?.trim();
    if (parentToolUseId != null && parentToolUseId.isNotEmpty) {
      absorbedToolUseIds.add(parentToolUseId);
    }
  }
  if (absorbedToolUseIds.isEmpty) return timeline;

  return timeline.where((item) {
    final mission = parseSubagentMissionMessage(item.text);
    if (mission != null) {
      final toolUseId = readProjectionToolMetadata(item.metadata)?.toolUseId
              ?.trim() ??
          readBashApprovalMetadata(item.metadata)?.toolUseId.trim();
      if (toolUseId != null && absorbedToolUseIds.contains(toolUseId)) {
        return false;
      }
    }
    final bashApproval = readBashApprovalMetadata(item.metadata);
    final approvalToolUseId = bashApproval?.toolUseId.trim();
    if (approvalToolUseId != null &&
        approvalToolUseId.isNotEmpty &&
        absorbedToolUseIds.contains(approvalToolUseId)) {
      return false;
    }
    if (item.eventType != 'tool.started' && item.eventType != 'tool.completed') {
      return true;
    }
    final toolUseId = readProjectionToolMetadata(item.metadata)?.toolUseId?.trim();
    return toolUseId == null || !absorbedToolUseIds.contains(toolUseId);
  }).toList();
}

Set<String> _collectAgentTimelineToolUseIds(
  List<_ProjectionSubagentCard> subagentCards,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final ids = <String>{};
  for (final card in subagentCards) {
    final displayTimeline = _filterProjectionTimelineForDetailFeed(
      card.agent.timeline,
      requestSpansById,
    );
    for (final item in displayTimeline) {
      final toolUseId = readProjectionToolMetadata(item.metadata)?.toolUseId
              ?.trim() ??
          readBashApprovalMetadata(item.metadata)?.toolUseId.trim();
      if (toolUseId != null && toolUseId.isNotEmpty) {
        ids.add(toolUseId);
      }
    }
  }
  return ids;
}

List<ThreadRunProjectionTimelineItem> _filterProjectionTimelineForDetailFeed(
  List<ThreadRunProjectionTimelineItem> timeline,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final displayTimeline =
      _buildProjectionDisplayTimelineItems(timeline, requestSpansById);
  final failedTools = displayTimeline
      .where((item) => item.eventType == 'tool.failed')
      .map((item) => _resolveProjectionToolName(item).toLowerCase())
      .toSet();
  if (failedTools.isEmpty) return displayTimeline;
  return displayTimeline
      .where((item) => !_isProjectionToolFailureDuplicateMessage(item, failedTools))
      .toList();
}

List<ThreadRunProjectionTimelineItem> _buildProjectionDisplayTimelineItems(
  List<ThreadRunProjectionTimelineItem> timeline,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final latestStreamDisplayByKey = <String, ThreadRunProjectionTimelineItem>{};
  final latestToolDisplayByKey = <String, ThreadRunProjectionTimelineItem>{};
  final latestLifecycleDisplayByKey = <String, ThreadRunProjectionTimelineItem>{};
  final latestReconnectDisplayByKey = <String, ThreadRunProjectionTimelineItem>{};

  for (final item in timeline) {
    final reconnectKey = _projectionReconnectDisplayKey(item);
    if (reconnectKey != null) {
      final current = latestReconnectDisplayByKey[reconnectKey];
      if (current == null || _compareTimelineItems(current, item) <= 0) {
        latestReconnectDisplayByKey[reconnectKey] = item;
      }
    }

    final lifecycleKey = _projectionToolLifecycleKey(item);
    if (lifecycleKey != null) {
      final current = latestLifecycleDisplayByKey[lifecycleKey];
      if (current == null ||
          _compareProjectionLifecycleDisplayItems(item, current) > 0) {
        latestLifecycleDisplayByKey[lifecycleKey] = item;
      }
    }

    final streamKey = _projectionStreamDisplayKey(item);
    if (streamKey != null) {
      final current = latestStreamDisplayByKey[streamKey];
      if (current == null || _compareTimelineItems(current, item) <= 0) {
        latestStreamDisplayByKey[streamKey] = item;
      }
    }

    final toolKey = _projectionToolDisplayKey(item);
    if (toolKey != null) {
      final current = latestToolDisplayByKey[toolKey];
      if (current == null || _compareProjectionToolDisplayItems(current, item) <= 0) {
        latestToolDisplayByKey[toolKey] = item;
      }
    }
  }

  final displayItems = <ThreadRunProjectionTimelineItem>[];
  for (final item in timeline) {
    final reconnectKey = _projectionReconnectDisplayKey(item);
    if (reconnectKey != null &&
        latestReconnectDisplayByKey[reconnectKey]?.id != item.id) {
      continue;
    }
    final lifecycleKey = _projectionToolLifecycleKey(item);
    if (lifecycleKey != null &&
        latestLifecycleDisplayByKey[lifecycleKey]?.id != item.id) {
      continue;
    }
    final streamKey = _projectionStreamDisplayKey(item);
    if (streamKey != null && latestStreamDisplayByKey[streamKey]?.id != item.id) {
      continue;
    }
    final toolKey = _projectionToolDisplayKey(item);
    if (toolKey != null && latestToolDisplayByKey[toolKey]?.id != item.id) {
      continue;
    }
    final settled = _settleTerminalStreamDisplayItem(item, requestSpansById);
    if (settled != null) {
      displayItems.add(settled);
    }
  }
  return displayItems;
}

ThreadRunProjectionTimelineItem? _settleTerminalStreamDisplayItem(
  ThreadRunProjectionTimelineItem item,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  if (item.eventType != 'message.delta' && item.eventType != 'thinking.delta') {
    return item;
  }
  if (item.text.trim().isEmpty) return null;
  final requestId = item.requestId?.trim();
  final span = requestId != null ? requestSpansById[requestId] : null;
  if (span == null || _isProjectionRequestActive(span)) {
    return item;
  }
  return ThreadRunProjectionTimelineItem(
    id: item.id,
    sequence: item.sequence,
    eventType: item.eventType == 'thinking.delta' ? 'thinking.final' : 'message.final',
    scope: item.scope,
    text: item.text,
    at: item.at,
    role: item.role,
    agentId: item.agentId,
    requestId: item.requestId,
    metadata: item.metadata,
  );
}

bool _isProjectionRequestActive(ThreadRunProjectionRequestSpan span) {
  return span.status == 'waiting_first_token' || span.status == 'streaming';
}

List<ThreadRunProjectionTimelineItem> _filterCompactionTimelineForFeed(
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  return timeline.where((item) {
    if (item.eventType != 'context.compaction.started') return true;
    final index = timeline.indexOf(item);
    return !timeline
        .skip(index + 1)
        .any((later) => _isProjectionContextCompactionItem(later));
  }).toList();
}

bool _isProjectionContextCompactionItem(ThreadRunProjectionTimelineItem item) {
  return item.eventType == 'context.compaction.started' ||
      item.eventType == 'context.compaction.completed' ||
      item.eventType == 'context.compaction.failed';
}

bool _isMainTimelineNoiseItem(ThreadRunProjectionTimelineItem item) {
  if (_isProjectionUserPromptItem(item)) return false;
  if (_isProjectionInternalMessageText(item.text) ||
      isThreadFollowUpActivityMessage(item.text)) {
    return true;
  }
  final liveType = _projectionLiveType(item);
  if (liveType != null && _isThreadFollowUpLiveEvent(liveType)) return true;
  if (_isProjectionOtelToolDurationSummary(item)) return true;
  if (item.eventType == 'agent.started' ||
      item.eventType == 'agent.stopped' ||
      item.eventType == 'agent.abandoned' ||
      item.eventType == 'diagnostic') {
    return true;
  }
  if (item.eventType != 'thread.status') return false;
  final text = item.text.trim();
  return text.isEmpty ||
      text == '状态已更新' ||
      _isProjectionLifecycleText(text) ||
      _isProjectionUsageNoiseText(text);
}

ActivityFeedEntry? _projectionItemToFeedEntry(
  ThreadRunProjectionTimelineItem item, {
  String? agentRole,
}) {
  final text = item.text.trim();
  final reconnect = parseReconnectActivityMessage(text);
  if (reconnect != null) {
    return ActivityFeedEntry(
      id: item.id,
      kind: ActivityFeedKind.phase,
      text: reconnect.summary,
      detail: reconnect.detail,
      reconnecting: true,
    );
  }

  final bashApproval = readBashApprovalMetadata(item.metadata);
  if (bashApproval != null && item.scope != 'agent') {
    return _buildProjectionToolActionEntry(item, bashApproval: bashApproval);
  }

  if (item.eventType == 'message.delta' || item.eventType == 'message.final') {
    if (text.isEmpty && item.eventType != 'message.delta') return null;
    return ActivityFeedEntry(
      id: item.id,
      kind: ActivityFeedKind.assistant,
      text: item.text,
      streaming: item.eventType == 'message.delta',
      subagentRole: agentRole ?? _resolveProjectionSubagentRole(item),
    );
  }

  if (item.eventType == 'thinking.delta' || item.eventType == 'thinking.final') {
    return ActivityFeedEntry(
      id: item.id,
      kind: ActivityFeedKind.thinking,
      text: item.text,
      streaming: item.eventType == 'thinking.delta',
    );
  }

  if (item.eventType == 'tool.started' ||
      item.eventType == 'tool.completed' ||
      item.eventType == 'tool.failed') {
    return _buildProjectionToolActionEntry(item);
  }

  if (item.eventType == 'api.error') {
    final apiError = _readProjectionApiError(item);
    return ActivityFeedEntry(
      id: item.id,
      kind: ActivityFeedKind.error,
      text: apiError?.message ?? text,
    );
  }

  final phaseLabel = _resolveProjectionPhaseLabel(item);
  if (phaseLabel != null) {
    return ActivityFeedEntry(
      id: item.id,
      kind: ActivityFeedKind.phase,
      text: phaseLabel,
    );
  }

  return null;
}

ActivityFeedEntry _buildProjectionToolActionEntry(
  ThreadRunProjectionTimelineItem item, {
  ThreadRunBashApprovalMetadata? bashApproval,
}) {
  bashApproval ??= readBashApprovalMetadata(item.metadata);
  final tool = readProjectionToolMetadata(item.metadata);
  final toolName = bashApproval?.toolName ?? tool?.name ?? _resolveProjectionToolName(item);
  final description = bashApproval?.description?.trim().isNotEmpty == true
      ? bashApproval!.description!.trim()
      : (tool?.name == 'Bash' ? tool?.description?.trim() : null);
  final label = description != null && description.isNotEmpty
      ? description
      : formatStructuredToolActionLabel(
          tool ??
              ThreadRunToolMetadata(
                name: toolName,
                detail: bashApproval?.detail ?? tool?.detail,
                toolUseId: bashApproval?.toolUseId ?? tool?.toolUseId,
              ),
          bashApproval: bashApproval,
        );
  final lifecycle = bashApproval != null
      ? bashApprovalPhaseToLifecycle(bashApproval.phase)
      : _toolLifecycleFromProjectionItem(item, tool);
  final command = tool?.detail?.trim() ?? bashApproval?.detail?.trim();
  return ActivityFeedEntry(
    id: item.id,
    kind: ActivityFeedKind.action,
    text: label,
    actionIcon: iconForToolName(toolName),
    lifecycle: lifecycle,
    toolUseId: bashApproval?.toolUseId ?? tool?.toolUseId,
    subagentRole: _resolveProjectionSubagentRole(item),
    agentId: item.agentId,
    bashRun: toolName == 'Bash'
        ? resolveBashRunCardDisplay(
            toolName: 'Bash',
            command: command,
            description: description ?? tool?.description,
            output: tool?.output,
            durationMs: tool?.durationMs,
            summaryText: item.text,
          )
        : null,
  );
}

ToolActionLifecycle? _toolLifecycleFromProjectionItem(
  ThreadRunProjectionTimelineItem item,
  ThreadRunToolMetadata? tool,
) {
  if (item.eventType == 'tool.failed') return ToolActionLifecycle.failed;
  if (tool != null) return toolLifecycleFromMetadata(tool);
  if (item.eventType == 'tool.completed') return ToolActionLifecycle.completed;
  return ToolActionLifecycle.running;
}

String? _resolveProjectionSubagentRole(ThreadRunProjectionTimelineItem item) {
  final role = normalizeAgentDisplayRole(item.role);
  if (role == null || role == 'tool') return null;
  return role;
}

String _resolveProjectionToolName(ThreadRunProjectionTimelineItem item) {
  final tool = readProjectionToolMetadata(item.metadata);
  final name = tool?.name.trim();
  if (name != null && name.isNotEmpty) return name;
  return 'Tool';
}

String? _projectionLiveType(ThreadRunProjectionTimelineItem item) {
  final liveType = item.metadata?['liveType'];
  return liveType is String ? liveType : null;
}

bool _isThreadFollowUpLiveEvent(String liveType) {
  return liveType.startsWith('thread.follow_up.');
}

bool _isProjectionOtelToolDurationSummary(ThreadRunProjectionTimelineItem item) {
  if ((item.eventType != 'tool.started' && item.eventType != 'tool.completed') ||
      _projectionLiveType(item) != 'otel.activity') {
    return false;
  }
  final tool = readProjectionToolMetadata(item.metadata);
  if (tool?.durationMs != null) return true;
  final text = item.text.trim();
  return RegExp(r'^Tool:\s*[^·]+?\s+\(\d+(?:\.\d+)?s\)$', caseSensitive: false)
          .hasMatch(text) ||
      RegExp(
        r'^Tool:\s*Agent\s*·\s*.+\s+\(\d+(?:\.\d+)?s\)$',
        caseSensitive: false,
      ).hasMatch(text);
}

bool _isProjectionUsageNoiseText(String text) {
  return RegExp(r'^[↑↓⊙][↑↓⊙\d\s.,kKmM$%·+()-]*$').hasMatch(text);
}

bool _isProjectionLifecycleText(String text) {
  return RegExp(r'^Subagent\s+\S+\s+(started|stopped|abandoned)$', caseSensitive: false)
      .hasMatch(text);
}

bool _isProjectionInternalMessageText(String text) {
  final trimmed = text.trim();
  return trimmed.startsWith('__eco_worktree_merge__') ||
      trimmed == '执行完成。' ||
      trimmed == '执行完成，变更已写入项目目录。' ||
      trimmed == '执行完成，工作树内无相对基线的文件变更。' ||
      RegExp(r'^正在启动 Claude Agent SDK').hasMatch(trimmed) ||
      RegExp(r'^Working in project directory:').hasMatch(trimmed) ||
      RegExp(r'^Local model router ready:').hasMatch(trimmed) ||
      _isProjectionApprovalTransitionStatus(trimmed);
}

bool _isProjectionApprovalTransitionStatus(String text) {
  return text == '等待工具读取确认…' ||
      text == '等待 Bash 执行确认…' ||
      text == '读取已确认，继续执行…' ||
      text == '读取已拒绝，等待 Agent 调整…' ||
      text == 'Bash 已确认，继续执行…' ||
      text == 'Bash 已拒绝，等待 Agent 调整…';
}

bool _isProjectionToolFailureDuplicateMessage(
  ThreadRunProjectionTimelineItem item,
  Set<String> failedTools,
) {
  if (item.eventType == 'tool.failed') return false;
  final text = item.text.trim();
  if (text.isEmpty) return false;
  if (text == '工具调用被拒绝') return true;
  final shortMatch = RegExp(r'^Permission denied for ([A-Za-z0-9_]+)$', caseSensitive: false)
      .firstMatch(text);
  if (shortMatch != null &&
      failedTools.contains(shortMatch.group(1)!.toLowerCase())) {
    return true;
  }
  final fullMatch =
      RegExp(r'^Permission denied for ([A-Za-z0-9_]+):', caseSensitive: false)
          .firstMatch(text);
  if (fullMatch != null &&
      failedTools.contains(fullMatch.group(1)!.toLowerCase())) {
    return true;
  }
  return false;
}

String? _resolveProjectionPhaseLabel(ThreadRunProjectionTimelineItem item) {
  final text = item.text.trim();
  if (item.eventType == 'context.compaction.started') {
    return text.isEmpty ? '正在自动压缩上下文' : text;
  }
  if (item.eventType == 'context.compaction.completed') {
    return text.isEmpty ? '上下文已自动压缩' : text;
  }
  if (item.eventType == 'context.compaction.failed') {
    return text.isEmpty ? '上下文压缩失败' : text;
  }
  if (item.eventType == 'request.retry_scheduled') {
    return text.isEmpty ? '准备重试' : text;
  }
  if (item.eventType == 'request.completed') {
    return text.isEmpty ? '模型请求完成' : text;
  }
  if (item.eventType == 'request.failed') {
    return text.isEmpty ? '模型请求失败' : text;
  }
  if (item.eventType == 'request.cancelled') {
    return text.isEmpty ? '模型请求已取消' : text;
  }
  if (item.eventType == 'diagnostic') {
    return text.isEmpty ? '运行诊断' : text;
  }
  if (item.eventType == 'thread.status') {
    if (text.isEmpty || text == '状态已更新' || _isProjectionLifecycleText(text)) {
      return null;
    }
    return text;
  }
  return null;
}

class _ProjectionApiError {
  const _ProjectionApiError({required this.message});

  final String message;
}

_ProjectionApiError? _readProjectionApiError(ThreadRunProjectionTimelineItem item) {
  final raw = item.metadata?['apiError'];
  if (raw is! Map<String, dynamic>) return null;
  final message = (raw['message'] as String?)?.trim() ?? '';
  if (message.isEmpty) return null;
  return _ProjectionApiError(message: message);
}

String? _projectionToolLifecycleKey(ThreadRunProjectionTimelineItem item) {
  final bashApproval = readBashApprovalMetadata(item.metadata);
  if (bashApproval != null) return 'lifecycle:${bashApproval.toolUseId}';
  final tool = readProjectionToolMetadata(item.metadata);
  final toolUseId = tool?.toolUseId?.trim();
  if (toolUseId != null &&
      toolUseId.isNotEmpty &&
      (item.eventType == 'tool.started' ||
          item.eventType == 'tool.completed' ||
          item.eventType == 'tool.failed')) {
    return 'lifecycle:$toolUseId';
  }
  return null;
}

String? _projectionToolDisplayKey(ThreadRunProjectionTimelineItem item) {
  if (item.eventType != 'tool.started' && item.eventType != 'tool.completed') {
    return null;
  }
  final toolUseId = readProjectionToolMetadata(item.metadata)?.toolUseId?.trim();
  if (toolUseId == null || toolUseId.isEmpty) return null;
  return 'tool:$toolUseId';
}

String? _projectionReconnectDisplayKey(ThreadRunProjectionTimelineItem item) {
  return isReconnectActivityMessage(item.text.trim()) ? 'reconnect' : null;
}

String? _projectionStreamDisplayKey(ThreadRunProjectionTimelineItem item) {
  if (!_isStreamingRequestDisplayItem(item)) return null;
  final channel = item.eventType.startsWith('thinking') ? 'thinking' : 'message';
  final requestId = item.requestId?.trim();
  if (requestId != null && requestId.isNotEmpty) {
    return '$channel:request:$requestId';
  }
  final owner = item.agentId != null
      ? 'agent:${item.agentId}'
      : (item.role != null ? 'role:${item.role}' : 'scope:${item.scope}');
  return '$channel:$owner';
}

bool _isStreamingRequestDisplayItem(ThreadRunProjectionTimelineItem item) {
  if (_projectionLiveType(item) == 'todo.updated') return false;
  return item.eventType == 'message.delta' ||
      item.eventType == 'message.final' ||
      item.eventType == 'thinking.delta' ||
      item.eventType == 'thinking.final';
}

int _compareTimelineItems(
  ThreadRunProjectionTimelineItem left,
  ThreadRunProjectionTimelineItem right,
) {
  final atDelta = left.at.compareTo(right.at);
  if (atDelta != 0) return atDelta;
  final sequenceDelta = left.sequence.compareTo(right.sequence);
  if (sequenceDelta != 0) return sequenceDelta;
  return left.id.compareTo(right.id);
}

int _compareProjectionToolDisplayItems(
  ThreadRunProjectionTimelineItem left,
  ThreadRunProjectionTimelineItem right,
) {
  final timelineDelta = _compareTimelineItems(left, right);
  if (timelineDelta != 0) return timelineDelta;
  return _projectionToolDisplayRichness(left) - _projectionToolDisplayRichness(right);
}

int _projectionToolDisplayRichness(ThreadRunProjectionTimelineItem item) {
  final tool = readProjectionToolMetadata(item.metadata);
  var score = 0;
  if (tool?.detail?.trim().isNotEmpty == true) score += 1;
  if (tool?.description?.trim().isNotEmpty == true) score += 2;
  if (tool?.output?.trim().isNotEmpty == true) score += 4;
  if (tool?.durationMs != null) score += 8;
  if (item.eventType == 'tool.completed') score += 16;
  return score;
}

int _compareProjectionLifecycleDisplayItems(
  ThreadRunProjectionTimelineItem left,
  ThreadRunProjectionTimelineItem right,
) {
  final rank = {
    'tool.failed': 4,
    'tool.completed': 3,
    'bash_approval.rejected': 2,
    'bash_approval.approved': 2,
    'bash_approval.requested': 1,
    'tool.started': 1,
  };
  final leftRank = rank[left.eventType] ?? rank[_projectionLiveType(left)] ?? 0;
  final rightRank = rank[right.eventType] ?? rank[_projectionLiveType(right)] ?? 0;
  if (leftRank != rightRank) return leftRank - rightRank;
  return _compareTimelineItems(left, right);
}
