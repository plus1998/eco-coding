import '../models/thread_models.dart';

bool isFollowUpThreadLiveEvent({
  required String kind,
  required String liveType,
  bool hasFollowUp = false,
}) {
  return kind == 'thread.follow_up' ||
      liveType.startsWith('thread.follow_up.') ||
      hasFollowUp;
}

String? resolveThreadEventThreadId({
  String? envelopeThreadId,
  String? payloadThreadId,
}) {
  final envelope = envelopeThreadId?.trim();
  if (envelope != null && envelope.isNotEmpty) {
    return envelope;
  }
  final payload = payloadThreadId?.trim();
  if (payload != null && payload.isNotEmpty) {
    return payload;
  }
  return null;
}

bool isLiveFollowUpThreadStatus(String? status) {
  return status == 'running' || status == 'queued';
}

List<ThreadPendingFollowUp> sortThreadFollowUps(
  List<ThreadPendingFollowUp> followUps,
) {
  final sorted = [...followUps];
  sorted.sort(_compareThreadFollowUps);
  return sorted;
}

List<ThreadPendingFollowUp> queuedThreadFollowUps(
  List<ThreadPendingFollowUp> followUps,
) {
  return sortThreadFollowUps(followUps)
      .where((followUp) => followUp.status == 'queued')
      .toList();
}

List<ThreadPendingFollowUp> mergeThreadFollowUp(
  List<ThreadPendingFollowUp> current,
  ThreadPendingFollowUp followUp,
) {
  final next = current.where((item) => item.id != followUp.id).toList();
  next.add(followUp);
  return sortThreadFollowUps(next);
}

String formatThreadFollowUpPreview(ThreadPendingFollowUp followUp) {
  final prompt = followUp.prompt.trim();
  if (prompt.length > 120) {
    return '${prompt.substring(0, 117)}...';
  }
  return prompt.isEmpty ? '空引导消息' : prompt;
}

int _compareThreadFollowUps(
  ThreadPendingFollowUp left,
  ThreadPendingFollowUp right,
) {
  final priorityDelta = _priorityRank(left) - _priorityRank(right);
  if (priorityDelta != 0) {
    return priorityDelta;
  }
  final createdDelta = left.createdAt.compareTo(right.createdAt);
  if (createdDelta != 0) {
    return createdDelta;
  }
  return left.id.compareTo(right.id);
}

int _priorityRank(ThreadPendingFollowUp followUp) {
  return followUp.priority == 'escalated' ? 0 : 1;
}
