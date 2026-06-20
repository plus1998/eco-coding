import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import 'composer_controls.dart';
import 'workspace_changes_pill.dart';

class SessionComposer extends ConsumerStatefulWidget {
  const SessionComposer({
    super.key,
    required this.controller,
    required this.attachments,
    required this.runtimeConfig,
    required this.threadId,
    required this.isRunning,
    this.followUpMode = false,
    this.sendBusy = false,
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
  final bool followUpMode;
  final bool sendBusy;
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
  ConsumerState<SessionComposer> createState() => _SessionComposerState();
}

class _SessionComposerState extends ConsumerState<SessionComposer> {
  final _focusNode = FocusNode();

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  bool get _hasContent =>
      widget.controller.text.trim().isNotEmpty || widget.attachments.isNotEmpty;

  bool get _canSend {
    if (widget.sendBusy) {
      return false;
    }
    if (widget.followUpMode) {
      return _hasContent;
    }
    return !widget.isRunning && _hasContent;
  }

  void _handleSend() {
    if (!_canSend) return;
    _focusNode.unfocus();
    widget.onSend();
  }

  void _handleStop() {
    _focusNode.unfocus();
    widget.onStop();
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final canEditConfig = !widget.isRunning;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        WorkspaceChangesPill(
          diff: widget.workspaceDiff,
          busy: widget.diffLoading,
          onTap: widget.onChangesTap,
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: EcoColors.bgMain,
            border: Border(top: BorderSide(color: eco.borderSubtle)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 12, 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.attachments.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
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
                  TextField(
                    controller: widget.controller,
                    focusNode: _focusNode,
                    minLines: 1,
                    maxLines: 6,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _canSend ? (_) => _handleSend() : null,
                    decoration: InputDecoration(
                      hintText: widget.inputHint ??
                          (widget.followUpMode
                              ? '要求后续变更'
                              : (widget.hasActivity ? '跟进' : '发送消息…')),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                      hintStyle: TextStyle(color: eco.textMuted),
                    ),
                    style: const TextStyle(fontSize: 16, height: 1.35),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: ComposerProfileControl(
                          runtimeConfig: widget.runtimeConfig,
                          threadId: widget.threadId,
                          canEdit: canEditConfig,
                          onChanged: widget.onRuntimeConfigChanged,
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 18,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        color: eco.borderSubtle.withValues(alpha: 0.6),
                      ),
                      Expanded(
                        child: ComposerOrchestrationControl(
                          runtimeConfig: widget.runtimeConfig,
                          threadId: widget.threadId,
                          canEdit: canEditConfig,
                          onChanged: widget.onRuntimeConfigChanged,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      IconButton(
                        onPressed: widget.onPickImage,
                        icon: const Icon(Icons.add, size: 22),
                        tooltip: '添加图片',
                        visualDensity: VisualDensity.compact,
                      ),
                      ComposerPlanModeControl(
                        runtimeConfig: widget.runtimeConfig,
                        threadId: widget.threadId,
                        canEdit: canEditConfig,
                        onChanged: widget.onRuntimeConfigChanged,
                      ),
                      ComposerBashReviewControl(
                        runtimeConfig: widget.runtimeConfig,
                        threadId: widget.threadId,
                        onChanged: widget.onRuntimeConfigChanged,
                      ),
                      const Spacer(),
                      if (widget.followUpMode)
                        _hasContent
                            ? _SendButton(onSend: _canSend ? _handleSend : null)
                            : _StopButton(onStop: _handleStop)
                      else if (widget.isRunning)
                        _StopButton(onStop: _handleStop)
                      else
                        _SendButton(onSend: _canSend ? _handleSend : null),
                    ],
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
