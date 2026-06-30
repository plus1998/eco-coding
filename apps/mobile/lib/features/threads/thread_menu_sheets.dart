import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/storage/package_script_args_storage.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/package_script_run.dart';
import '../projects/project_providers.dart';
import 'workspace_diff_review_view.dart';
import 'thread_providers.dart';

Future<void> showThreadTodoSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String threadId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.35,
      maxChildSize: 0.85,
      builder: (context, scrollController) => _ThreadTodoSheet(
        threadId: threadId,
        scrollController: scrollController,
      ),
    ),
  );
}

Future<void> showWorkspaceDiffReviewSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
}) {
  refreshWorkspaceChanges(ref, workspacePath);
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      minChildSize: 0.45,
      maxChildSize: 0.92,
      builder: (context, scrollController) => _WorkspaceDiffReviewSheet(
        workspacePath: workspacePath,
        scrollController: scrollController,
      ),
    ),
  );
}

Future<void> showNpmScriptsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String workspacePath,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      minChildSize: 0.35,
      maxChildSize: 0.92,
      builder: (context, scrollController) => _NpmScriptsSheet(
        workspacePath: workspacePath,
        scrollController: scrollController,
      ),
    ),
  );
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ThreadTodoSheet extends ConsumerStatefulWidget {
  const _ThreadTodoSheet({
    required this.threadId,
    required this.scrollController,
  });

  final String threadId;
  final ScrollController scrollController;

  @override
  ConsumerState<_ThreadTodoSheet> createState() => _ThreadTodoSheetState();
}

class _ThreadTodoSheetState extends ConsumerState<_ThreadTodoSheet> {
  late Future<List<CoderTodoItem>> _future;

  @override
  void initState() {
    super.initState();
    _future = _loadTodos();
  }

