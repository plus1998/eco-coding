import '../../core/models/thread_run_projection.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/file_change.dart';
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
    required this.missionText,
    required this.statusText,
  });

  final ThreadRunProjectionAgent agent;
  final List<ThreadRunProjectionTimelineItem> displayTimeline;
  final String missionText;
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
        final missionText = resolveSubagentCardMissionText(
          agent,
          mainTimeline: projection.timeline,
        );
        return _ProjectionSubagentCard(
          agent: displayAgent,
          displayTimeline: displayTimeline,
          missionText: missionText,
          statusText: resolveProjectionAgentStatusText(displayAgent),
        );
      })
      .toList();

  final rawMainTimeline = _mainProjectionTimelineItems(projection);
  final mainTimeline = _filterAbsorbedSubagentDelegations(
    _filterMainTimelineForFeed(
      rawMainTimeline,
      requestSpansById,
    ),
    subagentCards,
    requestSpansById,
  );

  for (final item in mainTimeline) {
    final entry = _buildProjectionFeedEntry(
      item,
      requestSpansById,
      rawMainTimeline,
    );
    if (entry == null) continue;
    slots.add(
      _ProjectionFeedSlot(
        entry: entry,
        at: item.at,
        sequence: item.sequence,
        sortKey: entry.id,
      ),
    );
  }

  for (final card in subagentCards) {
    final agent = card.agent;
    final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
    final delegation = readProjectionAgentDelegation(agent);
    final missionText = card.missionText;
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
          missionPrompt: missionText.isNotEmpty
              ? missionText
              : delegation?.prompt,
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
      final entry = _buildProjectionFeedEntry(
        item,
        requestSpansById,
        rawMainTimeline,
        agentId: agent.agentId,
        agentRole: role,
      );
      if (entry == null) continue;
      slots.add(
        _ProjectionFeedSlot(
          entry: entry,
          at: item.at,
          sequence: item.sequence,
          sortKey: entry.id,
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

ActivityFeedEntry? _buildProjectionFeedEntry(
  ThreadRunProjectionTimelineItem item,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
  List<ThreadRunProjectionTimelineItem> rawMainTimeline, {
  String? agentId,
  String? agentRole,
}) {
  final feedId = _projectionMainFeedEntryKey(
    item,
    requestSpansById,
    rawMainTimeline,
    agentId: agentId,
  );
  return _projectionItemToFeedEntry(
    item,
    feedId: feedId,
    agentRole: agentRole,
  );
}

String _projectionMainFeedEntryKey(
  ThreadRunProjectionTimelineItem item,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
  List<ThreadRunProjectionTimelineItem> rawMainTimeline, {
  String? agentId,
}) {
  final scope = agentId != null ? 'agent:$agentId' : 'main';
  final streamKey =
      _projectionStreamDisplayKey(item, requestSpansById, rawMainTimeline);
  if (streamKey != null) {
    return '$scope:stream:$streamKey';
  }
  final lifecycleKey = _projectionToolLifecycleKey(item);
  if (lifecycleKey != null) {
    return '$scope:$lifecycleKey';
  }
  final toolKey = _projectionToolDisplayKey(item);
  if (toolKey != null) {
    return '$scope:$toolKey';
  }
  return '$scope:${item.id}';
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
  if (!isRecordedUserPromptLiveEvent(_projectionLiveType(item))) {
    return false;
  }
  return item.text.trim().isNotEmpty &&
      !isThreadFollowUpActivityMessage(item.text);
}

bool _isAgentEchoTimelineItem(ThreadRunProjectionTimelineItem item) {
  if (_projectionLiveType(item) == 'todo.updated') return false;
  if (isSubagentMissionEnvelope(item.text)) return false;
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
  final subagentAgentIds = subagentCards.map((card) => card.agent.agentId).toSet();
  for (final card in subagentCards) {
    final parentToolUseId = card.agent.parentToolUseId?.trim();
    if (parentToolUseId != null && parentToolUseId.isNotEmpty) {
      absorbedToolUseIds.add(parentToolUseId);
    }
  }
  if (absorbedToolUseIds.isEmpty && subagentAgentIds.isEmpty) return timeline;

  return timeline.where((item) {
    final mission = parseSubagentMissionMessage(item.text);
    if (isSubagentMissionEnvelope(item.text)) {
      final missionAgentId = mission?.agentId?.trim();
      if (missionAgentId != null &&
          missionAgentId.isNotEmpty &&
          subagentAgentIds.contains(missionAgentId)) {
        return false;
      }
      final itemAgentId = item.agentId?.trim();
      if (itemAgentId != null &&
          itemAgentId.isNotEmpty &&
          subagentAgentIds.contains(itemAgentId)) {
        return false;
      }
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

    final streamKey = _projectionStreamDisplayKey(item, requestSpansById, timeline);
    if (streamKey != null) {
      final current = latestStreamDisplayByKey[streamKey];
      if (current == null || _compareTimelineItems(current, item) <= 0) {
        latestStreamDisplayByKey[streamKey] =
            _mergeStreamDisplayTimelineItem(current, item, timeline);
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
    final streamKey = _projectionStreamDisplayKey(item, requestSpansById, timeline);
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

bool _hasUserPromptBetween(
  List<ThreadRunProjectionTimelineItem> timeline,
  ThreadRunProjectionTimelineItem current,
  ThreadRunProjectionTimelineItem item,
) {
  final currentIndex = timeline.indexWhere((entry) => entry.id == current.id);
  final itemIndex = timeline.indexWhere((entry) => entry.id == item.id);
  if (currentIndex < 0 || itemIndex < 0 || itemIndex <= currentIndex) {
    return false;
  }
  for (var index = currentIndex + 1; index < itemIndex; index += 1) {
    final entry = timeline[index];
    if (_isProjectionUserPromptItem(entry)) {
      return true;
    }
  }
  return false;
}

bool _shouldResetThinkingStreamMerge(
  ThreadRunProjectionTimelineItem current,
  ThreadRunProjectionTimelineItem item,
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  final currentRequestId = current.requestId?.trim();
  final itemRequestId = item.requestId?.trim();
  if (currentRequestId != null &&
      currentRequestId.isNotEmpty &&
      itemRequestId != null &&
      itemRequestId.isNotEmpty &&
      currentRequestId != itemRequestId) {
    return true;
  }
  if (current.eventType == 'thinking.final') {
    return true;
  }
  return _hasUserPromptBetween(timeline, current, item);
}

ThreadRunProjectionTimelineItem _mergeStreamDisplayTimelineItem(
  ThreadRunProjectionTimelineItem? current,
  ThreadRunProjectionTimelineItem item,
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  if (current == null || _compareTimelineItems(current, item) > 0) {
    return item;
  }
  final isThinkingStream =
      item.eventType == 'thinking.delta' || item.eventType == 'thinking.final';
  if (!isThinkingStream) {
    return item;
  }
  if (_shouldResetThinkingStreamMerge(current, item, timeline)) {
    return item;
  }
  final preservedText = item.text.trim().isEmpty
      ? current.text
      : current.text.trim().isEmpty
      ? item.text
      : item.text.length >= current.text.length
      ? item.text
      : current.text;
  if (preservedText == item.text) {
    return item;
  }
  return ThreadRunProjectionTimelineItem(
    id: item.id,
    sequence: item.sequence,
    eventType: item.eventType,
    scope: item.scope,
    text: preservedText,
    at: item.at,
    role: item.role,
    agentId: item.agentId,
    requestId: item.requestId,
    streamKey: item.streamKey,
    metadata: item.metadata,
  );
}

int _resolveTurnBoundaryIndex(
  List<ThreadRunProjectionTimelineItem> timeline,
  int itemIndex,
) {
  for (var index = itemIndex - 1; index >= 0; index -= 1) {
    final entry = timeline[index];
    if (_isProjectionUserPromptItem(entry)) {
      return index;
    }
    if (entry.eventType == 'message.final' && entry.role == 'planner') {
      return index;
    }
    if (entry.eventType == 'thinking.final') {
      return index;
    }
  }
  return -1;
}

int _resolveTurnSegmentEndIndex(
  List<ThreadRunProjectionTimelineItem> timeline,
  int itemIndex,
) {
  for (var index = itemIndex + 1; index < timeline.length; index += 1) {
    final entry = timeline[index];
    if (_isProjectionUserPromptItem(entry)) {
      return index;
    }
  }
  return timeline.length;
}

String? _resolveNearestPlannerRequestId(
  ThreadRunProjectionTimelineItem item,
  List<ThreadRunProjectionTimelineItem> timeline,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final itemIndex = timeline.indexWhere((entry) => entry.id == item.id);
  if (itemIndex < 0) {
    return null;
  }
  final turnBoundaryIndex = _resolveTurnBoundaryIndex(timeline, itemIndex);
  final searchStart = turnBoundaryIndex >= 0 ? turnBoundaryIndex + 1 : 0;
  final searchEnd = _resolveTurnSegmentEndIndex(timeline, itemIndex);
  for (var index = itemIndex; index >= searchStart; index -= 1) {
    final entry = timeline[index];
    final requestId = entry.requestId?.trim();
    if (requestId == null || requestId.isEmpty) {
      continue;
    }
    if (entry.eventType == 'request.started' && entry.role == 'planner') {
      return requestId;
    }
    if (entry.role == 'planner' && requestSpansById.containsKey(requestId)) {
      return requestId;
    }
  }
  for (var index = itemIndex + 1; index < searchEnd; index += 1) {
    final entry = timeline[index];
    final requestId = entry.requestId?.trim();
    if (requestId == null || requestId.isEmpty) {
      continue;
    }
    if (entry.eventType == 'request.started' && entry.role == 'planner') {
      return requestId;
    }
    if (entry.role == 'planner' && requestSpansById.containsKey(requestId)) {
      return requestId;
    }
  }
  return null;
}

String? _resolveEffectiveStreamRequestId(
  ThreadRunProjectionTimelineItem item,
  List<ThreadRunProjectionTimelineItem> timeline,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
) {
  final isThinkingStream = item.role == 'thinking' ||
      item.eventType == 'thinking.delta' ||
      item.eventType == 'thinking.final';
  if (isThinkingStream) {
    final plannerRequestId =
        _resolveNearestPlannerRequestId(item, timeline, requestSpansById);
    if (plannerRequestId != null) {
      return plannerRequestId;
    }
    final itemIndex = timeline.indexWhere((entry) => entry.id == item.id);
    final turnBoundaryIndex =
        itemIndex >= 0 ? _resolveTurnBoundaryIndex(timeline, itemIndex) : -1;
    final boundaryItem =
        turnBoundaryIndex >= 0 ? timeline[turnBoundaryIndex] : null;
    final hasUserPromptInTurn =
        boundaryItem != null && _isProjectionUserPromptItem(boundaryItem);
    if (!hasUserPromptInTurn) {
      final itemRequestId = item.requestId?.trim();
      if (itemRequestId != null &&
          itemRequestId.isNotEmpty &&
          requestSpansById.containsKey(itemRequestId)) {
        return itemRequestId;
      }
    }
    return null;
  }
  final itemRequestId = item.requestId?.trim();
  return itemRequestId != null && itemRequestId.isNotEmpty ? itemRequestId : null;
}

String? _projectionOwnerKey(ThreadRunProjectionTimelineItem item) {
  final agentId = item.agentId?.trim();
  if (agentId != null && agentId.isNotEmpty) {
    return 'agent:$agentId';
  }
  final role = item.role?.trim();
  if (role != null && role.isNotEmpty) {
    return 'role:$role';
  }
  final scope = item.scope.trim();
  return scope.isNotEmpty ? 'scope:$scope' : null;
}

String _appendThinkingStreamScopeSuffix(
  String key,
  ThreadRunProjectionTimelineItem item,
  String? effectiveRequestId,
) {
  final isThinking =
      item.eventType == 'thinking.delta' || item.eventType == 'thinking.final';
  if (!isThinking) {
    return key;
  }
  final requestId = effectiveRequestId?.trim() ?? item.requestId?.trim();
  return requestId != null && requestId.isNotEmpty ? '$key:req:$requestId' : key;
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
    streamKey: item.streamKey,
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

bool _isProjectionBashApprovalItem(ThreadRunProjectionTimelineItem item) {
  if (readBashApprovalMetadata(item.metadata) != null) return true;
  final liveType = _projectionLiveType(item);
  return liveType != null && liveType.startsWith('bash_approval.');
}

bool _isMainTimelineNoiseItem(ThreadRunProjectionTimelineItem item) {
  if (_isProjectionUserPromptItem(item)) return true;
  if (_isProjectionBashApprovalItem(item)) return false;
  if (isLegacyBashApprovalActivityText(item.text) ||
      _isProjectionInternalMessageText(item.text) ||
      isThreadFollowUpActivityMessage(item.text)) {
    return true;
  }
  final liveType = _projectionLiveType(item);
  if (liveType != null && _isThreadFollowUpLiveEvent(liveType)) return true;
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
  required String feedId,
  String? agentRole,
}) {
  final text = item.text.trim();
  final reconnect = resolveReconnectPhaseDisplay(
    text: text,
    metadata: item.metadata,
    apiErrorStatusCode: _readProjectionApiError(item)?.statusCode,
  );
  if (reconnect != null) {
    return ActivityFeedEntry(
      id: feedId,
      kind: ActivityFeedKind.phase,
      text: reconnect.summary,
      detail: reconnect.detail,
      reconnecting: true,
    );
  }

  final bashApproval = readBashApprovalMetadata(item.metadata);
  if (bashApproval != null && item.scope != 'agent') {
    return _buildProjectionToolActionEntry(
      item,
      feedId: feedId,
      bashApproval: bashApproval,
    );
  }

  if (item.eventType == 'message.delta' || item.eventType == 'message.final') {
    if (text.isEmpty && item.eventType != 'message.delta') return null;
    if (isLegacyBashApprovalActivityText(text)) return null;
    if (parseClarificationAnswersSummary(text) != null) {
      return ActivityFeedEntry(
        id: feedId,
        kind: ActivityFeedKind.clarificationAnswer,
        text: item.text,
      );
    }
    return ActivityFeedEntry(
      id: feedId,
      kind: ActivityFeedKind.assistant,
      text: item.text,
      streaming: item.eventType == 'message.delta',
      subagentRole: agentRole ?? _resolveProjectionSubagentRole(item),
    );
  }

  if (item.eventType == 'thinking.delta' || item.eventType == 'thinking.final') {
    return ActivityFeedEntry(
      id: feedId,
      kind: ActivityFeedKind.thinking,
      text: item.text,
      streaming: item.eventType == 'thinking.delta',
    );
  }

  if (item.eventType == 'tool.started' ||
      item.eventType == 'tool.completed' ||
      item.eventType == 'tool.failed') {
    return _buildProjectionToolActionEntry(item, feedId: feedId);
  }

  if (item.eventType == 'api.error') {
    final apiError = _readProjectionApiError(item);
    return ActivityFeedEntry(
      id: feedId,
      kind: ActivityFeedKind.error,
      text: apiError?.message ?? text,
    );
  }

  final phaseLabel = _resolveProjectionPhaseLabel(item);
  if (phaseLabel != null) {
    return ActivityFeedEntry(
      id: feedId,
      kind: ActivityFeedKind.phase,
      text: phaseLabel,
    );
  }

  return null;
}

ActivityFeedEntry _buildProjectionToolActionEntry(
  ThreadRunProjectionTimelineItem item, {
  required String feedId,
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
  final fileChange = resolveFileChangeCardDisplay(tool?.fileChange);
  return ActivityFeedEntry(
    id: feedId,
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
    fileChange: fileChange,
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
  if (item.eventType == 'context.compaction.suspended') {
    return text.isEmpty ? '自动上下文压缩已暂停' : text;
  }
  if (item.eventType == 'context.cache_config_drift') {
    return text.isEmpty ? 'Composer 配置已变更' : text;
  }
  if (item.eventType == 'context.cache_invalidated') {
    return text.isEmpty ? '本会话 prompt cache 已失效' : text;
  }
  if (item.eventType == 'billing.cache_hit_dropped') {
    return text.isEmpty ? 'Prompt cache 命中率大幅下降' : text;
  }
  if (item.eventType == 'context.tool_output_truncated') {
    return text.isEmpty ? 'Tool 输出已截断' : text;
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
  const _ProjectionApiError({
    required this.message,
    this.statusCode,
    this.code,
  });

  final String message;
  final int? statusCode;
  final String? code;
}

_ProjectionApiError? _readProjectionApiError(ThreadRunProjectionTimelineItem item) {
  final raw = item.metadata?['apiError'];
  if (raw is! Map<String, dynamic>) return null;
  final message = (raw['message'] as String?)?.trim() ?? '';
  if (message.isEmpty) return null;
  final statusCode = raw['statusCode'];
  final code = (raw['code'] as String?)?.trim();
  return _ProjectionApiError(
    message: message,
    statusCode: statusCode is int ? statusCode : null,
    code: code != null && code.isNotEmpty ? code : null,
  );
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
  final origin = item.metadata?['activityOrigin'];
  if (origin is String && isReconnectActivityOrigin(origin)) {
    return 'reconnect';
  }
  final liveType = _projectionLiveType(item);
  if (liveType == 'request.retry_scheduled') {
    return 'reconnect';
  }
  return isReconnectActivityMessage(item.text.trim()) ? 'reconnect' : null;
}

String? _projectionStreamDisplayKey(
  ThreadRunProjectionTimelineItem item,
  Map<String, ThreadRunProjectionRequestSpan> requestSpansById,
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  if (!_isStreamingRequestDisplayItem(item)) return null;
  final channel = item.eventType.startsWith('thinking') ? 'thinking' : 'message';
  final requestId = _resolveEffectiveStreamRequestId(item, timeline, requestSpansById);
  if (requestId != null) {
    final span = requestSpansById[requestId];
    if (span != null && !_isProjectionRequestActive(span)) {
      return '$channel:request:$requestId';
    }
  }
  final streamKey = item.streamKey?.trim();
  if (streamKey != null && streamKey.isNotEmpty) {
    return _appendThinkingStreamScopeSuffix('${channel}:sk:$streamKey', item, requestId);
  }
  final ownerKey = _projectionOwnerKey(item);
  if (ownerKey != null) {
    return _appendThinkingStreamScopeSuffix('$channel:$ownerKey', item, requestId);
  }
  return '$channel:${item.id}';
}

bool _isStreamingRequestDisplayItem(ThreadRunProjectionTimelineItem item) {
  if (_projectionLiveType(item) == 'todo.updated') return false;
  if (_isProjectionBashApprovalItem(item)) return false;
  return item.eventType == 'message.delta' ||
      item.eventType == 'message.final' ||
      item.eventType == 'thinking.delta' ||
      item.eventType == 'thinking.final';
}

ToolActionLifecycle? _resolveProjectionToolLifecycle(
  ThreadRunProjectionTimelineItem item,
) {
  final bashApproval = readBashApprovalMetadata(item.metadata);
  if (bashApproval != null) {
    return bashApprovalPhaseToLifecycle(bashApproval.phase);
  }
  final tool = readProjectionToolMetadata(item.metadata);
  if (tool != null) {
    if (item.eventType == 'tool.failed') return ToolActionLifecycle.failed;
    return toolLifecycleFromMetadata(tool);
  }
  return null;
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
  if (tool?.fileChange != null) score += 32;
  if (item.eventType == 'tool.completed') score += 16;
  return score;
}

int _compareProjectionLifecycleDisplayItems(
  ThreadRunProjectionTimelineItem left,
  ThreadRunProjectionTimelineItem right,
) {
  final leftLifecycle = _resolveProjectionToolLifecycle(left);
  final rightLifecycle = _resolveProjectionToolLifecycle(right);
  if (leftLifecycle != null &&
      rightLifecycle != null &&
      leftLifecycle != rightLifecycle) {
    return compareToolActionLifecyclePriority(leftLifecycle, rightLifecycle);
  }
  final richness =
      _projectionToolDisplayRichness(left) - _projectionToolDisplayRichness(right);
  if (richness != 0) return richness;
  return _compareTimelineItems(left, right);
}
