import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_markdown.dart';

const planApprovalCollapsedMarkdownMaxHeight = 220.0;
const planApprovalExpandedHeightFactor = 0.85;

class PlanApprovalPanel extends StatefulWidget {
  const PlanApprovalPanel({
    super.key,
    required this.plan,
    required this.busy,
    required this.onApprove,
    required this.onDismiss,
    this.failureMessage,
  });

  final ThreadPendingPlan plan;
  final bool busy;
  final Future<void> Function() onApprove;
  final Future<void> Function() onDismiss;
  final String? failureMessage;

  @override
  State<PlanApprovalPanel> createState() => _PlanApprovalPanelState();
}

class _PlanApprovalPanelState extends State<PlanApprovalPanel> {
  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final canApprove =
        widget.plan.plan.trim().isNotEmpty && widget.failureMessage == null;
    final expandedHeight =
        MediaQuery.sizeOf(context).height * planApprovalExpandedHeightFactor;
    final expandLabel = _expanded
        ? context.l10n.approvalPlanCollapse
        : context.l10n.approvalPlanExpand;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: AnimatedSize(
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOutCubic,
          alignment: Alignment.bottomCenter,
          child: SizedBox(
            key: const Key('plan-approval-panel'),
            height: _expanded ? expandedHeight : null,
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.composerContextBg,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: colors.composerPillBorder),
                boxShadow: [
                  BoxShadow(
                    color: colors.shadowScrim.withValues(
                      alpha: isDark ? 0.22 : 0.05,
                    ),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                  BoxShadow(
                    color: colors.shadowScrim.withValues(
                      alpha: isDark ? 0.12 : 0.04,
                    ),
                    blurRadius: 2,
                    offset: const Offset(0, 1),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(22),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: _expanded
                        ? MainAxisSize.max
                        : MainAxisSize.min,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              context.l10n.approvalImplementPlan,
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(
                                    fontWeight: FontWeight.w400,
                                    height: 1.5,
                                  ),
                            ),
                          ),
                          IconButton(
                            key: const Key('plan-approval-expand'),
                            onPressed: () =>
                                setState(() => _expanded = !_expanded),
                            tooltip: expandLabel,
                            icon: Icon(
                              _expanded
                                  ? EcoIcons.collapseFullscreen
                                  : EcoIcons.expandFullscreen,
                              size: 18,
                            ),
                            visualDensity: VisualDensity.compact,
                            style: IconButton.styleFrom(
                              foregroundColor: colors.textMuted,
                              padding: EdgeInsets.zero,
                              minimumSize: const Size(32, 32),
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                          ),
                        ],
                      ),
                      if (widget.failureMessage != null) ...[
                        const SizedBox(height: 10),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: colors.dangerSoft,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: colors.danger.withValues(alpha: 0.35),
                            ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  context.l10n.approvalLastRunFailed,
                                  style: Theme.of(context).textTheme.labelLarge
                                      ?.copyWith(color: colors.danger),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  widget.failureMessage!,
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: colors.danger,
                                        height: 1.45,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      if (_expanded)
                        Expanded(
                          child: SingleChildScrollView(
                            child: EcoMarkdown(text: widget.plan.plan),
                          ),
                        )
                      else
                        ConstrainedBox(
                          constraints: const BoxConstraints(
                            maxHeight: planApprovalCollapsedMarkdownMaxHeight,
                          ),
                          child: SingleChildScrollView(
                            child: EcoMarkdown(text: widget.plan.plan),
                          ),
                        ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          TextButton(
                            onPressed: widget.busy
                                ? null
                                : () => widget.onDismiss(),
                            style: TextButton.styleFrom(
                              foregroundColor: colors.textMuted,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                            ),
                            child: Text(
                              widget.busy
                                  ? context.l10n.commonProcessing
                                  : context.l10n.approvalIgnore,
                            ),
                          ),
                          const SizedBox(width: 8),
                          if (canApprove)
                            Flexible(
                              child: Align(
                                alignment: Alignment.centerRight,
                                child: FilledButton(
                                  onPressed: widget.busy
                                      ? null
                                      : () => widget.onApprove(),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: isDark
                                        ? colors.composerSendBg
                                        : const Color(0xFF0D0D0D),
                                    foregroundColor: isDark
                                        ? colors.composerSendText
                                        : Colors.white,
                                    minimumSize: const Size(0, 34),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                    ),
                                    shape: const StadiumBorder(),
                                  ),
                                  child: widget.busy
                                      ? SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: isDark
                                                ? colors.composerSendText
                                                : Colors.white,
                                          ),
                                        )
                                      : Text(
                                          context.l10n.approvalExecutePlan,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
