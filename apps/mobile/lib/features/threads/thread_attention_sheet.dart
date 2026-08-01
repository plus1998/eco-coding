import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
import 'thread_providers.dart';

Future<String?> showThreadAttentionSheet({
  required BuildContext context,
  required List<ThreadAttentionItem> items,
}) {
  return showEcoActionSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: context.l10n.threadAttentionTitle,
      maxHeightFactor: 0.64,
      child: items.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  context.l10n.threadAttentionEmpty,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: ecoColors(context).textMuted,
                  ),
                ),
              ),
            )
          : ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.only(bottom: 8),
              children: [
                EcoGroupedSurface(
                  child: Column(
                    children: [
                      for (var index = 0; index < items.length; index++) ...[
                        if (index > 0) const EcoGroupedDivider(indent: 52),
                        EcoSheetOptionTile(
                          leading: Icon(
                            switch (items[index].kind) {
                              ThreadAttentionKind.plan => EcoIcons.planApproval,
                              ThreadAttentionKind.bash => EcoIcons.terminal,
                            },
                            size: 20,
                            color: ecoColors(context).accent,
                          ),
                          title: items[index].title,
                          subtitle: _attentionSubtitle(context, items[index]),
                          onTap: () =>
                              Navigator.pop(context, items[index].threadId),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
    ),
  );
}

String _attentionSubtitle(BuildContext context, ThreadAttentionItem item) {
  final kind = switch (item.kind) {
    ThreadAttentionKind.plan => context.l10n.threadAttentionPlan,
    ThreadAttentionKind.bash => context.l10n.threadAttentionBash,
  };
  final detail = item.detail?.trim();
  return detail == null || detail.isEmpty ? kind : '$kind · $detail';
}
