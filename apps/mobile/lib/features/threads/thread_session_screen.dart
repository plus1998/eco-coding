import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../approvals/approval_sheets.dart';
import '../composer/composer_mode_bar.dart';
import 'thread_providers.dart';

class ThreadSessionScreen extends ConsumerStatefulWidget {
  const ThreadSessionScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ThreadSessionScreen> createState() =>
      _ThreadSessionScreenState();
}

class _ThreadSessionScreenState extends ConsumerState<ThreadSessionScreen> {
  final _promptController = TextEditingController();
  final _scrollController = ScrollController();
  final _attachments = <PromptImageAttachment>[];
  final _picker = ImagePicker();
  String? _shownApprovalKey;

  @override
  void initState() {
    super.initState();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String? _approvalKey(ThreadSessionState session) {
    if (session.pendingPlan != null) {
      return 'plan:${session.pendingPlan!.threadId}';
    }
    if (session.pendingBash != null) {
      return 'bash:${session.pendingBash!.toolUseId}';
    }
    if (session.pendingClarification != null) {
      return 'clarification:${session.pendingClarification!.toolUseId}';
    }
    return null;
  }

  @override
  void dispose() {
    _promptController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(threadSessionProvider(widget.threadId));
    final runtimeConfig =
        ref.watch(runtimeConfigProvider) ??
        session.thread?.runtimeConfig ??
        _emptyRuntimeConfig();

    ref.listen(threadSessionProvider(widget.threadId), (previous, next) {
      if (next.loading) return;
      final key = _approvalKey(next);
      if (key != null && key != _shownApprovalKey) {
        _shownApprovalKey = key;
        _showApprovalSheets(next);
      }
      if (previous?.activities.length != next.activities.length) {
        _scrollToBottom();
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(
          session.thread?.title.isNotEmpty == true
              ? session.thread!.title
              : '会话',
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (value) => _handleMenu(value),
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'cancel', child: Text('取消运行')),
              PopupMenuItem(value: 'retry', child: Text('重试')),
              PopupMenuItem(value: 'refresh', child: Text('刷新待办')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: session.loading
                ? const Center(child: CircularProgressIndicator())
                : session.error != null
                ? Center(child: Text(session.error!))
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(12),
                    itemCount: session.activities.length,
                    itemBuilder: (context, index) {
                      final item = session.activities[index];
                      return _ActivityBubble(item: item);
                    },
                  ),
          ),
          if (session.followUps.isNotEmpty)
            _FollowUpBar(
              followUps: session.followUps,
              onCancel: (id) async {
                await ref.read(desktopRpcProvider)?.followUpCancel(id);
                await ref
                    .read(threadSessionProvider(widget.threadId).notifier)
                    .refreshPending();
              },
            ),
          ComposerModeBar(
            runtimeConfig: runtimeConfig,
            threadId: widget.threadId,
            onChanged: (config) {
              ref.read(runtimeConfigProvider.notifier).state = config;
            },
          ),
          _ComposerInput(
            controller: _promptController,
            attachments: _attachments,
            onPickImage: _pickImage,
            onRemoveAttachment: (index) =>
                setState(() => _attachments.removeAt(index)),
            onSend: () => _sendMessage(runtimeConfig),
          ),
        ],
      ),
    );
  }

  ThreadRuntimeConfigInput _emptyRuntimeConfig() {
    final subagents = {for (final role in subagentRoles) role: false};
    return ThreadRuntimeConfig(
      routeProfileId: '',
      subagentEnabled: subagents,
      planModeEnabled: false,
      bashReviewMode: 'always',
    );
  }

