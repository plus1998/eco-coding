import 'package:flutter/material.dart';

import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_usage_display.dart';
import '../composer/composer_context_ring.dart';

Future<void> showThreadBillingSheet({
  required BuildContext context,
  required ThreadBillingSnapshot? billing,
  required String? threadStatus,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: EcoColors.bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.35,
      maxChildSize: 0.85,
      builder: (context, scrollController) => _BillingSheet(
        billing: billing,
        threadStatus: threadStatus,
        scrollController: scrollController,
      ),
    ),
  );
}

Future<void> showThreadContextSheet({
  required BuildContext context,
  required ThreadContextSnapshot? contextSnapshot,
  required String? threadStatus,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: EcoColors.bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 0.9,
      builder: (context, scrollController) => _ContextSheet(
        contextSnapshot: contextSnapshot,
        threadStatus: threadStatus,
        scrollController: scrollController,
      ),
    ),
  );
}

class ThreadUsageFloatButtons extends StatelessWidget {
  const ThreadUsageFloatButtons({
    super.key,
    required this.billing,
    required this.contextSnapshot,
    required this.threadStatus,
  });

  final ThreadBillingSnapshot? billing;
  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;

  @override
  Widget build(BuildContext context) {
    final occupancyPct = resolvePlannerOccupancyPct(contextSnapshot);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        _ThreadInfoFloatPill(
          icon: Icons.payments_outlined,
          label: '计费',
          trailing: formatBillingPillCost(billing),
          trailingColor: (billing?.ecoCostUsd ?? 0) > 0
              ? EcoColors.success
              : ecoThemeExtras(context).textSecondary,
          onTap: () => showThreadBillingSheet(
            context: context,
            billing: billing,
            threadStatus: threadStatus,
          ),
        ),
        const SizedBox(height: 8),
        _ThreadInfoFloatPill(
          icon: Icons.memory_outlined,
          label: '上下文',
          trailing: occupancyPct != null ? '$occupancyPct%' : null,
          trailingColor: _contextPctColor(occupancyPct),
          leadingWidget: occupancyPct != null
              ? ComposerContextRing(pct: occupancyPct)
              : null,
          onTap: () => showThreadContextSheet(
            context: context,
            contextSnapshot: contextSnapshot,
            threadStatus: threadStatus,
          ),
        ),
      ],
    );
  }

  Color _contextPctColor(int? pct) {
    if (pct == null) {
      return EcoColors.textSecondary;
    }
    if (pct >= 95) {
      return EcoColors.danger;
    }
    if (pct >= 85) {
      return const Color(0xFFFBBF24);
    }
    return EcoColors.accentText;
  }
}

