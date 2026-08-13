import '../models/thread_run_projection.dart';

/// OpenAI/Codex reasoning summary stamp (`summary` | `raw`).
String? readReasoningDisplay(Map<String, dynamic>? metadata) {
  final value = metadata?['reasoningDisplay'];
  return value == 'summary' || value == 'raw' ? value as String : null;
}

bool isEmptyTerminalThinkingItem(ThreadRunProjectionTimelineItem item) {
  return item.eventType == 'thinking.final' && item.text.trim().isEmpty;
}

bool hasReasoningSummaryStamp(ThreadRunProjectionTimelineItem item) {
  if (item.eventType != 'thinking.delta' &&
      item.eventType != 'thinking.final') {
    return false;
  }
  if (readReasoningDisplay(item.metadata) == 'summary') {
    return true;
  }
  return item.metadata?['codexMethod'] == 'item/reasoning/summaryTextDelta';
}

/// OpenAI/Codex reasoning summary (not Claude raw thinking / raw CoT).
bool isReasoningSummaryItem(ThreadRunProjectionTimelineItem item) {
  if (item.text.trim().isEmpty) {
    return false;
  }
  return hasReasoningSummaryStamp(item);
}

/// Events that replace the ephemeral reasoning-summary status line
/// (tools, assistant speech, true thinking, …).
bool isReasoningSummarySupersedingItem(ThreadRunProjectionTimelineItem item) {
  if (isReasoningSummaryItem(item) || isEmptyTerminalThinkingItem(item)) {
    return false;
  }
  if (item.eventType.startsWith('tool.')) {
    return true;
  }
  if (item.eventType == 'message.delta' || item.eventType == 'message.final') {
    return item.text.trim().isNotEmpty;
  }
  if (item.eventType == 'thinking.delta' ||
      item.eventType == 'thinking.final') {
    return item.text.trim().isNotEmpty;
  }
  if (item.eventType == 'thread.status' ||
      item.eventType == 'api.error' ||
      item.eventType == 'tool.failed') {
    return true;
  }
  return false;
}

/// Reasoning summary is a single replaceable tip status:
/// - later summary replaces earlier ones
/// - tools / messages / raw thinking after it clear the tip
/// - may be delta or final (final still shows until superseded)
List<ThreadRunProjectionTimelineItem> collapseEphemeralReasoningSummaryTimeline(
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  var lastSupersedingIndex = -1;
  for (var index = 0; index < timeline.length; index += 1) {
    if (isReasoningSummarySupersedingItem(timeline[index])) {
      lastSupersedingIndex = index;
    }
  }
  var tipSummaryIndex = -1;
  for (
    var index = lastSupersedingIndex + 1;
    index < timeline.length;
    index += 1
  ) {
    if (isReasoningSummaryItem(timeline[index])) {
      tipSummaryIndex = index;
    }
  }
  return [
    for (var index = 0; index < timeline.length; index += 1)
      if (!isReasoningSummaryItem(timeline[index]) || index == tipSummaryIndex)
        timeline[index],
  ];
}
