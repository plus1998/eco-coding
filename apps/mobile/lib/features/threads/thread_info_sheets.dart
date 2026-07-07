import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../../core/utils/thread_usage_display.dart';

Future<void> showThreadBillingSheet({
  required BuildContext context,
  required ThreadBillingSnapshot? billing,
  required String? threadStatus,
}) {
  return showEcoModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
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
  OrchestrationProfile? agentProfile,
}) {
  return showEcoModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) {
      final maxHeight = MediaQuery.sizeOf(context).height * 0.9;
      return Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: _ContextSheet(
            contextSnapshot: contextSnapshot,
            threadStatus: threadStatus,
            agentProfile: agentProfile,
          ),
        ),
      );
    },
  );
}

class ThreadUsageFloatButtons extends StatelessWidget {
  const ThreadUsageFloatButtons({
    super.key,
    required this.billing,
    required this.threadStatus,
  });

  final ThreadBillingSnapshot? billing;
  final String? threadStatus;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final costLabel = formatBillingPillCost(billing);
    final costColor = (billing?.ecoCostUsd ?? 0) > 0
        ? eco.success
        : eco.textSecondary;
    final costStyle = Theme.of(context).textTheme.labelSmall?.copyWith(
      color: costColor,
      fontSize: 10,
      height: 1.1,
      fontFeatures: const [FontFeature.tabularFigures()],
      fontWeight: FontWeight.w600,
    );
    void openBillingSheet() {
      showThreadBillingSheet(
        context: context,
        billing: billing,
        threadStatus: threadStatus,
      );
    }

    if (PlatformInfo.isIOS) {
      return Tooltip(
        message: '计费',
        child: AdaptiveButton.child(
          onPressed: openBillingSheet,
          style: AdaptiveButtonStyle.glass,
          size: AdaptiveButtonSize.small,
          minSize: Size(_billingPillWidth(context, costLabel, costStyle), 28),
          enabled: true,
          useSmoothRectangleBorder: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            child: Text(costLabel, style: costStyle),
          ),
        ),
      );
    }

    return Material(
      color: eco.bgElevated.withValues(alpha: 0.5),
      elevation: 2,
      shadowColor: eco.shadowScrim.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(999),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: eco.borderSubtle),
        ),
        child: _FloatMetricSegment(
          tooltip: '计费',
          onTap: openBillingSheet,
          child: Text(costLabel, style: costStyle),
        ),
      ),
    );
  }
}

double _billingPillWidth(BuildContext context, String label, TextStyle? style) {
  final painter = TextPainter(
    text: TextSpan(text: label, style: style),
    textDirection: Directionality.of(context),
    textScaler: MediaQuery.textScalerOf(context),
    maxLines: 1,
  )..layout();
  return painter.width + 14.0 + 16.0;
}

class _FloatMetricSegment extends StatelessWidget {
  const _FloatMetricSegment({
    required this.tooltip,
    required this.onTap,
    required this.child,
  });

  final String tooltip;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
          child: child,
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
    final eco = ecoColors(context);
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
              const Icon(EcoIcons.usageCost, size: 18),
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
              valueColor: billing!.savedUsd >= 0 ? eco.success : eco.danger,
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
            if (billing!.byModel.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text('按模型', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              ...billing!.byModel.map(
                (entry) => _MetricRow(
                  label: formatBillingModelLabel(entry),
                  value: formatCostUsd(entry.ecoCostUsd),
                ),
              ),
            ],
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
    this.agentProfile,
  });

  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;
  final OrchestrationProfile? agentProfile;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
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
                      const Icon(EcoIcons.contextMemory, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        '上下文',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
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
                      title: formatRoleModelLabel(
                        resolvePlannerContext(contextSnapshot!).role,
                        resolvePlannerContext(contextSnapshot!).modelId,
                      ),
                      role: resolvePlannerContext(contextSnapshot!),
                    ),
                    ...buildFlatSubagentContextRows(
                      contextSnapshot!,
                      profile: agentProfile,
                    ).map(
                      (row) => Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: _ContextRoleSection(
                          title: row.title,
                          role: row.snapshot,
                          accentColor: row.accentColor,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextRoleSection extends StatelessWidget {
  const _ContextRoleSection({
    required this.title,
    required this.role,
    this.accentColor,
  });

  final String title;
  final ThreadRoleContextSnapshot role;
  final Color? accentColor;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final accent = accentColor;
    final pctColor = role.occupancyPct >= 95
        ? eco.danger
        : (role.occupancyPct >= 85
              ? eco.warnAccent
              : (accent ?? eco.accentText));
    final visibleSegments = role.segments
        .where((segment) => segment.tokens > 0)
        .toList();

    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.bgElevated,
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
                if (accent != null) ...[
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
                Text(
                  formatOccupancyLabel(role.occupancyPct),
                  style: Theme.of(
                    context,
                  ).textTheme.labelSmall?.copyWith(color: pctColor),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '~${formatContextK(role.occupied)} / ${formatContextK(role.limit)} tokens',
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
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
                          fontFeatures: const [FontFeature.tabularFigures()],
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
    final eco = ecoColors(context);
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
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                  ),
                ],
              ],
            ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: valueColor ?? (emphasized ? eco.success : eco.textHeading),
              fontWeight: emphasized ? FontWeight.w700 : FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
