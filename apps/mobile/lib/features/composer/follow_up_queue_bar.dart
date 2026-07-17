import 'dart:convert';
import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import 'composer_context_menu.dart';

class FollowUpQueueBar extends StatelessWidget {
  const FollowUpQueueBar({
    super.key,
    required this.followUps,
    required this.cancelBusyId,
    required this.escalateBusyId,
    required this.onEscalate,
    required this.onEdit,
    required this.onDelete,
    required this.onReorder,
  });

  final List<ThreadPendingFollowUp> followUps;
  final String? cancelBusyId;
  final String? escalateBusyId;
  final Future<void> Function(ThreadPendingFollowUp followUp) onEscalate;
  final void Function(ThreadPendingFollowUp followUp) onEdit;
  final Future<void> Function(ThreadPendingFollowUp followUp) onDelete;
  final Future<void> Function(int oldIndex, int newIndex) onReorder;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Transform.translate(
      offset: const Offset(0, 18),
      transformHitTests: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: eco.composerContextBg.withValues(
                  alpha: isDark ? 0.58 : 0.52,
                ),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(16),
                ),
                border: Border.all(
                  width: 0.5,
                  color: isDark
                      ? eco.borderSubtle.withValues(alpha: 0.42)
                      : const Color(0x143C3C43),
                ),
                boxShadow: [
                  BoxShadow(
                    color: eco.shadowScrim.withValues(
                      alpha: isDark ? 0.16 : 0.04,
                    ),
                    blurRadius: 24,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 160),
                child: ReorderableListView.builder(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 16),
                  buildDefaultDragHandles: false,
                  itemCount: followUps.length,
                  onReorder: onReorder,
                  itemBuilder: (context, index) => Column(
                    key: ValueKey(followUps[index].id),
                    children: [
                      if (index > 0)
                        Divider(height: 5, color: eco.borderSubtle),
                      _FollowUpQueueItem(
                        followUp: followUps[index],
                        cancelBusyId: cancelBusyId,
                        escalateBusyId: escalateBusyId,
                        onEscalate: onEscalate,
                        onEdit: onEdit,
                        onDelete: onDelete,
                        dragHandle: ReorderableDragStartListener(
                          index: index,
                          child: _FollowUpDragHandle(
                            color: eco.composerPillText.withValues(alpha: 0.82),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FollowUpDragHandle extends StatelessWidget {
  const _FollowUpDragHandle({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '拖动调整消息顺序',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Icon(Icons.drag_indicator_rounded, size: 16, color: color),
      ),
    );
  }
}

class _FollowUpQueueItem extends StatefulWidget {
  const _FollowUpQueueItem({
    required this.followUp,
    required this.cancelBusyId,
    required this.escalateBusyId,
    required this.onEscalate,
    required this.onEdit,
    required this.onDelete,
    required this.dragHandle,
  });

  final ThreadPendingFollowUp followUp;
  final String? cancelBusyId;
  final String? escalateBusyId;
  final Future<void> Function(ThreadPendingFollowUp followUp) onEscalate;
  final void Function(ThreadPendingFollowUp followUp) onEdit;
  final Future<void> Function(ThreadPendingFollowUp followUp) onDelete;
  final Widget dragHandle;

  @override
  State<_FollowUpQueueItem> createState() => _FollowUpQueueItemState();
}

class _FollowUpQueueItemState extends State<_FollowUpQueueItem> {
  final _menuKey = GlobalKey();

  bool get _actionBusy =>
      widget.cancelBusyId == widget.followUp.id ||
      widget.escalateBusyId == widget.followUp.id;

  bool get _canEscalate => widget.followUp.priority != 'escalated';

  void _showMenu() {
    if (_actionBusy) return;

    final entries = <ComposerContextMenuEntry>[
      if (_canEscalate)
        ComposerContextMenuEntry(
          value: 'escalate',
          icon: EcoIcons.indent,
          label: widget.escalateBusyId == widget.followUp.id ? '处理中…' : '引导',
          enabled: !_actionBusy,
        ),
      const ComposerContextMenuEntry(
        value: 'edit',
        icon: EcoIcons.edit,
        label: '修改',
      ),
      ComposerContextMenuEntry(
        value: 'delete',
        icon: EcoIcons.delete,
        label: widget.cancelBusyId == widget.followUp.id ? '删除中…' : '删除',
        enabled: !_actionBusy,
        danger: true,
      ),
    ];

    showComposerContextMenu(
      context: context,
      anchorKey: _menuKey,
      entries: entries,
      onSelected: (value) {
        switch (value) {
          case 'escalate':
            if (_canEscalate) {
              widget.onEscalate(widget.followUp);
            }
          case 'edit':
            widget.onEdit(widget.followUp);
          case 'delete':
            widget.onDelete(widget.followUp);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final attachments = widget.followUp.attachments;
    final textStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: eco.composerPillText,
      fontSize: 13,
      height: 1.25,
    );

    return Semantics(
      label: '已排队的引导消息',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _actionBusy ? null : () => widget.onEdit(widget.followUp),
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            child: Row(
              children: [
                widget.dragHandle,
                const SizedBox(width: 6),
                if (attachments.isNotEmpty) ...[
                  SizedBox(
                    width: 30,
                    height: 30,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(7),
                      child: Image.memory(
                        base64Decode(attachments.first.data),
                        fit: BoxFit.cover,
                        gaplessPlayback: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 7),
                ],
                Expanded(
                  child: Text(
                    formatThreadFollowUpPreview(widget.followUp),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textStyle,
                  ),
                ),
                GestureDetector(
                  key: _menuKey,
                  onTap: _actionBusy ? null : _showMenu,
                  behavior: HitTestBehavior.opaque,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(8, 5, 2, 5),
                    child: Icon(
                      EcoIcons.more,
                      size: 14,
                      color: _actionBusy
                          ? eco.composerPillText.withValues(alpha: 0.4)
                          : eco.composerPillText,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
