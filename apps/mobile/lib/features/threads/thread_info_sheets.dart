import 'dart:math' as math;

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/eco_pressable.dart';
import '../../core/utils/thread_usage_display.dart';
import '../../l10n/generated/app_localizations.dart';

Future<void> showThreadBillingSheet({
  required BuildContext context,
  required ThreadBillingSnapshot? billing,
  required String? threadStatus,
}) {
  return showEcoActionSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: context.l10n.billingTitle,
      subtitle: billing == null ? null : context.l10n.billingSessionTotal,
      maxHeightFactor: 0.82,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 8),
        children: [
          if (billing == null)
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 24, 28, 16),
              child: Text(
                billingEmptyHint(threadStatus, context.l10n),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: ecoColors(context).textMuted,
                  height: 1.4,
                ),
              ),
            )
          else ...[
            _BillingHero(billing: billing),
            EcoGroupedSection(
              label: context.l10n.billingComparison,
              topSpacing: 20,
              child: Column(
                children: [
                  _InsetMetricTile(
                    label: context.l10n.billingUnorchestrated,
                    subtitle:
                        billing.plannerModelLabel?.trim().isNotEmpty == true
                        ? context.l10n.billingPlannerEstimate(
                            billing.plannerModelLabel!,
                          )
                        : context.l10n.billingMainModelEstimate,
                    value: formatCostUsd(billing.plannerTokenCostUsd),
                  ),
                  const EcoGroupedDivider(indent: 16),
                  _InsetMetricTile(
                    label: context.l10n.billingEco,
                    subtitle: context.l10n.billingEcoSubtitle,
                    value: formatCostUsd(billing.ecoCostUsd),
                    emphasized: true,
                  ),
                  const EcoGroupedDivider(indent: 16),
                  _InsetMetricTile(
                    label: context.l10n.billingSavings,
                    value: formatSavingsLine(
                      billing.savedUsd,
                      billing.savedPct,
                      context.l10n,
                    ),
                    valueColor: billing.savedUsd >= 0
                        ? ecoColors(context).success
                        : ecoColors(context).danger,
                  ),
                ],
              ),
            ),
            EcoGroupedSection(
              label: context.l10n.billingTokenUsage,
              topSpacing: 20,
              child: Column(
                children: [
                  _InsetMetricTile(
                    label: context.l10n.billingInput,
                    value: _formatTokenCount(billing.inputTokens),
                  ),
                  const EcoGroupedDivider(indent: 16),
                  _InsetMetricTile(
                    label: context.l10n.billingOutput,
                    value: _formatTokenCount(billing.outputTokens),
                  ),
                  if (billing.cacheReadTokens > 0) ...[
                    const EcoGroupedDivider(indent: 16),
                    _InsetMetricTile(
                      label: context.l10n.billingCacheRead,
                      value: _formatTokenCount(billing.cacheReadTokens),
                    ),
                  ],
                  if (billing.cacheCreationTokens > 0) ...[
                    const EcoGroupedDivider(indent: 16),
                    _InsetMetricTile(
                      label: context.l10n.billingCacheWrite,
                      value: _formatTokenCount(billing.cacheCreationTokens),
                    ),
                  ],
                ],
              ),
            ),
            if (billing.byModel.isNotEmpty)
              EcoGroupedSection(
                label: context.l10n.billingByModel,
                topSpacing: 20,
                child: Column(
                  children: [
                    for (var i = 0; i < billing.byModel.length; i++) ...[
                      if (i > 0) const EcoGroupedDivider(indent: 16),
                      _InsetMetricTile(
                        label: formatBillingModelLabel(billing.byModel[i]),
                        value: formatCostUsd(billing.byModel[i].ecoCostUsd),
                      ),
                    ],
                  ],
                ),
              ),
          ],
        ],
      ),
    ),
  );
}

