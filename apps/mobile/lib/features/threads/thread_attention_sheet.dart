import 'package:flutter/material.dart';

import '../../core/locale/app_error_localizations.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_action_sheet.dart';
import '../../core/widgets/eco_grouped_list.dart';
import 'thread_providers.dart';

Future<ThreadAttentionItem?> showThreadAttentionSheet({
  required BuildContext context,
  required Future<List<ThreadAttentionItem>> itemsFuture,
  Set<String> hiddenItemIds = const <String>{},
}) {
  return showEcoActionSheet<ThreadAttentionItem>(
    context: context,
    isScrollControlled: true,
    builder: (context) => EcoSheetScaffold(
      title: context.l10n.threadAttentionTitle,
      maxHeightFactor: 0.64,
      child: FutureBuilder<List<ThreadAttentionItem>>(
        future: itemsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SizedBox(
              height: 120,
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            );
          }
          if (snapshot.hasError) {
            return _AttentionErrorState(error: snapshot.error!);
          }
          final items = (snapshot.data ?? const <ThreadAttentionItem>[])
              .where((item) => !hiddenItemIds.contains(item.id))
              .toList(growable: false);
          return _AttentionItems(items: items);
        },
      ),
    ),
  );
}

class _AttentionItems extends StatelessWidget {
  const _AttentionItems({required this.items});

  final List<ThreadAttentionItem> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            context.l10n.threadAttentionEmpty,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: ecoColors(context).textMuted,
            ),
          ),
        ),
      );
    }

    return ListView(
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
                  onTap: () => Navigator.pop(context, items[index]),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _AttentionErrorState extends StatelessWidget {
  const _AttentionErrorState({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 120),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            localizedAppError(error, context.l10n),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: ecoColors(context).textMuted,
            ),
          ),
        ),
      ),
    );
  }
}

String _attentionSubtitle(BuildContext context, ThreadAttentionItem item) {
  final kind = switch (item.kind) {
    ThreadAttentionKind.plan => context.l10n.threadAttentionPlan,
    ThreadAttentionKind.bash => context.l10n.threadAttentionBash,
  };
  final detail = item.detail?.trim();
  return detail == null || detail.isEmpty ? kind : '$kind · $detail';
}
