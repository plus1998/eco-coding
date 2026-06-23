import 'package:flutter/material.dart';

import '../models/thread_models.dart';
import '../models/thread_usage_models.dart';
import '../theme/subagent_theme.dart';
import 'model_id.dart';

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
      return 'Main Agent';
    case 'coder':
      return '编码';
    case 'reviewer':
      return '审查';
    case 'tester':
      return '测试';
    case 'explore':
      return '探索';
    case 'architect':
      return '架构';
    default:
      return role;
  }
}

String formatRoleModelLabel(String role, String? modelId) {
  final base = roleDisplayLabel(role);
  final model = modelId?.trim();
  if (model == null || model.isEmpty) {
    return base;
  }
  return '$base · ${shortenModelId(model)}';
}

String shortAgentId(String agentId) {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.substring(0, 8);
}

const _subagentRoleShort = <String, String>{
  'explore': '探索',
  'architect': '架构',
  'coder': '编码',
  'reviewer': '审查',
  'tester': '测试',
};

class FlatSubagentContextRow {
  const FlatSubagentContextRow({
    required this.key,
    required this.role,
    required this.title,
    required this.snapshot,
    this.accentColor,
  });

  final String key;
  final String role;
  final String title;
  final ThreadRoleContextSnapshot snapshot;
  final Color? accentColor;
}

List<FlatSubagentContextRow> buildFlatSubagentContextRows(
  ThreadContextSnapshot context, {
  OrchestrationProfile? profile,
}) {
  final subagentRoles = context.roles
      .where((role) => role.role != 'planner')
      .toList();

  final instances = [...context.instances]
      .where((instance) => instance.role != 'planner' && instance.occupied > 0)
      .toList()
    ..sort((left, right) => right.occupied.compareTo(left.occupied));

  if (instances.isNotEmpty) {
    return instances.map((instance) {
      final roleLabel =
          _subagentRoleShort[instance.role] ?? instance.role;
      return FlatSubagentContextRow(
        key: instance.agentId,
        role: instance.role,
        title: '$roleLabel #${shortAgentId(instance.agentId)}',
        accentColor: resolveSubagentThemeColor(instance.role, profile: profile),
        snapshot: ThreadRoleContextSnapshot(
          role: instance.role,
          occupied: instance.occupied,
          limit: instance.limit,
          occupancyPct: instance.occupancyPct,
          limitsResolved: instance.limitsResolved,
          modelId: instance.modelId,
          segments: instance.segments,
        ),
      );
    }).toList();
  }

  return subagentRoles.map((role) {
    return FlatSubagentContextRow(
      key: role.role,
      role: role.role,
      title: formatRoleModelLabel(role.role, role.modelId),
      accentColor: resolveSubagentThemeColor(role.role, profile: profile),
      snapshot: role,
    );
  }).toList();
}

String formatBillingModelLabel(ThreadBillingModelSnapshot entry) {
  return shortenModelId(entry.modelId);
}
