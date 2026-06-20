class ContextBreakdownSegment {
  const ContextBreakdownSegment({
    required this.key,
    required this.label,
    required this.tokens,
    this.color,
  });

  factory ContextBreakdownSegment.fromJson(Map<String, dynamic> json) =>
      ContextBreakdownSegment(
        key: json['key'] as String? ?? '',
        label: json['label'] as String? ?? '',
        tokens: (json['tokens'] as num?)?.toInt() ?? 0,
        color: json['color'] as String?,
      );

  final String key;
  final String label;
  final int tokens;
  final String? color;
}

class ThreadRoleContextSnapshot {
  const ThreadRoleContextSnapshot({
    required this.role,
    required this.occupied,
    required this.limit,
    required this.occupancyPct,
    required this.limitsResolved,
    this.modelId,
    this.segments = const [],
  });

  factory ThreadRoleContextSnapshot.fromJson(Map<String, dynamic> json) =>
      ThreadRoleContextSnapshot(
        role: json['role'] as String? ?? 'planner',
        occupied: (json['occupied'] as num?)?.toInt() ?? 0,
        limit: (json['limit'] as num?)?.toInt() ?? 0,
        occupancyPct: (json['occupancyPct'] as num?)?.toInt() ?? 0,
        limitsResolved: json['limitsResolved'] as bool? ?? false,
        modelId: json['modelId'] as String?,
        segments: (json['segments'] as List<dynamic>? ?? [])
            .map(
              (entry) => ContextBreakdownSegment.fromJson(
                entry as Map<String, dynamic>,
              ),
            )
            .toList(),
      );

  final String role;
  final int occupied;
  final int limit;
  final int occupancyPct;
  final bool limitsResolved;
  final String? modelId;
  final List<ContextBreakdownSegment> segments;
}

class ThreadContextSnapshot {
  const ThreadContextSnapshot({
    required this.occupied,
    required this.limit,
    required this.occupancyPct,
    required this.limitsResolved,
    this.displayRole,
    this.modelId,
    this.segments = const [],
    this.roles = const [],
  });

  factory ThreadContextSnapshot.fromJson(Map<String, dynamic> json) =>
      ThreadContextSnapshot(
        occupied: (json['occupied'] as num?)?.toInt() ?? 0,
        limit: (json['limit'] as num?)?.toInt() ?? 0,
        occupancyPct: (json['occupancyPct'] as num?)?.toInt() ?? 0,
        limitsResolved: json['limitsResolved'] as bool? ?? false,
        displayRole: json['displayRole'] as String?,
        modelId: json['modelId'] as String?,
        segments: (json['segments'] as List<dynamic>? ?? [])
            .map(
              (entry) => ContextBreakdownSegment.fromJson(
                entry as Map<String, dynamic>,
              ),
            )
            .toList(),
        roles: (json['roles'] as List<dynamic>? ?? [])
            .map(
              (entry) => ThreadRoleContextSnapshot.fromJson(
                entry as Map<String, dynamic>,
              ),
            )
            .toList(),
      );

  final int occupied;
  final int limit;
  final int occupancyPct;
  final bool limitsResolved;
  final String? displayRole;
  final String? modelId;
  final List<ContextBreakdownSegment> segments;
  final List<ThreadRoleContextSnapshot> roles;
}

class ThreadBillingSnapshot {
  const ThreadBillingSnapshot({
    required this.plannerTokenCostUsd,
    required this.ecoCostUsd,
    required this.savedUsd,
    required this.savedPct,
    required this.pricingResolved,
    this.plannerModelLabel,
    this.inputTokens = 0,
    this.outputTokens = 0,
    this.cacheReadTokens = 0,
    this.cacheCreationTokens = 0,
  });

  factory ThreadBillingSnapshot.fromJson(Map<String, dynamic> json) {
    final totals = json['totalTokens'] as Map<String, dynamic>? ?? {};
    return ThreadBillingSnapshot(
      plannerTokenCostUsd:
          (json['plannerTokenCostUsd'] as num?)?.toDouble() ?? 0,
      ecoCostUsd: (json['ecoCostUsd'] as num?)?.toDouble() ?? 0,
      savedUsd: (json['savedUsd'] as num?)?.toDouble() ?? 0,
      savedPct: (json['savedPct'] as num?)?.toDouble() ?? 0,
      pricingResolved: json['pricingResolved'] as bool? ?? false,
      plannerModelLabel: json['plannerModelLabel'] as String?,
      inputTokens: (totals['input'] as num?)?.toInt() ?? 0,
      outputTokens: (totals['output'] as num?)?.toInt() ?? 0,
      cacheReadTokens: (totals['cacheRead'] as num?)?.toInt() ?? 0,
      cacheCreationTokens: (totals['cacheCreation'] as num?)?.toInt() ?? 0,
    );
  }

  final double plannerTokenCostUsd;
  final double ecoCostUsd;
  final double savedUsd;
  final double savedPct;
  final bool pricingResolved;
  final String? plannerModelLabel;
  final int inputTokens;
  final int outputTokens;
  final int cacheReadTokens;
  final int cacheCreationTokens;
}

class ThreadUsageSnapshotResult {
  const ThreadUsageSnapshotResult({
    this.billing,
    this.context,
  });

  factory ThreadUsageSnapshotResult.fromJson(Map<String, dynamic> json) =>
      ThreadUsageSnapshotResult(
        billing: json['billing'] is Map<String, dynamic>
            ? ThreadBillingSnapshot.fromJson(
                json['billing'] as Map<String, dynamic>,
              )
            : null,
        context: json['context'] is Map<String, dynamic>
            ? ThreadContextSnapshot.fromJson(
                json['context'] as Map<String, dynamic>,
              )
            : null,
      );

  final ThreadBillingSnapshot? billing;
  final ThreadContextSnapshot? context;
}
