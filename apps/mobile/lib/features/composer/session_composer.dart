import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_usage_models.dart';
import '../../core/platform/system_speech_recognizer.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/speech_text.dart';
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
    this.contextSnapshot,
    this.threadStatus,
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
  final ThreadContextSnapshot? contextSnapshot;
  final String? threadStatus;

  @override
  ConsumerState<SessionComposer> createState() => _SessionComposerState();
}

class _SessionComposerState extends ConsumerState<SessionComposer> {
  final _focusNode = FocusNode();
  bool _speechBusy = false;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_handleControllerChanged);
  }

  @override
  void didUpdateWidget(covariant SessionComposer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_handleControllerChanged);
      widget.controller.addListener(_handleControllerChanged);
    }
  }

  void _handleControllerChanged() {
    setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_handleControllerChanged);
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

  Future<void> _handleSpeechInput() async {
    final recognizer = ref.read(systemSpeechRecognizerProvider);
    if (_speechBusy) {
      try {
        await recognizer.stop();
      } catch (error) {
        if (mounted) {
          _showSnack(error.toString());
        }
      }
      return;
    }

    setState(() => _speechBusy = true);
    try {
      final text = await recognizer.recognize();
      if (!mounted) return;
      if (text.isEmpty) {
        _showSnack('未识别到语音内容');
        return;
      }
      final merged = mergeRecognizedSpeechText(
        currentText: widget.controller.text,
        selection: widget.controller.selection,
        recognizedText: text,
      );
      widget.controller.value = TextEditingValue(
        text: merged.text,
        selection: TextSelection.collapsed(offset: merged.selectionOffset),
      );
      _focusNode.requestFocus();
    } catch (error) {
      if (mounted) {
        _showSnack(error.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _speechBusy = false);
      }
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final canEditConfig = !widget.isRunning;
    final speechAvailable =
        ref.watch(systemSpeechRecognizerAvailabilityProvider).valueOrNull ==
        true;
    final showSpeechInput = speechAvailable || _speechBusy;

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
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: EcoColors.composerContextBg,
                borderRadius: BorderRadius.circular(22),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.22),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.12),
                    blurRadius: 2,
                    offset: const Offset(0, 1),
                  ),
                ],
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
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
                            separatorBuilder: (_, _) =>
                                const SizedBox(width: 8),
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
                        hintText:
                            widget.inputHint ??
                            (widget.followUpMode
                                ? '要求后续变更'
                                : (widget.hasActivity ? '跟进' : '发送消息…')),
                        filled: false,
                        fillColor: Colors.transparent,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        disabledBorder: InputBorder.none,
                        errorBorder: InputBorder.none,
                        focusedErrorBorder: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                        hintStyle: TextStyle(color: eco.textMuted),
                      ),
                      style: const TextStyle(
                        fontSize: 16,
                        height: 1.35,
                        color: EcoColors.textHeading,
                        backgroundColor: Colors.transparent,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        IconButton(
                          onPressed: widget.onPickImage,
                          icon: const Icon(Icons.add, size: 22),
                          tooltip: '添加图片',
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(
                            minWidth: 36,
                            minHeight: 36,
                          ),
                        ),
                        ComposerPlanModeIconButton(
                          runtimeConfig: widget.runtimeConfig,
                          threadId: widget.threadId,
                          canEdit: canEditConfig,
                          onChanged: widget.onRuntimeConfigChanged,
                        ),
                        ComposerBashReviewIconButton(
                          runtimeConfig: widget.runtimeConfig,
                          threadId: widget.threadId,
                          onChanged: widget.onRuntimeConfigChanged,
                        ),
                        const Spacer(),
                        ComposerRouteSummary(
                          runtimeConfig: widget.runtimeConfig,
                          threadId: widget.threadId,
                          canEdit: canEditConfig,
                          onChanged: widget.onRuntimeConfigChanged,
                          contextSnapshot: widget.contextSnapshot,
                          threadStatus: widget.threadStatus,
                        ),
                        const SizedBox(width: 2),
                        if (showSpeechInput) ...[
                          IconButton(
                            onPressed: _handleSpeechInput,
                            icon: _speechBusy
                                ? const Icon(
                                    Icons.stop_circle_outlined,
                                    size: 22,
                                  )
                                : const Icon(Icons.mic_none, size: 22),
                            tooltip: _speechBusy ? '停止语音输入' : '语音输入',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 36,
                              minHeight: 36,
                            ),
                            color: _speechBusy ? eco.statusDenyText : null,
                          ),
                          const SizedBox(width: 2),
                        ],
                        if (widget.followUpMode)
                          _hasContent
                              ? _SendButton(
                                  onSend: _canSend ? _handleSend : null,
                                )
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
    final enabled = onSend != null;
    return Material(
      color: enabled ? EcoColors.composerSendBg : EcoColors.borderSubtle,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onSend,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 36,
          height: 36,
          child: Icon(
            Icons.arrow_upward_rounded,
            size: 20,
            color: enabled ? EcoColors.composerSendText : EcoColors.textMuted,
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
      color: const Color(0xFF1D1D1F),
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onStop,
        customBorder: const CircleBorder(),
        child: const SizedBox(
          width: 36,
          height: 36,
          child: Center(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.all(Radius.circular(2.5)),
              ),
              child: SizedBox(width: 12, height: 12),
            ),
          ),
        ),
      ),
    );
  }
}
