import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/theme/eco_theme.dart';
import '../threads/thread_providers.dart';

Future<bool?> showCommitPushSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
  required String profileId,
  required WorkspaceDiffResult diff,
  String? branch,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      minChildSize: 0.45,
      maxChildSize: 0.92,
      builder: (context, scrollController) => CommitPushSheet(
        workspacePath: workspacePath,
        profileId: profileId,
        diff: diff,
        branch: branch,
        scrollController: scrollController,
      ),
    ),
  );
}

class CommitPushSheet extends ConsumerStatefulWidget {
  const CommitPushSheet({
    super.key,
    required this.workspacePath,
    required this.profileId,
    required this.diff,
    this.branch,
    required this.scrollController,
  });

  final String workspacePath;
  final String profileId;
  final WorkspaceDiffResult diff;
  final String? branch;
  final ScrollController scrollController;

  @override
  ConsumerState<CommitPushSheet> createState() => _CommitPushSheetState();
}

class _CommitPushSheetState extends ConsumerState<CommitPushSheet> {
  final _messageController = TextEditingController();
  bool _generating = false;
  bool _committing = false;
  String? _error;

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  DesktopRpc? get _rpc => ref.read(desktopRpcProvider);

  Future<void> _generateMessage() async {
    final rpc = _rpc;
    if (rpc == null || _generating) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final result = await rpc.generateCommitMessage(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
      );
      _messageController.text = result.message;
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  Future<void> _commitAndPush() async {
    final rpc = _rpc;
    if (rpc == null || _committing) return;
    setState(() {
      _committing = true;
      _error = null;
    });
    try {
      final message = _messageController.text.trim();
      await rpc.commitChanges(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
        message: message.isEmpty ? null : message,
      );
      await rpc.pushChanges(
        workspacePath: widget.workspacePath,
        branch: widget.branch,
      );
      ref.invalidate(workspaceDiffProvider(widget.workspacePath));
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _committing = false);
    }
  }

  Future<void> _commitOnly() async {
    final rpc = _rpc;
    if (rpc == null || _committing) return;
    setState(() {
      _committing = true;
      _error = null;
    });
    try {
      final message = _messageController.text.trim();
      await rpc.commitChanges(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
        message: message.isEmpty ? null : message,
      );
      ref.invalidate(workspaceDiffProvider(widget.workspacePath));
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _committing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final diff = widget.diff;

    return SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: ecoColors(context).borderSubtle,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '提交变更',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${diff.fileCount} 个文件 · +${diff.totalAdditions} -${diff.totalDeletions}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: ecoColors(context).textMuted,
                            ),
                      ),
                    ],
                  ),
                ),
                if (widget.branch != null && widget.branch!.isNotEmpty)
                  Chip(
                    label: Text(widget.branch!),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: widget.scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                ...diff.files.map(
                  (file) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(
                      file.path,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '+${file.additions}',
                          style: TextStyle(
                            color: ecoColors(context).success,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          '-${file.deletions}',
                          style: TextStyle(
                            color: ecoColors(context).danger,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _messageController,
                  minLines: 3,
                  maxLines: 6,
                  decoration: InputDecoration(
                    hintText: '提交信息（留空则 AI 生成）',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    suffixIcon: IconButton(
                      onPressed: _generating ? null : _generateMessage,
                      icon: _generating
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.auto_awesome, size: 20),
                      tooltip: 'AI 生成提交信息',
                    ),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: TextStyle(color: ecoColors(context).statusDenyText, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 16),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              children: [
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _committing ? null : _commitAndPush,
                    icon: _committing
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Theme.of(context).colorScheme.onPrimary,
                            ),
                          )
                        : const Icon(Icons.cloud_upload_outlined),
                    label: Text(_committing ? '处理中…' : '提交并推送'),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: _committing ? null : _commitOnly,
                    child: const Text('仅提交'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
