import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_markdown.dart';

class PlanApprovalPanel extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final canApprove = plan.plan.trim().isNotEmpty && failureMessage == null;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colors.composerContextBg,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: colors.composerPillBorder),
            boxShadow: [
              BoxShadow(
                color: colors.shadowScrim.withValues(alpha: isDark ? 0.22 : 0.05),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
              BoxShadow(
                color: colors.shadowScrim.withValues(alpha: isDark ? 0.12 : 0.04),
                blurRadius: 2,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '实施计划',
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w400,
                        height: 1.5,
                      ),
                ),
                if (failureMessage != null) ...[
                  const SizedBox(height: 10),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.dangerSoft,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: colors.danger.withValues(alpha: 0.35)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '上次执行失败',
                            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                  color: colors.danger,
                                ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            failureMessage!,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
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
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: SingleChildScrollView(
                    child: EcoMarkdown(text: plan.plan),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    TextButton(
                      onPressed: busy ? null : () => onDismiss(),
                      style: TextButton.styleFrom(
                        foregroundColor: colors.textMuted,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                      ),
                      child: Text(busy ? '处理中…' : '忽略'),
                    ),
                    const Spacer(),
                    if (canApprove)
                      FilledButton(
                        onPressed: busy ? null : () => onApprove(),
                        style: FilledButton.styleFrom(
                          backgroundColor:
                              isDark ? colors.composerSendBg : const Color(0xFF0D0D0D),
                          foregroundColor:
                              isDark ? colors.composerSendText : Colors.white,
                          minimumSize: const Size(0, 34),
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          shape: const StadiumBorder(),
                        ),
                        child: busy
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
                            : const Text('执行计划 ↵'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