Future<void> showThreadContextSheet({
  required BuildContext context,
  required ThreadContextSnapshot? contextSnapshot,
  required String? threadStatus,
  SubagentThemeSource? themeSource,
}) {
  return showEcoActionSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) {
      final planner = contextSnapshot == null
          ? null
          : resolvePlannerContext(contextSnapshot);
      return EcoSheetScaffold(
        title: context.l10n.billingContext,
        subtitle: planner == null
            ? null
            : formatRoleModelLabel(planner.role, planner.modelId, context.l10n),
        maxHeightFactor: 0.88,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 8),
          children: [
            if (contextSnapshot == null)
              Padding(
                padding: const EdgeInsets.fromLTRB(28, 24, 28, 16),
                child: Text(
                  contextCardPlaceholder(threadStatus, context.l10n),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: ecoColors(context).textMuted,
                    height: 1.4,
                  ),
                ),
              )
            else ...[
              _ContextHero(role: planner!),
              EcoGroupedSection(
                label: context.l10n.billingComposition,
                topSpacing: 20,
                child: _ContextSegmentList(role: planner),
              ),
              ..._buildSubagentSections(
                contextSnapshot,
                themeSource: themeSource,
                l10n: context.l10n,
              ),
            ],
          ],
        ),
      );
    },
  );
}

List<Widget> _buildSubagentSections(
  ThreadContextSnapshot snapshot, {
  SubagentThemeSource? themeSource,
  required AppLocalizations l10n,
}) {
  final rows = buildFlatSubagentContextRows(
    snapshot,
    themeSource: themeSource,
    l10n: l10n,
  );
  if (rows.isEmpty) return const [];

  return [
    for (final row in rows)
      EcoGroupedSection(
        label: row.title,
        topSpacing: 20,
        child: Column(
          children: [
            _ContextOccupancyTile(
              role: row.snapshot,
              accentColor: row.accentColor,
            ),
            if (row.snapshot.segments.any((s) => s.tokens > 0)) ...[
              const EcoGroupedDivider(indent: 16),
              _ContextSegmentList(role: row.snapshot),
            ],
          ],
        ),
      ),
  ];
}

String _formatTokenCount(int value) {
  if (value < 1000) return '$value';
  return formatContextK(value);
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final costLabel = formatBillingPillCost(billing);
    final costColor = (billing?.ecoCostUsd ?? 0) > 0
        ? eco.success
        : eco.textSecondary;
    final costStyle = Theme.of(context).textTheme.labelSmall?.copyWith(
      color: costColor,
      fontSize: 12,
      height: 1.1,
      letterSpacing: -0.1,
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

    final label = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      child: Text(costLabel, style: costStyle),
    );

    if (PlatformInfo.isIOS && isDark) {
      return Tooltip(
        message: context.l10n.billingTitle,
        child: AdaptiveButton.child(
          onPressed: openBillingSheet,
          style: AdaptiveButtonStyle.glass,
          size: AdaptiveButtonSize.small,
          minSize: Size(_billingPillWidth(context, costLabel, costStyle), 30),
          enabled: true,
          useSmoothRectangleBorder: false,
          child: label,
        ),
      );
    }

    return Tooltip(
      message: context.l10n.billingTitle,
      child: EcoPressable(
        onTap: openBillingSheet,
        borderRadius: BorderRadius.circular(999),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: eco.composerPillBg,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              width: 0.5,
              color: isDark
                  ? eco.composerPillBorder.withValues(alpha: 0.35)
                  : const Color(0x123C3C43),
            ),
          ),
          child: label,
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
  return painter.width + 20.0 + 16.0;
}

class _BillingHero extends StatelessWidget {
  const _BillingHero({required this.billing});

