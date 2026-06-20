import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import 'composer_settings_sheet.dart';
import 'workspace_changes_pill.dart';

class SessionComposer extends StatefulWidget {
  const SessionComposer({
    super.key,
    required this.controller,
    required this.attachments,
    required this.runtimeConfig,
    required this.threadId,
    required this.isRunning,
    required this.hasActivity,
    required this.modelLabel,
    required this.workspaceDiff,
    required this.diffLoading,
    required this.onPickImage,
    required this.onRemoveAttachment,
    required this.onSend,
    required this.onStop,
    required this.onRuntimeConfigChanged,
    required this.onChangesTap,
  });

  final TextEditingController controller;
  final List<PromptImageAttachment> attachments;
  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final bool isRunning;
  final bool hasActivity;
  final String modelLabel;
  final WorkspaceDiffResult? workspaceDiff;
  final bool diffLoading;
  final VoidCallback onPickImage;
  final void Function(int index) onRemoveAttachment;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final ValueChanged<ThreadRuntimeConfigInput> onRuntimeConfigChanged;
  final VoidCallback? onChangesTap;

  @override
  State<SessionComposer> createState() => _SessionComposerState();
}

class _SessionComposerState extends State<SessionComposer> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  void _onTextChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final canSend =
        !widget.isRunning && widget.controller.text.trim().isNotEmpty;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        WorkspaceChangesPill(
          diff: widget.workspaceDiff,
          busy: widget.diffLoading,
          onTap: widget.onChangesTap,
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
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.attachments.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                      child: SizedBox(
                        height: 40,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: widget.attachments.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 8),
                          itemBuilder: (context, index) => InputChip(
                            label: Text('图片 ${index + 1}'),
                            visualDensity: VisualDensity.compact,
                            onDeleted: () => widget.onRemoveAttachment(index),
                          ),
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      controller: widget.controller,
                      minLines: 1,
                      maxLines: 6,
                      decoration: InputDecoration(
                        hintText:
                            widget.hasActivity ? '跟进' : '发送消息…',
                        border: InputBorder.none,
                        isDense: true,
                        hintStyle: TextStyle(color: eco.textMuted),
                      ),
                      style: const TextStyle(fontSize: 16),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(6, 4, 8, 8),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: widget.onPickImage,
                          icon: const Icon(Icons.add, size: 22),
                          tooltip: '添加图片',
                          visualDensity: VisualDensity.compact,
                        ),
                        Consumer(
                          builder: (context, ref, _) => IconButton(
                            onPressed: () => showComposerSettingsSheet(
                              context: context,
                              ref: ref,
                              runtimeConfig: widget.runtimeConfig,
                              threadId: widget.threadId,
                              onChanged: widget.onRuntimeConfigChanged,
                            ),
                            icon: const Icon(Icons.tune, size: 20),
                            tooltip: 'Composer 设置',
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                        _ModelBadge(label: widget.modelLabel),
                        const Spacer(),
                        if (widget.isRunning)
                          _StopButton(onStop: widget.onStop)
                        else
                          _SendButton(onSend: canSend ? widget.onSend : null),
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

class _ModelBadge extends StatelessWidget {
  const _ModelBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    if (label.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: EcoColors.composerPillBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: EcoColors.composerPillBorder),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: EcoColors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
      ),
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
