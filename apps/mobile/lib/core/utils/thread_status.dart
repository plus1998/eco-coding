import 'package:flutter/material.dart';

import '../models/thread_models.dart';
import '../theme/eco_theme.dart';

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
    case 'thread.auto_retry':
      return 'running';
    default:
      return fallback;
  }
}

String resolveThreadMessageFromLiveEvent(String eventType, String eventMessage) {
  if (eventType == 'thread.execution_failed') {
    final detail = eventMessage.trim();
    return detail.isEmpty
        ? planExecutionFailurePrefix
        : '$planExecutionFailurePrefix$detail';
  }
  return eventMessage;
}

String? extractPlanFailureMessage(String threadMessage) {
  if (!threadMessage.startsWith(planExecutionFailurePrefix)) {
    return null;
  }
  final detail = threadMessage.substring(planExecutionFailurePrefix.length).trim();
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

Color threadStatusDotColor(String status) {
  switch (status) {
    case 'running':
      return const Color(0xFF4ADE80);
    case 'completed':
      return const Color(0xFF60A5FA);
    case 'failed':
    case 'blocked':
      return EcoColors.danger;
    default:
      return EcoColors.textMuted;
  }
}

String threadStatusTime(ThreadSummary thread) {
  final iso = thread.updatedAt.isNotEmpty ? thread.updatedAt : thread.createdAt;
  return iso;
}
