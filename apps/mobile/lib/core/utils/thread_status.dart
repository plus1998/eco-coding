import 'package:flutter/material.dart';

import '../models/thread_models.dart';
import '../theme/eco_theme.dart';

// Historical Desktop event prefix used to extract the raw failure detail.
const planExecutionFailurePrefix = '执行失败，已回退更改。';

bool isThreadWaitingForApproval(ThreadSummary thread) {
  return thread.status == 'awaiting_plan';
}

bool shouldUpdateThreadSummaryFromLiveEvent(String eventType) {
  const excluded = {
    'thread.context_updated',
    'thread.usage_updated',
    'thread.todos_updated',
    'thread.title_updated',
    'thread.title_generating',
    'thread.runtime_config_updated',
    'thread.session_captured',
    'thread.run_projection_updated',
    'thread.subagent_timing_updated',
  };
  if (excluded.contains(eventType)) {
    return false;
  }
  return eventType.startsWith('thread.');
}

String threadStatusFromLiveEvent(String eventType, String fallback) {
  switch (eventType) {
    case 'thread.completed':
      return 'completed';
    case 'thread.failed':
    case 'thread.unstarted_turn_discarded':
      return 'failed';
    case 'thread.blocked':
      return 'blocked';
    case 'thread.awaiting_plan':
    case 'thread.execution_failed':
      return 'awaiting_plan';
    case 'thread.idle':
    case 'thread.stopped':
    case 'thread.execution_done':
      return 'idle';
    case 'thread.running':
    case 'thread.started':
    case 'thread.queued':
    case 'thread.retry':
      return 'running';
    default:
      return fallback;
  }
}

String resolveThreadMessageFromLiveEvent(
  String eventType,
  String eventMessage,
) {
  if (eventType == 'thread.execution_failed') {
    final detail = eventMessage.trim();
    return detail.isEmpty
        ? planExecutionFailurePrefix
        : '$planExecutionFailurePrefix$detail';
  }
  if (eventType == 'thread.failed' ||
      eventType == 'thread.blocked' ||
      eventType == 'thread.unstarted_turn_discarded') {
    return eventMessage;
  }
  if (eventMessage.startsWith(planExecutionFailurePrefix)) {
    return eventMessage;
  }
  return '';
}

bool resolveThreadCancellingFromLiveEvent({
  required String nextStatus,
  required bool currentCancelling,
  bool? eventCancelling,
}) {
  if (nextStatus != 'running' && nextStatus != 'queued') {
    return false;
  }
  if (eventCancelling == true) {
    return true;
  }
  if (eventCancelling == false) {
    return false;
  }
  return currentCancelling;
}

String? extractPlanFailureMessage(String threadMessage) {
  if (!threadMessage.startsWith(planExecutionFailurePrefix)) {
    return null;
  }
  final detail = threadMessage
      .substring(planExecutionFailurePrefix.length)
      .trim();
  return detail.isEmpty ? null : detail;
}

bool isThreadBusy(ThreadSummary thread) {
  return thread.status == 'running' || thread.status == 'queued';
}

bool hasThreadStatusIndicator(ThreadSummary thread) {
  return isThreadWaitingForApproval(thread) ||
      isThreadBusy(thread) ||
      thread.status == 'failed' ||
      thread.status == 'blocked';
}

Color threadStatusDotColor(String status, EcoColors colors) {
  switch (status) {
    case 'running':
      return colors.statusRunning;
    case 'completed':
      return colors.statusCompleted;
    case 'failed':
    case 'blocked':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

String threadStatusTime(ThreadSummary thread) {
  final iso = thread.updatedAt.isNotEmpty ? thread.updatedAt : thread.createdAt;
  return iso;
}
