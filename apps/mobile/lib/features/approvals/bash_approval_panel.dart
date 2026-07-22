import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/bash_approval_ui.dart';

const _circledMarkers = ['①', '②', '③', '④', '⑤'];

class BashApprovalPanel extends StatefulWidget {
  const BashApprovalPanel({
    super.key,
    required this.request,
    required this.busy,
    required this.onResolve,
    required this.onSkip,
  });

  final BashApprovalRequest request;
  final bool busy;
  final Future<void> Function({required String decision, String? feedback})
  onResolve;
  final Future<void> Function() onSkip;

  @override
  State<BashApprovalPanel> createState() => _BashApprovalPanelState();
}

class _BashApprovalPanelState extends State<BashApprovalPanel> {
  int _highlightIndex = 0;
  bool _codeExpanded = false;
  final _denyController = TextEditingController();
  final _denyFocusNode = FocusNode();

  @override
  void didUpdateWidget(covariant BashApprovalPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.request.toolUseId != widget.request.toolUseId) {
      _highlightIndex = 0;
      _codeExpanded = false;
      _denyController.clear();
    }
  }

  @override
  void dispose() {
    _denyController.dispose();
    _denyFocusNode.dispose();
    super.dispose();
  }

  List<BashApprovalChoice> get _choices {
    final choices = <BashApprovalChoice>[BashApprovalChoice.approve];
    if (widget.request.filesystemTool == null) {
      choices.add(BashApprovalChoice.approveRememberPrefix);
    }
    choices.add(BashApprovalChoice.deny);
    return choices;
  }

  bool get _denyHighlighted =>
      _choices[_highlightIndex] == BashApprovalChoice.deny;

  Future<void> _submitChoice(BashApprovalChoice choice) async {
    if (widget.busy) return;
    if (choice == BashApprovalChoice.deny) {
      final feedback = _denyController.text.trim();
      if (feedback.isEmpty) {
        _denyFocusNode.requestFocus();
        return;
      }
      await widget.onResolve(
        decision: bashApprovalDecisionValue(choice),
        feedback: feedback,
      );
      return;
    }
    await widget.onResolve(decision: bashApprovalDecisionValue(choice));
  }

  Future<void> _submitHighlighted() async {
    await _submitChoice(_choices[_highlightIndex]);
  }

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final title = resolveBashApprovalTitle(
      description: widget.request.description,
      reason: widget.request.reason,
      filesystemTool: widget.request.filesystemTool,
    );
    final detail = widget.request.filesystemTool != null
        ? '${widget.request.filesystemTool}: ${widget.request.filesystemPath}'
        : widget.request.command;
    final rememberCommand = widget.request.command.trim();

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colors.composerContextBg,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              width: 0.5,
              color: isDark
                  ? colors.borderSubtle.withValues(alpha: 0.45)
                  : const Color(0x143C3C43),
            ),
            boxShadow: [
              BoxShadow(
                color: colors.shadowScrim.withValues(
                  alpha: isDark ? 0.28 : 0.04,
                ),
                blurRadius: isDark ? 20 : 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w400,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 12),
                _CodePreview(
                  text: detail,
                  expanded: _codeExpanded,
                  surfaceColor: colors.composerContextBg,
                  onToggle: () =>
                      setState(() => _codeExpanded = !_codeExpanded),
                ),
                const SizedBox(height: 8),
                for (var i = 0; i < _choices.length; i++)
                  _buildOptionRow(
                    context: context,
                    index: i,
                    choice: _choices[i],
                    highlighted: _highlightIndex == i,
                    rememberCommand: rememberCommand,
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    TextButton(
                      onPressed: widget.busy ? null : () => widget.onSkip(),
                      style: TextButton.styleFrom(
                        foregroundColor: colors.textMuted,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                      ),
                      child: Text(widget.busy ? '处理中…' : '跳过'),
                    ),
                    const Spacer(),
                    FilledButton(
                      onPressed:
                          widget.busy ||
                              (_denyHighlighted &&
                                  _denyController.text.trim().isEmpty)
                          ? null
                          : _submitHighlighted,
                      style: FilledButton.styleFrom(
                        backgroundColor: isDark
                            ? colors.composerSendBg
                            : const Color(0xFF0D0D0D),
                        foregroundColor: isDark
                            ? colors.composerSendText
                            : Colors.white,
                        minimumSize: const Size(0, 34),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        shape: const StadiumBorder(),
                      ),
                      child: widget.busy
                          ? SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: isDark
                                    ? colors.composerSendText
                                    : Colors.white,
                              ),
                            )
                          : const Text('提交 ↵'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOptionRow({
    required BuildContext context,
    required int index,
    required BashApprovalChoice choice,
    required bool highlighted,
    required String rememberCommand,
  }) {
    final colors = ecoColors(context);

    if (choice == BashApprovalChoice.deny) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 20,
              child: Icon(
                Icons.edit_outlined,
                size: 14,
                color: colors.textMuted,
              ),
            ),
            Expanded(
              child: TextField(
                controller: _denyController,
                focusNode: _denyFocusNode,
                enabled: !widget.busy,
                maxLines: 1,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(fontSize: 14, height: 1.45),
                decoration: InputDecoration(
                  isDense: true,
                  isCollapsed: true,
                  filled: false,
                  fillColor: Colors.transparent,
                  hintText: bashApprovalDenyOptionLabel,
                  hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontSize: 14,
                    height: 1.45,
                    color: colors.textMuted,
                  ),
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  disabledBorder: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                onTap: () => setState(() => _highlightIndex = index),
                onChanged: (_) => setState(() {}),
                onSubmitted: (value) {
                  if (value.trim().isNotEmpty) {
                    _submitChoice(BashApprovalChoice.deny);
                  }
                },
              ),
            ),
          ],
        ),
      );
    }

    if (choice == BashApprovalChoice.approveRememberPrefix) {
      return Material(
        color: highlighted
            ? colors.textHeading.withValues(alpha: 0.05)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: widget.busy
              ? null
              : () {
                  setState(() => _highlightIndex = index);
                  _submitChoice(choice);
                },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
            child: Row(
              children: [
                SizedBox(
                  width: 20,
                  child: Text(
                    index < _circledMarkers.length
                        ? _circledMarkers[index]
                        : '${index + 1}.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.textMuted,
                      fontSize: 13,
                      height: 1.2,
                    ),
                  ),
                ),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontSize: 14,
                        height: 1.45,
                      ),
                      children: [
                        TextSpan(text: bashApprovalRememberPrefixIntro),
                        TextSpan(
                          text: formatBashApprovalRememberPrefix(
                            rememberCommand,
                          ),
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 13,
                            color: colors.textMuted,
                          ),
                        ),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Material(
      color: highlighted
          ? colors.textHeading.withValues(alpha: 0.05)
          : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: widget.busy
            ? null
            : () {
                setState(() => _highlightIndex = index);
                _submitChoice(choice);
              },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
          child: Row(
            children: [
              SizedBox(
                width: 20,
                child: Text(
                  index < _circledMarkers.length
                      ? _circledMarkers[index]
                      : '${index + 1}.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: colors.textMuted,
                    fontSize: 13,
                    height: 1.2,
                  ),
                ),
              ),
              const Expanded(child: Text('是')),
            ],
          ),
        ),
      ),
    );
  }
}

