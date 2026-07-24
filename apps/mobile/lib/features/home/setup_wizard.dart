import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../l10n/generated/app_localizations.dart';
import 'setup_status.dart';

/// User-facing setup flow (WebSocket connects automatically after login).
enum SetupWizardStep { server, login, bindPc, selectPc }

extension SetupWizardStepX on SetupWizardStep {
  int get index => SetupWizardStep.values.indexOf(this);

  String title(AppLocalizations l10n) => switch (this) {
    SetupWizardStep.server => l10n.setupWizardServerTitle,
    SetupWizardStep.login => l10n.setupWizardLoginTitle,
    SetupWizardStep.bindPc => l10n.setupWizardBindTitle,
    SetupWizardStep.selectPc => l10n.setupWizardSelectTitle,
  };

  String subtitle(AppLocalizations l10n) => switch (this) {
    SetupWizardStep.server => l10n.setupWizardServerSubtitle,
    SetupWizardStep.login => l10n.setupWizardLoginSubtitle,
    SetupWizardStep.bindPc => l10n.setupWizardBindSubtitle,
    SetupWizardStep.selectPc => l10n.setupWizardSelectSubtitle,
  };

  String shortLabel(AppLocalizations l10n) => switch (this) {
    SetupWizardStep.server => l10n.setupWizardServerShort,
    SetupWizardStep.login => l10n.setupWizardAccountShort,
    SetupWizardStep.bindPc => l10n.setupWizardPairShort,
    SetupWizardStep.selectPc => 'PC',
  };
}

SetupWizardStep resolveSetupWizardStep(SetupOverview overview) {
  final server = overview.steps[0].state;
  final login = overview.steps[1].state;
  final bind = overview.steps[3].state;
  final select = overview.steps[4].state;

  if (server != SetupStepState.done) return SetupWizardStep.server;
  if (login != SetupStepState.done) return SetupWizardStep.login;
  if (bind != SetupStepState.done) return SetupWizardStep.bindPc;
  if (select != SetupStepState.done) return SetupWizardStep.selectPc;
  return SetupWizardStep.selectPc;
}

bool isSetupWizardStepDone(SetupWizardStep step, SetupOverview overview) {
  return switch (step) {
    SetupWizardStep.server => overview.steps[0].state == SetupStepState.done,
    SetupWizardStep.login => overview.steps[1].state == SetupStepState.done,
    SetupWizardStep.bindPc => overview.steps[3].state == SetupStepState.done,
    SetupWizardStep.selectPc => overview.steps[4].state == SetupStepState.done,
  };
}

class SetupWizardProgress extends StatelessWidget {
  const SetupWizardProgress({
    super.key,
    required this.current,
    required this.overview,
    required this.onStepTap,
  });

  final SetupWizardStep current;
  final SetupOverview overview;
  final ValueChanged<SetupWizardStep> onStepTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final steps = SetupWizardStep.values;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            for (var i = 0; i < steps.length; i++) ...[
              if (i > 0)
                Expanded(
                  child: Container(
                    height: 1,
                    margin: const EdgeInsets.only(bottom: 22),
                    color: isSetupWizardStepDone(steps[i - 1], overview)
                        ? eco.accent.withValues(alpha: 0.5)
                        : eco.borderSubtle,
                  ),
                ),
              _StepDot(
                step: steps[i],
                active: steps[i] == current,
                done: isSetupWizardStepDone(steps[i], overview),
                onTap: isSetupWizardStepDone(steps[i], overview)
                    ? () => onStepTap(steps[i])
                    : null,
              ),
            ],
          ],
        ),
      ],
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({
    required this.step,
    required this.active,
    required this.done,
    this.onTap,
  });

  final SetupWizardStep step;
  final bool active;
  final bool done;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final fg = done
        ? eco.statusAllowText
        : active
        ? eco.accentText
        : eco.textMuted;

    final dot = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: active ? 28 : 24,
          height: active ? 28 : 24,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: done
                ? eco.statusAllowBg
                : active
                ? eco.accentSoft
                : Colors.transparent,
            border: Border.all(
              color: done
                  ? eco.statusAllowBorder
                  : active
                  ? eco.accent.withValues(alpha: 0.6)
                  : eco.borderSubtle,
              width: active ? 1.5 : 1,
            ),
          ),
          child: Center(
            child: done
                ? Icon(EcoIcons.check, size: 14, color: fg)
                : Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: active ? eco.accent : eco.textMuted,
                    ),
                  ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          step.shortLabel(context.l10n),
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: fg,
            fontWeight: active ? FontWeight.w600 : FontWeight.normal,
            fontSize: 11,
            letterSpacing: 0.2,
          ),
        ),
      ],
    );

    if (onTap == null) return dot;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        child: dot,
      ),
    );
  }
}
