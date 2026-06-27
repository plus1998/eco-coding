class ThreadSubagentSessionTiming {
  const ThreadSubagentSessionTiming({
    required this.agentId,
    required this.role,
    required this.status,
    required this.startedAt,
    required this.lastActiveAt,
    required this.accumulatedMs,
    required this.durationMs,
    this.endedAt,
  });

  factory ThreadSubagentSessionTiming.fromJson(Map<String, dynamic> json) =>
      ThreadSubagentSessionTiming(
        agentId: json['agentId'] as String? ?? '',
        role: json['role'] as String? ?? '',
        status: json['status'] as String? ?? 'stopped',
        startedAt: json['startedAt'] as String? ?? '',
        lastActiveAt: json['lastActiveAt'] as String? ?? '',
        endedAt: json['endedAt'] as String?,
        accumulatedMs: (json['accumulatedMs'] as num?)?.toInt() ?? 0,
        durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
      );

  final String agentId;
  final String role;
  final String status;
  final String startedAt;
  final String lastActiveAt;
  final String? endedAt;
  final int accumulatedMs;
  final int durationMs;

  bool get isActive => status == 'active';
}

class ThreadRunProjectionTimelineItem {
  const ThreadRunProjectionTimelineItem({
    required this.id,
    required this.sequence,
    required this.eventType,
    required this.scope,
    required this.text,
    required this.at,
    this.role,
    this.agentId,
    this.requestId,
    this.streamKey,
    this.metadata,
  });

  factory ThreadRunProjectionTimelineItem.fromJson(Map<String, dynamic> json) =>
      ThreadRunProjectionTimelineItem(
        id: json['id'] as String? ?? '',
        sequence: (json['sequence'] as num?)?.toInt() ?? 0,
        eventType: json['eventType'] as String? ?? '',
        scope: json['scope'] as String? ?? '',
        text: json['text'] as String? ?? '',
        at: json['at'] as String? ?? '',
        role: json['role'] as String?,
        agentId: json['agentId'] as String?,
        requestId: json['requestId'] as String?,
        streamKey: json['streamKey'] as String?,
        metadata: json['metadata'] is Map<String, dynamic>
            ? json['metadata'] as Map<String, dynamic>
            : null,
      );

  final String id;
  final int sequence;
  final String eventType;
  final String scope;
  final String text;
  final String at;
  final String? role;
  final String? agentId;
  final String? requestId;
  final String? streamKey;
  final Map<String, dynamic>? metadata;
}

class ThreadRunProjectionAgent {
  const ThreadRunProjectionAgent({
    required this.agentId,
    required this.role,
    required this.kind,
    required this.status,
    required this.startedAt,
    required this.durationMs,
    required this.timeline,
    this.delegationSummary,
    this.delegationPrompt,
    this.parentToolUseId,
    this.latestActivity,
    this.endedAt,
  });

  factory ThreadRunProjectionAgent.fromJson(Map<String, dynamic> json) {
    final timelineRaw = json['timeline'] as List<dynamic>? ?? const [];
    return ThreadRunProjectionAgent(
      agentId: json['agentId'] as String? ?? '',
      role: json['role'] as String? ?? '',
      kind: json['kind'] as String? ?? 'subagent',
      status: json['status'] as String? ?? 'stopped',
      startedAt: json['startedAt'] as String? ?? '',
      durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
      delegationSummary: json['delegationSummary'] as String?,
      delegationPrompt: json['delegationPrompt'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
      latestActivity: json['latestActivity'] as String?,
      endedAt: json['endedAt'] as String?,
      timeline: timelineRaw
          .map(
            (entry) => ThreadRunProjectionTimelineItem.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(),
    );
  }

  final String agentId;
  final String role;
  final String kind;
  final String status;
  final String startedAt;
  final int durationMs;
  final String? delegationSummary;
  final String? delegationPrompt;
  final String? parentToolUseId;
  final String? latestActivity;
  final String? endedAt;
  final List<ThreadRunProjectionTimelineItem> timeline;

  bool get isRunning => status == 'active' || status == 'launching';
}

class ThreadRunProjectionRequestSpan {
  const ThreadRunProjectionRequestSpan({
    required this.requestId,
    required this.status,
    required this.startedAt,
    this.ownerAgentId,
    this.role,
    this.firstTokenAt,
    this.endedAt,
  });

  factory ThreadRunProjectionRequestSpan.fromJson(Map<String, dynamic> json) =>
      ThreadRunProjectionRequestSpan(
        requestId: json['requestId'] as String? ?? '',
        status: json['status'] as String? ?? '',
        startedAt: json['startedAt'] as String? ?? '',
        ownerAgentId: json['ownerAgentId'] as String?,
        role: json['role'] as String?,
        firstTokenAt: json['firstTokenAt'] as String?,
        endedAt: json['endedAt'] as String?,
      );

  final String requestId;
  final String status;
  final String startedAt;
  final String? ownerAgentId;
  final String? role;
  final String? firstTokenAt;
  final String? endedAt;
}

class ThreadRunProjectionSnapshot {
  const ThreadRunProjectionSnapshot({
    required this.threadId,
    required this.status,
    required this.generatedAt,
    required this.agents,
    required this.sourceEventCount,
    this.timeline = const [],
    this.requestSpans = const [],
  });

  factory ThreadRunProjectionSnapshot.fromJson(Map<String, dynamic> json) {
    final thread = json['thread'] as Map<String, dynamic>? ?? const {};
    final agentsRaw = json['agents'] as List<dynamic>? ?? const [];
    final timelineRaw = json['timeline'] as List<dynamic>? ?? const [];
    final requestSpansRaw = json['requestSpans'] as List<dynamic>? ?? const [];
    return ThreadRunProjectionSnapshot(
      threadId: thread['threadId'] as String? ?? '',
      status: thread['status'] as String? ?? '',
      generatedAt: thread['generatedAt'] as String? ?? '',
      sourceEventCount: (json['sourceEventCount'] as num?)?.toInt() ?? 0,
      agents: agentsRaw
          .map(
            (entry) => ThreadRunProjectionAgent.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(),
      timeline: timelineRaw
          .map(
            (entry) => ThreadRunProjectionTimelineItem.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(),
      requestSpans: requestSpansRaw
          .map(
            (entry) => ThreadRunProjectionRequestSpan.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(),
    );
  }

  final String threadId;
  final String status;
  final String generatedAt;
  final int sourceEventCount;
  final List<ThreadRunProjectionAgent> agents;
  final List<ThreadRunProjectionTimelineItem> timeline;
  final List<ThreadRunProjectionRequestSpan> requestSpans;

  bool get hasData => sourceEventCount > 0;
}