  Future<void> _pickImage() async {
    final file = await _picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() {
      _attachments.add(
        PromptImageAttachment(
          mediaType: 'image/${file.path.split('.').last}',
          data: base64Encode(bytes),
        ),
      );
    });
  }

  Future<void> _sendMessage(ThreadRuntimeConfigInput runtimeConfig) async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;

    try {
      await rpc.continueThread(
        threadId: widget.threadId,
        prompt: prompt,
        attachments: _attachments.isEmpty ? null : List.of(_attachments),
        runtimeConfig: runtimeConfig,
      );
      _promptController.clear();
      setState(() => _attachments.clear());
      ref.invalidate(threadListProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _handleMenu(String value) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return;
    final notifier = ref.read(threadSessionProvider(widget.threadId).notifier);
    try {
      switch (value) {
        case 'cancel':
          await rpc.cancelThread(widget.threadId);
        case 'retry':
          await rpc.retryThread(widget.threadId);
        case 'refresh':
          await notifier.refreshPending();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  void _showApprovalSheets(ThreadSessionState session) {
    if (session.pendingPlan != null) {
      showPlanApprovalSheet(
        context: context,
        plan: session.pendingPlan!,
        onApprove: () => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .approvePlan(),
        onDismiss: () => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .dismissPlan(),
      );
    } else if (session.pendingBash != null) {
      showBashApprovalSheet(
        context: context,
        request: session.pendingBash!,
        onResolve: (decision) => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .resolveBash(session.pendingBash!.toolUseId, decision),
      );
    } else if (session.pendingClarification != null) {
      showClarificationSheet(
        context: context,
        request: session.pendingClarification!,
        onSubmit: (selections) => ref
            .read(threadSessionProvider(widget.threadId).notifier)
            .submitClarification(
              session.pendingClarification!.toolUseId,
              selections,
            ),
      );
    }
  }
}

class _ActivityBubble extends StatelessWidget {
  const _ActivityBubble({required this.item});

  final ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final isUser = item.role == 'user';
    final eco = ecoThemeExtras(context);
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.85,
        ),
        decoration: BoxDecoration(
          color: isUser ? eco.userBubble : eco.assistantBubble,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: eco.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item.role,
              style: Theme.of(
                context,
              ).textTheme.labelSmall?.copyWith(color: eco.textMuted),
            ),
            const SizedBox(height: 4),
            Text(item.message),
          ],
        ),
      ),
    );
  }
}

class _FollowUpBar extends StatelessWidget {
  const _FollowUpBar({required this.followUps, required this.onCancel});

  final List<ThreadPendingFollowUp> followUps;
  final Future<void> Function(String id) onCancel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.cardSurface,
        border: Border(top: BorderSide(color: eco.borderSubtle)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Follow-up 队列', style: Theme.of(context).textTheme.labelLarge),
            ...followUps.map(
              (item) => ListTile(
                dense: true,
                title: Text(
                  item.prompt,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(item.status),
                trailing: item.status == 'queued'
                    ? IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => onCancel(item.id),
                      )
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerInput extends StatelessWidget {
  const _ComposerInput({
    required this.controller,
    required this.attachments,
    required this.onPickImage,
    required this.onRemoveAttachment,
    required this.onSend,
  });

  final TextEditingController controller;
  final List<PromptImageAttachment> attachments;
  final VoidCallback onPickImage;
  final void Function(int index) onRemoveAttachment;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: EcoColors.bgElevated,
          border: Border(
            top: BorderSide(color: ecoThemeExtras(context).borderSubtle),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (attachments.isNotEmpty)
                SizedBox(
                  height: 48,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: attachments.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (context, index) => InputChip(
                      label: Text('图片 ${index + 1}'),
                      onDeleted: () => onRemoveAttachment(index),
                    ),
                  ),
                ),
              Row(
                children: [
                  IconButton(
                    onPressed: onPickImage,
                    icon: const Icon(Icons.image_outlined),
                  ),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      minLines: 1,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        hintText: '发送消息…',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: onSend,
                    style: IconButton.styleFrom(
                      backgroundColor: EcoColors.composerSendBg,
                      foregroundColor: EcoColors.composerSendText,
                    ),
                    icon: const Icon(Icons.arrow_upward, size: 20),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
