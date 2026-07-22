import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_modal_sheet.dart';
import '../threads/thread_providers.dart';

Future<String?> showCommitPushSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
  required String profileId,
  required WorkspaceDiffResult diff,
  required GitWorkingTreeStatus gitStatus,
}) {
  return showEcoModalBottomSheet<String>(
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
        gitStatus: gitStatus,
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
    required this.gitStatus,
    required this.scrollController,
  });

  final String workspacePath;
  final String profileId;
  final WorkspaceDiffResult diff;
  final GitWorkingTreeStatus gitStatus;
  final ScrollController scrollController;

  @override
  ConsumerState<CommitPushSheet> createState() => _CommitPushSheetState();
}

enum _CommitPushAction { commit, commitPush, push }

enum _CommitPushPhase { committing, pushing }

class _CommitPushSheetState extends ConsumerState<CommitPushSheet> {
  final _messageController = TextEditingController();
  bool _generating = false;
  _CommitPushAction? _activeAction;
  _CommitPushPhase? _phase;
  bool _loadingModels = false;
  bool _includeUnstaged = true;
  bool _branchBusy = false;
  String? _error;
  List<CommitModelOptionView> _modelOptions = [];
  String? _selectedCandidateModelId;
  late GitWorkingTreeStatus _gitStatus;
  late WorkspaceDiffResult _diff;

  bool get _busy => _activeAction != null;

  @override
  void initState() {
    super.initState();
    _gitStatus = widget.gitStatus;
    _diff = widget.diff;
    _loadModelOptions();
  }

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  DesktopRpc? get _rpc => ref.read(desktopRpcProvider);

