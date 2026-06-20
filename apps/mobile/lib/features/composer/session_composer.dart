import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import 'composer_controls.dart';
import 'workspace_changes_pill.dart';

class SessionComposer extends ConsumerWidget {
  const SessionComposer({
    super.key,
    required this.controller,
    required this.attachments,
    required this.runtimeConfig,
    required this.threadId,
    required this.isRunning,
    required this.hasActivity,
    required this.workspaceDiff,
    required this.diffLoading,
    required this.onPickImage,
    required this.onRemoveAttachment,
    required this.onSend,
    required this.onStop,
    required this.onRuntimeConfigChanged,
    required this.onChangesTap,
    this.inputHint,
  });

  final TextEditingController controller;
  final List<PromptImageAttachment> attachments;
  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool isRunning;
  final bool hasActivity;
  final WorkspaceDiffResult? workspaceDiff;
  final bool diffLoading;
  final VoidCallback onPickImage;
  final void Function(int index) onRemoveAttachment;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final ValueChanged<ThreadRuntimeConfigInput> onRuntimeConfigChanged;
  final VoidCallback? onChangesTap;
  final String? inputHint;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eco = ecoThemeExtras(context);
    final canSend = !isRunning && controller.text.trim().isNotEmpty;
    final canEditConfig = !isRunning;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        WorkspaceChangesPill(
          diff: workspaceDiff,
          busy: diffLoading,
          onTap: onChangesTap,
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: EcoColors.bgElevated,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: eco.borderSubtle),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x40000000),
                    blurRadius: 12,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (attachments.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                      child: SizedBox(
                        height: 40,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: attachments.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 8),
                          itemBuilder: (context, index) => InputChip(
                            label: Text('图片 ${index + 1}'),
                            visualDensity: VisualDensity.compact,
                            onDeleted: () => onRemoveAttachment(index),
                          ),
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      controller: controller,
                      minLines: 1,
                      maxLines: 6,
                      decoration: InputDecoration(
                        hintText: inputHint ??
                            (hasActivity ? '跟进' : '发送消息…'),
                        border: InputBorder.none,
                        isDense: true,
                        hintStyle: TextStyle(color: eco.textMuted),
                      ),
                      style: const TextStyle(fontSize: 16),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 4, 8, 6),
                    child: Row(
                      children: [
                        ComposerProfileControl(
                          runtimeConfig: runtimeConfig,
                          threadId: threadId,
                          canEdit: canEditConfig,
                          onChanged: onRuntimeConfigChanged,
                        ),
                        Container(
                          width: 1,
                          height: 18,
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          color: eco.borderSubtle,
                        ),
                        ComposerOrchestrationControl(
                          runtimeConfig: runtimeConfig,
                          threadId: threadId,
                          canEdit: canEditConfig,
                          onChanged: onRuntimeConfigChanged,
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: eco.borderSubtle),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 2, 8, 8),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: onPickImage,
                          icon: const Icon(Icons.add, size: 22),
                          tooltip: '添加图片',
                          visualDensity: VisualDensity.compact,
                        ),
                        ComposerPlanModeControl(
                          runtimeConfig: runtimeConfig,
                          threadId: threadId,
                          canEdit: canEditConfig,
                          onChanged: onRuntimeConfigChanged,
                        ),
                        ComposerBashReviewControl(
                          runtimeConfig: runtimeConfig,
                          threadId: threadId,
                          onChanged: onRuntimeConfigChanged,
                        ),
                        const Spacer(),
                        if (isRunning)
                          _StopButton(onStop: onStop)
                        else
                          _SendButton(onSend: canSend ? onSend : null),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({required this.onSend});

  final VoidCallback? onSend;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: onSend != null ? EcoColors.composerSendBg : EcoColors.borderSubtle,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onSend,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 34,
          height: 34,
          child: Icon(
            Icons.arrow_upward,
            size: 20,
            color: onSend != null
                ? EcoColors.composerSendText
                : EcoColors.textMuted,
          ),
        ),
      ),
    );
  }
}

class _StopButton extends StatelessWidget {
  const _StopButton({required this.onStop});

  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: EcoColors.textPrimary,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onStop,
        borderRadius: BorderRadius.circular(8),
        child: const SizedBox(
          width: 34,
          height: 34,
          child: Icon(
            Icons.stop_rounded,
            size: 18,
            color: EcoColors.bgMain,
          ),
        ),
      ),
    );
  }
}