class _ThreadInfoFloatPill extends StatelessWidget {
  const _ThreadInfoFloatPill({
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.trailingColor,
    this.leadingWidget,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String? trailing;
  final Color? trailingColor;
  final Widget? leadingWidget;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Material(
      color: EcoColors.bgElevated,
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: eco.borderSubtle),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              leadingWidget ??
                  Icon(icon, size: 15, color: eco.textSecondary),
              const SizedBox(width: 6),
              Text(
                label,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: EcoColors.textHeading,
                    ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 6),
                Text(
                  trailing!,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: trailingColor ?? eco.textSecondary,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BillingSheet extends StatelessWidget {
  const _BillingSheet({
    required this.billing,
    required this.threadStatus,
    required this.scrollController,
  });

  final ThreadBillingSnapshot? billing;
  final String? threadStatus;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final plannerLabel = billing?.plannerModelLabel?.trim().isNotEmpty == true
        ? billing!.plannerModelLabel!
        : '主模型';
    return SafeArea(
      child: ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: eco.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.payments_outlined, size: 18),
              const SizedBox(width: 8),
              Text('计费', style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 16),
          if (billing == null)
            Text(
              billingEmptyHint(threadStatus),
              style: TextStyle(color: eco.textMuted),
            )
          else ...[
            _MetricRow(
              label: '① 未编排',
              subtitle: '按 $plannerLabel 单价估算',
              value: formatCostUsd(billing!.plannerTokenCostUsd),
            ),
            const SizedBox(height: 12),
            _MetricRow(
              label: '② 经济编程',
              subtitle: 'Eco 编排后的实际费用',
              value: formatCostUsd(billing!.ecoCostUsd),
              emphasized: true,
            ),
            const SizedBox(height: 12),
            _MetricRow(
              label: '节省',
              value: formatSavingsLine(billing!.savedUsd, billing!.savedPct),
              valueColor: billing!.savedUsd >= 0
                  ? EcoColors.success
                  : EcoColors.danger,
            ),
            const SizedBox(height: 20),
            Text('Token 用量', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            _MetricRow(label: '输入', value: '${billing!.inputTokens}'),
            _MetricRow(label: '输出', value: '${billing!.outputTokens}'),
            if (billing!.cacheReadTokens > 0)
              _MetricRow(label: '缓存读取', value: '${billing!.cacheReadTokens}'),
            if (billing!.cacheCreationTokens > 0)
              _MetricRow(
                label: '缓存写入',
                value: '${billing!.cacheCreationTokens}',
              ),
          ],
        ],
      ),
    );
  }
}

class _ContextSheet extends StatelessWidget {
  const _ContextSheet({
    required this.contextSnapshot,
    required this.threadStatus,
    required this.scrollController,
  });

  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return SafeArea(
      child: ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: eco.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.memory_outlined, size: 18),
              const SizedBox(width: 8),
              Text('上下文', style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 16),
          if (contextSnapshot == null)
            Text(
              contextCardPlaceholder(threadStatus),
              style: TextStyle(color: eco.textMuted),
            )
          else ...[
            _ContextRoleSection(
              title: roleDisplayLabel(
                resolvePlannerContext(contextSnapshot!).role,
              ),
              role: resolvePlannerContext(contextSnapshot!),
            ),
            ...contextSnapshot!.roles
                .where((role) => role.role != 'planner')
                .map(
                  (role) => Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: _ContextRoleSection(
                      title: roleDisplayLabel(role.role),
                      role: role,
                    ),
                  ),
                ),
          ],
        ],
      ),
    );
  }
}

class _ContextRoleSection extends StatelessWidget {
  const _ContextRoleSection({
    required this.title,
    required this.role,
  });

  final String title;
  final ThreadRoleContextSnapshot role;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final pctColor = role.occupancyPct >= 95
        ? EcoColors.danger
        : (role.occupancyPct >= 85
            ? const Color(0xFFFBBF24)
            : EcoColors.accentText);
    final visibleSegments =
        role.segments.where((segment) => segment.tokens > 0).toList();

    return DecoratedBox(
      decoration: BoxDecoration(
        color: EcoColors.bgElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
                Text(
                  formatOccupancyLabel(role.occupancyPct),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: pctColor,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '~${formatContextK(role.occupied)} / ${formatContextK(role.limit)} tokens',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted,
                  ),
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: role.limit > 0
                    ? (role.occupied / role.limit).clamp(0.0, 1.0)
                    : 0,
                minHeight: 6,
                backgroundColor: eco.borderSubtle,
                color: pctColor,
              ),
            ),
            if (visibleSegments.isNotEmpty) ...[
              const SizedBox(height: 12),
              ...visibleSegments.map(
                (segment) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          segment.label,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      Text(
                        formatContextK(segment.tokens),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: eco.textMuted,
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({
    required this.label,
    required this.value,
    this.subtitle,
    this.emphasized = false,
    this.valueColor,
  });

  final String label;
  final String value;
  final String? subtitle;
  final bool emphasized;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: emphasized ? FontWeight.w600 : null,
                      ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                        ),
                  ),
                ],
              ],
            ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: valueColor ??
                      (emphasized ? EcoColors.success : EcoColors.textHeading),
                  fontWeight: emphasized ? FontWeight.w700 : FontWeight.w600,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
          ),
        ],
      ),
    );
  }
}
