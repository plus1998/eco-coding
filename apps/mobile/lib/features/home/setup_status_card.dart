import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import 'setup_status.dart';

class SetupStatusCard extends StatelessWidget {
  const SetupStatusCard({
    super.key,
    required this.overview,
    this.onRefresh,
    this.refreshing = false,
  });

  final SetupOverview overview;
  final VoidCallback? onRefresh;
  final bool refreshing;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    context.l10n.setupProgressTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (onRefresh != null)
                  IconButton(
                    onPressed: refreshing ? null : onRefresh,
                    icon: refreshing
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(EcoIcons.refresh),
                    tooltip: context.l10n.commonRefresh,
                  ),
              ],
            ),
            if (overview.setupComplete) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: eco.statusAllowBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: eco.statusAllowBorder),
                ),
                child: Row(
                  children: [
                    Icon(
                      EcoIcons.checkCircle,
                      color: eco.statusAllowText,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        context.l10n.setupConnectedReady,
                        style: TextStyle(
                          color: eco.statusAllowText,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            ...overview.steps.map((step) => _SetupStepRow(step: step)),
          ],
        ),
      ),
    );
  }
}

class _SetupStepRow extends StatelessWidget {
  const _SetupStepRow({required this.step});

  final SetupStep step;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final (icon, color) = _iconForState(step, eco);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  step.title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontWeight: step.state == SetupStepState.inProgress
                        ? FontWeight.w600
                        : FontWeight.w500,
                  ),
                ),
                if (step.subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    step.subtitle!,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                  ),
                ],
                if (step.hint != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    step.hint!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: step.state == SetupStepState.error
                          ? eco.statusDenyText
                          : eco.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  (IconData, Color) _iconForState(SetupStep step, EcoColors eco) {
    switch (step.state) {
      case SetupStepState.done:
        return (EcoIcons.checkCircle, eco.statusAllowText);
      case SetupStepState.inProgress:
        return (EcoIcons.waiting, eco.accentText);
      case SetupStepState.error:
        return (EcoIcons.error, eco.statusDenyText);
      case SetupStepState.pending:
        return (EcoIcons.pending, eco.textMuted);
    }
  }
}