  Future<void> _loadModelOptions() async {
    final rpc = _rpc;
    if (rpc == null) return;
    setState(() => _loadingModels = true);
    try {
      final result = await rpc.listCommitModelOptions(
        profileId: widget.profileId,
      );
      String? selectedId;
      if (result.savedCandidateModelId != 'auto') {
        selectedId = result.savedCandidateModelId;
      }
      selectedId ??= result.options.isNotEmpty
          ? result.options.first.candidateModelId
          : null;
      if (selectedId != null &&
          result.options.every(
            (option) => option.candidateModelId != selectedId,
          )) {
        selectedId = result.options.isNotEmpty
            ? result.options.first.candidateModelId
            : null;
      }
      if (!mounted) return;
      setState(() {
        _modelOptions = result.options;
        _selectedCandidateModelId = selectedId;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loadingModels = false);
    }
  }

  CommitModelOptionView? get _selectedModelOption {
    final selectedId = _selectedCandidateModelId;
    if (selectedId == null) return null;
    for (final option in _modelOptions) {
      if (option.candidateModelId == selectedId) {
        return option;
      }
    }
    return null;
  }

  Future<void> _generateMessage() async {
    final rpc = _rpc;
    if (rpc == null || _generating || _busy || _branchBusy) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final result = await rpc.generateCommitMessage(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
        includeUnstaged: _includeUnstaged,
        candidateModelId: _selectedCandidateModelId,
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
    if (rpc == null || _busy) return;
    setState(() {
      _activeAction = _CommitPushAction.commitPush;
      _phase = _CommitPushPhase.committing;
      _error = null;
    });
    var committed = false;
    try {
      final message = _messageController.text.trim();
      await rpc.commitChanges(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
        includeUnstaged: _includeUnstaged,
        message: message.isEmpty ? null : message,
        candidateModelId: message.isEmpty ? _selectedCandidateModelId : null,
      );
      committed = true;
      if (mounted) {
        refreshWorkspaceChanges(ref, widget.workspacePath);
        setState(() => _phase = _CommitPushPhase.pushing);
      }
      await rpc.pushChanges(
        workspacePath: widget.workspacePath,
        branch: _gitStatus.branch,
      );
      if (mounted) {
        refreshWorkspaceChanges(ref, widget.workspacePath);
        Navigator.of(context).pop('commit-push');
      }
    } catch (error) {
      if (committed && mounted) {
        await _refreshGitState();
      }
      if (mounted) {
        setState(
          () => _error = committed ? '提交已完成，但推送失败：$error' : error.toString(),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _activeAction = null;
          _phase = null;
        });
      }
    }
  }

  Future<void> _commitOnly() async {
    final rpc = _rpc;
    if (rpc == null || _busy) return;
    setState(() {
      _activeAction = _CommitPushAction.commit;
      _phase = _CommitPushPhase.committing;
      _error = null;
    });
    try {
      final message = _messageController.text.trim();
      await rpc.commitChanges(
        workspacePath: widget.workspacePath,
        profileId: widget.profileId,
        includeUnstaged: _includeUnstaged,
        message: message.isEmpty ? null : message,
        candidateModelId: message.isEmpty ? _selectedCandidateModelId : null,
      );
      if (mounted) {
        refreshWorkspaceChanges(ref, widget.workspacePath);
        Navigator.of(context).pop('commit');
      }
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _activeAction = null;
          _phase = null;
        });
      }
    }
  }

  Future<void> _pushOnly() async {
    final rpc = _rpc;
    if (rpc == null || _busy) return;
    setState(() {
      _activeAction = _CommitPushAction.push;
      _phase = _CommitPushPhase.pushing;
      _error = null;
    });
    try {
      await rpc.pushChanges(
        workspacePath: widget.workspacePath,
        branch: _gitStatus.branch,
      );
      if (mounted) {
        refreshWorkspaceChanges(ref, widget.workspacePath);
        Navigator.of(context).pop('push');
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _activeAction = null;
          _phase = null;
        });
      }
    }
  }

  Future<void> _refreshGitState() async {
    final rpc = _rpc;
    if (rpc == null) return;
    try {
      final status = await rpc.getGitStatus(widget.workspacePath);
      final diff = await rpc.getWorkspaceDiff(widget.workspacePath);
      if (!mounted) return;
      setState(() {
        _gitStatus = status;
        _diff = diff;
      });
    } catch (_) {
      // The original git action error remains the useful message.
    }
  }

  Future<void> _pickBranch() async {
    if (_branchBusy || _busy || _generating) return;
    final selection = await showEcoModalBottomSheet<String>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Text('提交到', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final branch in _gitStatus.branches)
                    ListTile(
                      leading: const Icon(EcoIcons.branch, size: 18),
                      title: Text(branch),
                      trailing: branch == _gitStatus.branch
                          ? const Icon(EcoIcons.check, size: 18)
                          : null,
                      onTap: () => Navigator.pop(sheetContext, branch),
                    ),
                  ListTile(
                    leading: const Icon(EcoIcons.add, size: 18),
                    title: const Text('新分支'),
                    onTap: () => Navigator.pop(sheetContext, ''),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (selection == null || !mounted) return;
    if (selection.isEmpty) {
      await _createBranch();
      return;
    }
    if (selection == _gitStatus.branch) return;

    final rpc = _rpc;
    if (rpc == null) return;
    setState(() {
      _branchBusy = true;
      _error = null;
    });
    try {
      final status = await rpc.checkoutGitBranch(
        workspacePath: widget.workspacePath,
        branch: selection,
      );
      final diff = await rpc.getWorkspaceDiff(widget.workspacePath);
      if (!mounted) return;
      setState(() {
        _gitStatus = status;
        _diff = diff;
      });
      refreshWorkspaceChanges(ref, widget.workspacePath);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _branchBusy = false);
    }
  }

  Future<void> _createBranch() async {
    final controller = TextEditingController();
    final branch = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('新建分支'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(hintText: '分支名称'),
          onSubmitted: (value) => Navigator.pop(dialogContext, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('创建'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (branch == null || branch.isEmpty || !mounted) return;

    final rpc = _rpc;
    if (rpc == null) return;
    setState(() {
      _branchBusy = true;
      _error = null;
    });
    try {
      final status = await rpc.createGitBranch(
        workspacePath: widget.workspacePath,
        branch: branch,
      );
      final diff = await rpc.getWorkspaceDiff(widget.workspacePath);
      if (!mounted) return;
      setState(() {
        _gitStatus = status;
        _diff = diff;
      });
      refreshWorkspaceChanges(ref, widget.workspacePath);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _branchBusy = false);
    }
  }

  Future<void> _pickModel() async {
    if (_modelOptions.isEmpty || _loadingModels) return;
    final selected = await showEcoModalBottomSheet<String>(
      context: context,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Text('选择生成模型', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _modelOptions.length,
                  itemBuilder: (context, index) {
                    final option = _modelOptions[index];
                    final isActive =
                        option.candidateModelId == _selectedCandidateModelId;
                    return ListTile(
                      leading: CircleAvatar(
                        radius: 6,
                        backgroundColor: _parseColor(option.providerColor),
                      ),
                      title: Text(option.modelLabel),
                      subtitle: Text(
                        [
                          option.providerName,
                          if (option.hint?.pricingLabel?.trim().isNotEmpty ==
                              true)
                            option.hint!.pricingLabel!.trim(),
                        ].join(' · '),
                      ),
                      trailing: isActive ? const Icon(Icons.check) : null,
                      onTap: () =>
                          Navigator.of(context).pop(option.candidateModelId),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
    if (selected != null && mounted) {
      setState(() => _selectedCandidateModelId = selected);
    }
  }

  Color _parseColor(String raw) {
    final value = raw.trim();
    if (value.startsWith('#') && value.length == 7) {
      final hex = value.substring(1);
      final parsed = int.tryParse(hex, radix: 16);
      if (parsed != null) {
        return Color(0xFF000000 | parsed);
      }
    }
    return ecoColors(context).textMuted;
  }

  @override
  Widget build(BuildContext context) {
    final diff = _diff;
    final showModelPicker = _messageController.text.trim().isEmpty;
    final selectedModel = _selectedModelOption;
    final canCommit = _gitStatus.canCommit;
    final canPushOnly = _gitStatus.isGitRepository && _gitStatus.aheadCount > 0;
    final controlsBusy = _busy || _generating || _branchBusy;

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
                OutlinedButton.icon(
                  onPressed: controlsBusy ? null : _pickBranch,
                  icon: _branchBusy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(EcoIcons.branch, size: 16),
                  label: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 128),
                    child: Text(
                      _gitStatus.branch ?? 'detached',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: widget.scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                if (showModelPicker) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed:
                        controlsBusy || _loadingModels || _modelOptions.isEmpty
                        ? null
                        : _pickModel,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            _loadingModels
                                ? '加载模型…'
                                : selectedModel == null
                                ? '未配置模型'
                                : '${selectedModel.providerName} · ${selectedModel.modelLabel}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const Icon(Icons.expand_more, size: 18),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _messageController,
                  minLines: 3,
                  maxLines: 6,
                  enabled: !controlsBusy,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: '提交信息（留空则 AI 生成）',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    suffixIcon: IconButton(
                      onPressed: controlsBusy || !canCommit
                          ? null
                          : _generateMessage,
                      icon: _generating
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(EcoIcons.sparkles, size: 20),
                      tooltip: 'AI 生成提交信息',
                    ),
                  ),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('包含未暂存的更改'),
                  value: _includeUnstaged,
                  onChanged: controlsBusy
                      ? null
                      : (value) =>
                            setState(() => _includeUnstaged = value ?? true),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: ecoColors(context).statusDenyText,
                      fontSize: 13,
                    ),
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
                  child: OutlinedButton.icon(
                    onPressed: controlsBusy || !canCommit ? null : _commitOnly,
                    icon: const Icon(EcoIcons.commitPush, size: 18),
                    label: Text(
                      _activeAction == _CommitPushAction.commit ? '提交中…' : '提交',
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: controlsBusy || !canCommit
                        ? null
                        : _commitAndPush,
                    icon: _activeAction == _CommitPushAction.commitPush
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Theme.of(context).colorScheme.onPrimary,
                            ),
                          )
                        : const Icon(EcoIcons.cloudUpload),
                    label: Text(
                      _activeAction == _CommitPushAction.commitPush
                          ? (_phase == _CommitPushPhase.pushing
                                ? '推送中…'
                                : '提交中…')
                          : '提交并推送',
                    ),
                  ),
                ),
                if (canPushOnly) ...[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: controlsBusy ? null : _pushOnly,
                      icon: _activeAction == _CommitPushAction.push
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(EcoIcons.cloudUpload, size: 18),
                      label: Text(
                        _activeAction == _CommitPushAction.push
                            ? '推送中…'
                            : '仅推送（领先 ${_gitStatus.aheadCount}）',
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
