import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';

Future<void> showPlanApprovalSheet({
  required BuildContext context,
  required ThreadPendingPlan plan,
  required Future<void> Function() onApprove,
  required Future<void> Function() onDismiss,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) {
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        minChildSize: 0.4,
        maxChildSize: 0.95,
        builder: (context, scrollController) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('计划审批', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Expanded(
                  child: ListView(
                    controller: scrollController,
                    children: [
                      Text('用户请求', style: Theme.of(context).textTheme.labelLarge),
                      Text(plan.userPrompt),
                      const SizedBox(height: 12),
                      Text('分析', style: Theme.of(context).textTheme.labelLarge),
                      Text(plan.analysis),
                      const SizedBox(height: 12),
                      Text('计划', style: Theme.of(context).textTheme.labelLarge),
                      Text(plan.plan),
                    ],
                  ),
                ),
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
          );
        },
      );
    },
  );
}

Future<void> showBashApprovalSheet({
  required BuildContext context,
  required BashApprovalRequest request,
  required Future<void> Function(String decision) onResolve,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Bash 审批', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('风险: ${request.riskLevel} (${request.riskScore})'),
            const SizedBox(height: 8),
            Text(request.reason),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: EcoColors.codeBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: EcoColors.borderSubtle),
              ),
              child: Text(
                request.filesystemTool != null
                    ? '${request.filesystemTool}: ${request.filesystemPath}'
                    : request.command,
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
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
            SizedBox(height: MediaQuery.of(context).viewInsets.bottom),
          ],
        ),
      );
    },
  );
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
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setState) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('需要澄清', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
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
                ),
                FilledButton(
                  onPressed: selections.every((s) => s.isNotEmpty)
                      ? () async {
                          await onSubmit(selections);
                          if (context.mounted) Navigator.pop(context);
                        }
                      : null,
                  child: const Text('提交'),
                ),
                SizedBox(height: MediaQuery.of(context).viewInsets.bottom),
              ],
            ),
          );
        },
      );
    },
  );
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
