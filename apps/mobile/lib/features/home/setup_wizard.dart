import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';
import 'setup_status.dart';

/// User-facing setup flow (WebSocket connects automatically after login).
enum SetupWizardStep { server, login, bindPc, selectPc }

extension SetupWizardStepX on SetupWizardStep {
  int get index => SetupWizardStep.values.indexOf(this);

  String get title => switch (this) {
        SetupWizardStep.server => '配置服务器',
        SetupWizardStep.login => '注册 / 登录',
        SetupWizardStep.bindPc => '绑定 PC',
        SetupWizardStep.selectPc => '选择 PC',
      };

  String get subtitle => switch (this) {
        SetupWizardStep.server => '填写 Center Server 地址并确认可达',
        SetupWizardStep.login => '登录账号并注册本机为移动设备',
        SetupWizardStep.bindPc => '在 Desktop 生成配对码后扫码或手输',
        SetupWizardStep.selectPc => '选择要远程操控的 PC',
      };

  String get shortLabel => switch (this) {
        SetupWizardStep.server => '服务器',
        SetupWizardStep.login => '登录',
        SetupWizardStep.bindPc => '绑定',
        SetupWizardStep.selectPc => '选择',
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
    final eco = ecoThemeExtras(context);
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
                    height: 2,
                    color: isSetupWizardStepDone(steps[i - 1], overview)
                        ? EcoColors.accent
                        : eco.borderSubtle,
                  ),
                ),
              _StepDot(
                step: steps[i],
                index: i + 1,
                active: steps[i] == current,
                done: isSetupWizardStepDone(steps[i], overview),
                onTap: isSetupWizardStepDone(steps[i], overview)
                    ? () => onStepTap(steps[i])
                    : null,
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),
        Text(
          current.title,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 4),
        Text(
          current.subtitle,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: eco.textMuted,
              ),
        ),
        if (overview.readyForThreads) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: eco.statusAllowBg,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: EcoColors.statusAllowBorder),
            ),
            child: Row(
              children: [
                Icon(Icons.check_circle, color: eco.statusAllowText, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '一切就绪，可前往「会话」远程操控 PC',
                    style: TextStyle(color: eco.statusAllowText, fontSize: 13),
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

class _StepDot extends StatelessWidget {
  const _StepDot({
    required this.step,
    required this.index,
    required this.active,
    required this.done,
    this.onTap,
  });

  final SetupWizardStep step;
  final int index;
  final bool active;
  final bool done;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final bg = done
        ? eco.statusAllowBg
        : active
            ? EcoColors.accentSoft
            : EcoColors.bgElevated;
    final fg = done
        ? eco.statusAllowText
        : active
            ? EcoColors.accentText
            : eco.textMuted;

    final dot = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 16,
          backgroundColor: bg,
          child: done
              ? Icon(Icons.check, size: 18, color: fg)
              : Text(
                  '$index',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: fg,
                  ),
                ),
        ),
        const SizedBox(height: 6),
        Text(
          step.shortLabel,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: active ? EcoColors.accentText : eco.textMuted,
                fontWeight: active ? FontWeight.w600 : FontWeight.normal,
              ),
        ),
      ],
    );

    if (onTap == null) return dot;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
        child: dot,
      ),
    );
  }
}