  Future<List<CoderTodoItem>> _loadTodos() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) return const [];
    final todos = await rpc.listThreadTodos(widget.threadId);
    todos.sort((left, right) => left.position.compareTo(right.position));
    return todos;
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadTodos());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 12),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: eco.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          _SheetHeader(title: '任务进度'),
          Expanded(
            child: FutureBuilder<List<CoderTodoItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(child: Text(snapshot.error.toString()));
                }
                final todos = snapshot.data ?? const [];
                if (todos.isEmpty) {
                  return Center(
                    child: Text(
                      '暂无任务列表',
                      style: TextStyle(color: eco.textMuted),
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView.separated(
                    controller: widget.scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    itemCount: todos.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final todo = todos[index];
                      return _TodoRow(todo: todo);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TodoRow extends StatelessWidget {
  const _TodoRow({required this.todo});

  final CoderTodoItem todo;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final icon = _todoIcon(todo.status);
    final label = _todoStatusLabel(todo.status);
    final displayTitle = todo.status == 'running' &&
            todo.detail.trim().isNotEmpty &&
            todo.detail != todo.title
        ? todo.detail
        : todo.title;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.bgElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: _todoIconColor(todo.status, eco)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '#${todo.position + 1} $displayTitle',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    label,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                        ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _todoIcon(String status) {
  switch (status) {
    case 'running':
      return EcoIcons.active;
    case 'completed':
      return EcoIcons.checkCircle;
    case 'blocked':
      return EcoIcons.error;
    case 'cancelled':
      return EcoIcons.blocked;
    default:
      return EcoIcons.pending;
  }
}

Color _todoIconColor(String status, EcoColors colors) {
  switch (status) {
    case 'running':
      return colors.accentText;
    case 'completed':
      return colors.success;
    case 'blocked':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

String _todoStatusLabel(String status) {
  switch (status) {
    case 'running':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'blocked':
      return '受阻';
    case 'cancelled':
      return '已停止';
    default:
      return '待执行';
  }
}

class _WorkspaceDiffReviewSheet extends ConsumerStatefulWidget {
  const _WorkspaceDiffReviewSheet({
    required this.workspacePath,
    required this.scrollController,
  });

  final String workspacePath;
  final ScrollController scrollController;

  @override
  ConsumerState<_WorkspaceDiffReviewSheet> createState() =>
      _WorkspaceDiffReviewSheetState();
}

class _WorkspaceDiffReviewSheetState
    extends ConsumerState<_WorkspaceDiffReviewSheet> {
  late Future<WorkspaceDiffResult> _future;

  @override
  void initState() {
    super.initState();
    _future = _loadDiff();
  }

  Future<WorkspaceDiffResult> _loadDiff() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      throw StateError('未连接 Desktop');
    }
    final diff = await rpc.getWorkspaceDiff(widget.workspacePath);
    refreshWorkspaceChanges(ref, widget.workspacePath);
    return diff;
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadDiff());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 12),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: eco.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<WorkspaceDiffResult>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(child: Text(snapshot.error.toString()));
                }
                final diff = snapshot.data!;
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: WorkspaceDiffReviewView(
                    diff: diff,
                    scrollController: widget.scrollController,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _NpmScriptsSheet extends ConsumerStatefulWidget {
  const _NpmScriptsSheet({
    required this.workspacePath,
    required this.scrollController,
  });

  final String workspacePath;
  final ScrollController scrollController;

  @override
  ConsumerState<_NpmScriptsSheet> createState() => _NpmScriptsSheetState();
}

class _NpmScriptsSheetState extends ConsumerState<_NpmScriptsSheet> {
  late Future<PackageScriptsListResult> _future;
  Map<String, String> _scriptArgsByName = {};
  String? _editingScript;
  final TextEditingController _argsInputController = TextEditingController();
  bool _running = false;

  @override
  void initState() {
    super.initState();
    _future = _loadScripts();
    _loadScriptArgs();
  }

  Future<void> _loadScriptArgs() async {
    final args = await readWorkspaceScriptArgs(widget.workspacePath);
    if (!mounted) return;
    setState(() => _scriptArgsByName = args);
  }

  Future<void> _commitScriptArgs(String scriptName, String nextArgs) async {
    final saved = await saveScriptArgs(
      widget.workspacePath,
      scriptName,
      nextArgs,
    );
    if (!mounted) return;
    setState(() {
      _scriptArgsByName = saved;
      _editingScript = null;
      _argsInputController.clear();
    });
  }

  void _openArgsEditor(String scriptName) {
    _argsInputController.text = _scriptArgsByName[scriptName] ?? '';
    setState(() => _editingScript = scriptName);
  }

  @override
  void dispose() {
    _argsInputController.dispose();
    super.dispose();
  }

  Future<PackageScriptsListResult> _loadScripts() async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null) {
      throw StateError('未连接 Desktop');
    }
    return rpc.listPackageScripts(widget.workspacePath);
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadScripts());
    await _future;
  }

  Future<void> _runScript(
    PackageScriptInfo script, {
    required String packageManager,
    String? args,
  }) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null || _running) {
      return;
    }
    setState(() => _running = true);
    try {
      await rpc.startPackageScript(
        workspacePath: widget.workspacePath,
        script: script.name,
        args: args,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已在 Desktop 终端中启动 ${script.name}')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) {
        setState(() => _running = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 12),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: eco.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<PackageScriptsListResult>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(child: Text(snapshot.error.toString()));
                }
                final listing = snapshot.data!;
                final subtitle = listing.packageName != null
                    ? '${listing.packageName} · ${listing.packageManager}'
                    : listing.packageManager;
                final isRunning = _running;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView(
                          controller: widget.scrollController,
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                          children: [
                            _SheetHeader(title: 'npm scripts', subtitle: subtitle),
                            if (!listing.hasPackageJson || listing.scripts.isEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 24),
                                child: Center(
                                  child: Text(
                                    '未找到 package.json scripts',
                                    style: TextStyle(color: eco.textMuted),
                                  ),
                                ),
                              )
                            else
                              ...listing.scripts.map(
                                (script) {
                                  final savedArgs =
                                      _scriptArgsByName[script.name] ?? '';
                                  final isEditingArgs =
                                      _editingScript == script.name;
                                  final displayCommand = savedArgs.isNotEmpty
                                      ? formatRunCommand(
                                          listing.packageManager,
                                          script.name,
                                          savedArgs,
                                        )
                                      : script.command;
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        color: eco.bgElevated,
                                        borderRadius: BorderRadius.circular(10),
                                        border: Border.all(
                                          color: eco.borderSubtle,
                                        ),
                                      ),
                                      child: Padding(
                                        padding: const EdgeInsets.fromLTRB(
                                          12,
                                          10,
                                          8,
                                          10,
                                        ),
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.stretch,
                                          children: [
                                            Row(
                                              children: [
                                                Expanded(
                                                  child: Text(
                                                    script.name,
                                                    style: Theme.of(context)
                                                        .textTheme
                                                        .titleSmall,
                                                  ),
                                                ),
                                                IconButton(
                                                  tooltip: savedArgs.isNotEmpty
                                                      ? '附加参数：$savedArgs'
                                                      : '附加参数',
                                                  icon: Icon(
                                                    EcoIcons.rename,
                                                    size: 18,
                                                    color: savedArgs.isNotEmpty ||
                                                            isEditingArgs
                                                        ? eco.accentText
                                                        : eco.textMuted,
                                                  ),
                                                  onPressed: isRunning
                                                      ? null
                                                      : () {
                                                          if (isEditingArgs) {
                                                            _commitScriptArgs(
                                                              script.name,
                                                              _argsInputController
                                                                  .text,
                                                            );
                                                            return;
                                                          }
                                                          _openArgsEditor(
                                                            script.name,
                                                          );
                                                        },
                                                ),
                                                IconButton(
                                                  tooltip: '运行',
                                                  icon: const Icon(
                                                    Icons.play_arrow_rounded,
                                                    size: 22,
                                                  ),
                                                  onPressed: isRunning
                                                      ? null
                                                      : () => _runScript(
                                                            script,
                                                            packageManager:
                                                                listing
                                                                    .packageManager,
                                                            args: savedArgs
                                                                    .isNotEmpty
                                                                ? savedArgs
                                                                : null,
                                                          ),
                                                ),
                                              ],
                                            ),
                                            if (isEditingArgs)
                                              Padding(
                                                padding: const EdgeInsets.only(
                                                  top: 8,
                                                ),
                                                child: TextField(
                                                  controller: _argsInputController,
                                                  autofocus: true,
                                                  decoration:
                                                      const InputDecoration(
                                                    isDense: true,
                                                    hintText: '附加参数',
                                                    border: OutlineInputBorder(),
                                                  ),
                                                  enabled: !isRunning,
                                                  onSubmitted: (value) =>
                                                      _commitScriptArgs(
                                                    script.name,
                                                    value,
                                                  ),
                                                ),
                                              )
                                            else
                                              Text(
                                                displayCommand,
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .bodySmall
                                                    ?.copyWith(
                                                      color: eco.textMuted,
                                                      fontSize: 12,
                                                    ),
                                              ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  );
                                },
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

Future<void> showThreadActionSheet({
  required BuildContext context,
  required WidgetRef ref,
  required ThreadSummary thread,
}) {
  final isPinned = ref.read(pinnedThreadIdsProvider.notifier).isPinned(thread.id);

  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: ecoColors(context).bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                thread.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
            ),
            ListTile(
              leading: Icon(
                EcoIcons.pin,
                size: 20,
                color: ecoColors(context).textSecondary,
              ),
              title: Text(isPinned ? '取消置顶' : '置顶'),
              onTap: () async {
                Navigator.pop(sheetContext);
                if (isPinned) {
                  await ref
                      .read(pinnedThreadIdsProvider.notifier)
                      .unpin(thread.id);
                } else {
                  await ref.read(pinnedThreadIdsProvider.notifier).pin(thread.id);
                }
              },
            ),
            ListTile(
              leading: Icon(
                EcoIcons.delete,
                size: 20,
                color: ecoColors(context).statusDenyText,
              ),
              title: Text(
                '删除会话',
                style: TextStyle(color: ecoColors(context).statusDenyText),
              ),
              onTap: () async {
                Navigator.pop(sheetContext);
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (dialogContext) {
                    return AlertDialog(
                      title: const Text('删除会话'),
                      content: Text('确定删除「${thread.title}」？此操作不可撤销。'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(dialogContext, false),
                          child: const Text('取消'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(dialogContext, true),
                          child: Text(
                            '删除',
                            style: TextStyle(
                              color: ecoColors(context).statusDenyText,
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                );
                if (confirmed != true || !context.mounted) return;

                final messenger = ScaffoldMessenger.of(context);
                try {
                  final rpc = ref.read(desktopRpcProvider);
                  if (rpc == null) {
                    throw StateError('未选择 PC');
                  }
                  await rpc.deleteThread(thread.id);
                  await ref
                      .read(pinnedThreadIdsProvider.notifier)
                      .remove(thread.id);
                  await ref.read(threadListProvider.notifier).refresh();
                  if (context.mounted) {
                    messenger.showSnackBar(
                      const SnackBar(content: Text('会话已删除')),
                    );
                  }
                } catch (error) {
                  if (context.mounted) {
                    messenger.showSnackBar(
                      SnackBar(content: Text(error.toString())),
                    );
                  }
                }
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      );
    },
  );
}
