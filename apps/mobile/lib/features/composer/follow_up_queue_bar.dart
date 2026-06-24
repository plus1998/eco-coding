import 'package:flutter/material.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/thread_follow_up_ui.dart';
import 'composer_context_menu.dart';
import 'composer_stack_card.dart';

class FollowUpQueueBar extends StatelessWidget {
  const FollowUpQueueBar({
    super.key,
    required this.followUps,
    required this.cancelBusyId,
    required this.escalateBusyId,
    required this.onEscalate,
    required this.onEdit,
    required this.onDelete,
  });

  final List<ThreadPendingFollowUp> followUps;
  final String? cancelBusyId;
  final String? escalateBusyId;
  final Future<void> Function(ThreadPendingFollowUp followUp) onEscalate;
  final void Function(ThreadPendingFollowUp followUp) onEdit;
  final Future<void> Function(ThreadPendingFollowUp followUp) onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: composerStackOuterPadding,
      child: Column(
        children: [
          for (var index = 0; index < followUps.length; index++) ...[
            if (index > 0) const SizedBox(height: composerStackItemGap),
            _FollowUpQueueItem(
              followUp: followUps[index],
              cancelBusyId: cancelBusyId,
              escalateBusyId: escalateBusyId,
              onEscalate: onEscalate,
              onEdit: onEdit,
              onDelete: onDelete,
            ),
          ],
        ],
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
  });

  final ThreadPendingFollowUp followUp;
  final String? cancelBusyId;
  final String? escalateBusyId;
  final Future<void> Function(ThreadPendingFollowUp followUp) onEscalate;
  final void Function(ThreadPendingFollowUp followUp) onEdit;
  final Future<void> Function(ThreadPendingFollowUp followUp) onDelete;

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
    final textStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: eco.composerPillText,
          fontSize: 13,
          height: 1.2,
        );

    return ComposerStackCard(
      stadium: true,
      padding: composerStackRowPadding,
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _actionBusy ? null : () => widget.onEdit(widget.followUp),
              child: Row(
                children: [
                  Icon(
                    EcoIcons.indent,
                    size: 14,
                    color: eco.composerPillText,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      formatThreadFollowUpPreview(widget.followUp),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textStyle,
                    ),
                  ),
                ],
              ),
            ),
          ),
          GestureDetector(
            key: _menuKey,
            onTap: _actionBusy ? null : _showMenu,
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.only(left: 4),
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
    );
  }
}
