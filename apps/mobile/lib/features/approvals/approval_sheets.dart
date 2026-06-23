import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/widgets/eco_markdown.dart';

Future<void> showPlanApprovalSheet({
  required BuildContext context,
  required ThreadPendingPlan plan,
  required Future<void> Function() onApprove,
  required Future<void> Function() onDismiss,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    isDismissible: false,
    enableDrag: false,
    builder: (context) {
      return PopScope(
        canPop: false,
        child: _ScrollableSheetFrame(
        maxHeightFactor: 0.92,
        footer: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () async {
                      await onDismiss();
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('驳回'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () async {
                      await onApprove();
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('批准执行'),
                  ),
                ),
              ],
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('计划审批', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('用户请求', style: Theme.of(context).textTheme.labelLarge),
            Text(plan.userPrompt),
            const SizedBox(height: 12),
            Text('分析', style: Theme.of(context).textTheme.labelLarge),
            Text(plan.analysis),
            const SizedBox(height: 12),
            Text('计划', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 4),
            EcoMarkdown(text: plan.plan),
          ],
        ),
      ),
      );
    },
  );
}

Future<void> showBashApprovalSheet({
  required BuildContext context,
  required BashApprovalRequest request,
  required Future<void> Function(String decision) onResolve,
}) {
  final title = resolveBashApprovalTitle(
    description: request.description,
    reason: request.reason,
    filesystemTool: request.filesystemTool,
  );
  final detail = request.filesystemTool != null
      ? '${request.filesystemTool}: ${request.filesystemPath}'
      : request.command;
  final panelLabel =
      request.filesystemTool != null ? '工具读取确认' : 'Bash 执行确认';

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) {
      return _ScrollableSheetFrame(
        maxHeightFactor: 0.85,
        footer: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () async {
                      await onResolve('denied');
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('拒绝'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () async {
                      await onResolve('approved');
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('批准'),
                  ),
                ),
              ],
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(panelLabel, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          height: 1.4,
                        ),
                  ),
                ),
                if (request.filesystemTool == null) ...[
                  const SizedBox(width: 12),
                  _BashRiskBadge(
                    level: request.riskLevel,
                    score: request.riskScore,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: ecoColors(context).codeBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: ecoColors(context).borderSubtle),
              ),
              child: SelectableText(
                detail,
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
          ],
        ),
      );
    },
  );
}

class _BashRiskBadge extends StatelessWidget {
  const _BashRiskBadge({
    required this.level,
    required this.score,
  });

  final String level;
  final int score;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final color = switch (level) {
      'critical' => colors.danger,
      'high' => colors.severityHigh,
      'low' => colors.success,
      _ => colors.severityDefault,
    };
    final label = switch (level) {
      'critical' => '严重',
      'high' => '高',
      'low' => '低',
      _ => '中',
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(width: 4),
          Text(
            '$score',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: color,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }
}

Future<void> showClarificationSheet({
  required BuildContext context,
  required ClarificationRequest request,
  required Future<void> Function(List<List<String>> selections) onSubmit,
}) {
  final selections = List<List<String>>.generate(
    request.questions.length,
    (_) => <String>[],
  );

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setState) {
          return _ScrollableSheetFrame(
            maxHeightFactor: 0.92,
            footer: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: selections.every((s) => s.isNotEmpty)
                      ? () async {
                          await onSubmit(selections);
                          if (context.mounted) Navigator.pop(context);
                        }
                      : null,
                  child: const Text('提交'),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '需要澄清',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                for (var i = 0; i < request.questions.length; i++)
                  _ClarificationQuestionCard(
                    question: request.questions[i],
                    selected: selections[i],
                    onChanged: (value) {
                      setState(() {
                        if (request.questions[i].multiSelect == true) {
                          if (selections[i].contains(value)) {
                            selections[i].remove(value);
                          } else {
                            selections[i].add(value);
                          }
                        } else {
                          selections[i] = [value];
                        }
                      });
                    },
                  ),
              ],
            ),
          );
        },
      );
    },
  );
}

class _ScrollableSheetFrame extends StatelessWidget {
  const _ScrollableSheetFrame({
    required this.child,
    required this.footer,
    this.maxHeightFactor = 0.92,
  });

  final Widget child;
  final Widget footer;
  final double maxHeightFactor;

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final maxHeight = mediaQuery.size.height * maxHeightFactor;
    return Padding(
      padding: EdgeInsets.only(bottom: mediaQuery.viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: SingleChildScrollView(
                  child: child,
                ),
              ),
              footer,
            ],
          ),
        ),
      ),
    );
  }
}

class _ClarificationQuestionCard extends StatelessWidget {
  const _ClarificationQuestionCard({
    required this.question,
    required this.selected,
    required this.onChanged,
  });

  final ClarificationQuestion question;
  final List<String> selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (question.header != null) Text(question.header!),
            Text(question.question, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: question.options.map((option) {
                final isSelected = selected.contains(option.label);
                return FilterChip(
                  label: Text(option.label),
                  selected: isSelected,
                  onSelected: (_) => onChanged(option.label),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}