  final ThreadBillingSnapshot billing;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final savedPositive = billing.savedUsd > 0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 4, 24, 0),
      child: Column(
        children: [
          Text(
            formatCostUsd(billing.ecoCostUsd),
            style: Theme.of(context).textTheme.displaySmall?.copyWith(
              fontSize: 40,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.2,
              height: 1.05,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            savedPositive
                ? formatSavingsLine(
                    billing.savedUsd,
                    billing.savedPct,
                    context.l10n,
                  )
                : context.l10n.billingVsUnorchestrated,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: savedPositive ? eco.success : eco.textMuted,
              fontWeight: savedPositive ? FontWeight.w500 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextHero extends StatelessWidget {
  const _ContextHero({required this.role});

  final ThreadRoleContextSnapshot role;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final pctColor = _occupancyColor(eco, role.occupancyPct);

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 0),
      child: Column(
        children: [
          SizedBox(
            width: 112,
            height: 112,
            child: CustomPaint(
              painter: _ContextRingPainter(
                progress: role.limit > 0
                    ? (role.occupied / role.limit).clamp(0.0, 1.0)
                    : 0,
                trackColor: eco.borderSubtle.withValues(
                  alpha: Theme.of(context).brightness == Brightness.dark
                      ? 0.45
                      : 0.2,
                ),
                progressColor: pctColor,
                strokeWidth: 8,
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${role.occupancyPct}',
                      style: Theme.of(context).textTheme.headlineMedium
                          ?.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.8,
                            height: 1,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                    ),
                    Text(
                      '%',
                      style: Theme.of(
                        context,
                      ).textTheme.labelMedium?.copyWith(color: eco.textMuted),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            formatOccupancyLabel(role.occupancyPct, context.l10n),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: pctColor,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '~${formatContextK(role.occupied)} / ${formatContextK(role.limit)} tokens',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: eco.textMuted,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextOccupancyTile extends StatelessWidget {
  const _ContextOccupancyTile({required this.role, this.accentColor});

  final ThreadRoleContextSnapshot role;
  final Color? accentColor;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final pctColor = _occupancyColor(
      eco,
      role.occupancyPct,
      accent: accentColor,
    );
    final ratio = role.limit > 0
        ? (role.occupied / role.limit).clamp(0.0, 1.0)
        : 0.0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (accentColor != null) ...[
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: accentColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  formatOccupancyLabel(role.occupancyPct, context.l10n),
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontSize: 17,
                    letterSpacing: -0.2,
                    color: pctColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                '~${formatContextK(role.occupied)} / ${formatContextK(role.limit)}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 5,
              backgroundColor: eco.borderSubtle.withValues(
                alpha: Theme.of(context).brightness == Brightness.dark
                    ? 0.4
                    : 0.18,
              ),
              color: pctColor,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextSegmentList extends StatelessWidget {
  const _ContextSegmentList({required this.role});

  final ThreadRoleContextSnapshot role;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final segments = role.segments
        .where((segment) => segment.tokens > 0)
        .toList();
    if (segments.isEmpty) {
      return EcoGroupedTile(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Text(
          context.l10n.billingNoComposition,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: eco.textMuted),
        ),
      );
    }

    return Column(
      children: [
        for (var i = 0; i < segments.length; i++) ...[
          if (i > 0) const EcoGroupedDivider(indent: 16),
          EcoGroupedTile(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    segments[i].label,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      fontSize: 17,
                      letterSpacing: -0.2,
                    ),
                  ),
                ),
                Text(
                  formatContextK(segments[i].tokens),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: eco.textMuted,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _InsetMetricTile extends StatelessWidget {
  const _InsetMetricTile({
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
    return EcoGroupedTile(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontSize: 17,
                    letterSpacing: -0.2,
                    fontWeight: emphasized ? FontWeight.w600 : FontWeight.w400,
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
          const SizedBox(width: 12),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              fontSize: 17,
              letterSpacing: -0.2,
              color: valueColor ?? (emphasized ? eco.success : eco.textPrimary),
              fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

Color _occupancyColor(EcoColors eco, int pct, {Color? accent}) {
  if (pct >= 95) return eco.danger;
  if (pct >= 85) return eco.warnAccent;
  return accent ?? eco.accent;
}

class _ContextRingPainter extends CustomPainter {
  _ContextRingPainter({
    required this.progress,
    required this.trackColor,
    required this.progressColor,
    required this.strokeWidth,
  });

  final double progress;
  final Color trackColor;
  final Color progressColor;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (math.min(size.width, size.height) - strokeWidth) / 2;
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..color = trackColor;
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..color = progressColor;

    canvas.drawCircle(center, radius, track);
    if (progress > 0) {
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        -math.pi / 2,
        2 * math.pi * progress,
        false,
        arc,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ContextRingPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.progressColor != progressColor ||
        oldDelegate.trackColor != trackColor;
  }
}