class _CodePreview extends StatelessWidget {
  const _CodePreview({
    required this.text,
    required this.expanded,
    required this.surfaceColor,
    required this.onToggle,
  });

  final String text;
  final bool expanded;
  final Color surfaceColor;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = ecoColors(context);
    return Stack(
      children: [
        SelectableText(
          text,
          maxLines: expanded ? null : 4,
          style: TextStyle(
            fontFamily: 'monospace',
            fontSize: 13,
            height: 1.55,
            color: colors.textMuted,
          ),
        ),
        if (!expanded)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 40,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [surfaceColor.withValues(alpha: 0), surfaceColor],
                  stops: const [0.0, 0.78],
                ),
              ),
              child: Align(
                alignment: Alignment.bottomRight,
                child: TextButton(
                  onPressed: onToggle,
                  style: TextButton.styleFrom(
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 2,
                      vertical: 0,
                    ),
                    foregroundColor: colors.textMuted,
                    textStyle: const TextStyle(fontSize: 11),
                  ),
                  child: const Text('展开'),
                ),
              ),
            ),
          )
        else
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: onToggle,
              style: TextButton.styleFrom(
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                padding: const EdgeInsets.symmetric(horizontal: 2),
                foregroundColor: colors.textMuted,
                textStyle: const TextStyle(fontSize: 11),
              ),
              child: const Text('收起'),
            ),
          ),
      ],
    );
  }
}
