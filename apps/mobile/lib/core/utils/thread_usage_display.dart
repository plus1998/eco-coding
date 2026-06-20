import '../models/thread_usage_models.dart';

String formatCostUsd(double value) {
  if (value <= 0) {
    return '\$0';
  }
  if (value < 0.01) {
    return '\$${value.toStringAsFixed(4)}';
  }
  if (value < 1) {
    return '\$${value.toStringAsFixed(3)}';
  }
  return '\$${value.toStringAsFixed(2)}';
}

String formatBillingPillCost(ThreadBillingSnapshot? billing) {
  return formatCostUsd(billing?.ecoCostUsd ?? 0);
}

String formatSavingsLine(double savedUsd, double savedPct) {
  if (savedUsd <= 0) {
    return '暂无节省';
  }
  final pct = savedPct > 0 ? ' ${savedPct.toStringAsFixed(0)}%' : '';
  return '节省 ${formatCostUsd(savedUsd)}$pct';
}

String formatContextK(int value) {
  if (value < 1000) {
    return value.toString();
  }
  if (value < 1000000) {
    final rounded = value / 1000;
    return rounded >= 100 ? '${rounded.round()}K' : '${rounded.toStringAsFixed(1)}K';
  }
  return '${(value / 1000000).toStringAsFixed(1)}M';
}

String formatOccupancyLabel(int pct) {
  if (pct >= 100) {
    return '100% 已满';
  }
  if (pct >= 95) {
    return '$pct% 接近上限';
  }
  if (pct >= 85) {
    return '$pct% 即将触顶';
  }
  return '$pct% 已用';
}

int? resolvePlannerOccupancyPct(ThreadContextSnapshot? context) {
  if (context == null) {
    return null;
  }
  for (final role in context.roles) {
    if (role.role == 'planner') {
      return role.occupancyPct;
    }
  }
  return context.occupancyPct;
}

ThreadRoleContextSnapshot resolvePlannerContext(ThreadContextSnapshot context) {
  for (final role in context.roles) {
    if (role.role == 'planner') {
      return role;
    }
  }
  return ThreadRoleContextSnapshot(
    role: context.displayRole ?? 'planner',
    occupied: context.occupied,
    limit: context.limit,
    occupancyPct: context.occupancyPct,
    limitsResolved: context.limitsResolved,
    modelId: context.modelId,
    segments: context.segments,
  );
}

String billingEmptyHint(String? status) {
  if (status == 'running' || status == 'queued') {
    return '费用累计中…';
  }
  if (status == 'awaiting_plan') {
    return '计划阶段已产生的 token 与费用将显示在此处。';
  }
  if (status != null &&
      status != 'idle' &&
      status != 'completed' &&
      status != 'failed' &&
      status != 'blocked') {
    return '暂无累计 token 或费用记录。';
  }
  return '费用 — 有模型请求后显示';
}

String contextCardPlaceholder(String? status) {
  if (status == 'running' || status == 'queued') {
    return '用量随每轮模型响应更新';
  }
  if (status == 'awaiting_plan') {
    return '计划阶段用量将随模型响应更新';
  }
  if (status == 'completed' ||
      status == 'idle' ||
      status == 'failed' ||
      status == 'blocked') {
    return '暂无上下文数据';
  }
  return '上下文 — 有模型请求后显示';
}

String roleDisplayLabel(String role) {
  switch (role) {
    case 'planner':
      return 'Planner';
    case 'coder':
      return 'Coder';
    case 'reviewer':
      return 'Reviewer';
    case 'tester':
      return 'Tester';
    case 'explore':
      return 'Explore';
    case 'architect':
      return 'Architect';
    default:
      return role;
  }
}
