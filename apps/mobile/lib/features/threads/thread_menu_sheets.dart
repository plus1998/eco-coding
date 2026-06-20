import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import 'thread_providers.dart';

Future<void> showThreadTodoSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String threadId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: EcoColors.bgMenu,
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
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: EcoColors.bgMenu,
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
    backgroundColor: EcoColors.bgMenu,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 0.85,
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
    final eco = ecoThemeExtras(context);
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
    final eco = ecoThemeExtras(context);
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
    final eco = ecoThemeExtras(context);
    final icon = _todoIcon(todo.status);
    final label = _todoStatusLabel(todo.status);
    final displayTitle = todo.status == 'running' &&
            todo.detail.trim().isNotEmpty &&
            todo.detail != todo.title
        ? todo.detail
        : todo.title;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: EcoColors.bgElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: _todoIconColor(todo.status)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayTitle,
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
      return Icons.radio_button_checked_outlined;
    case 'completed':
      return Icons.check_circle_outline;
    case 'blocked':
      return Icons.error_outline;
    case 'cancelled':
      return Icons.block;
    default:
      return Icons.circle_outlined;
  }
}

Color _todoIconColor(String status) {
  switch (status) {
    case 'running':
      return EcoColors.accentText;
    case 'completed':
      return EcoColors.success;
    case 'blocked':
      return EcoColors.danger;
    default:
      return EcoColors.textMuted;
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
    return rpc.getWorkspaceDiff(widget.workspacePath);
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadDiff());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
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
                  child: ListView(
                    controller: widget.scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      _SheetHeader(
                        title: '代码审查',
                        subtitle:
                            '${diff.fileCount} 个文件 · +${diff.totalAdditions} -${diff.totalDeletions}',
                      ),
                      if (diff.files.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Center(
                            child: Text(
                              '工作区暂无未提交变更',
                              style: TextStyle(color: eco.textMuted),
                            ),
                          ),
                        )
                      else ...[
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
                                  style: const TextStyle(
                                    color: EcoColors.success,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  '-${file.deletions}',
                                  style: const TextStyle(
                                    color: EcoColors.danger,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        if (diff.patch.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text(
                            'Diff',
                            style: Theme.of(context).textTheme.labelLarge,
                          ),
                          const SizedBox(height: 8),
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: EcoColors.codeBg,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: eco.borderSubtle),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: SelectableText(
                                diff.patch,
                                style: const TextStyle(
                                  fontFamily: 'Menlo',
                                  fontFamilyFallback: ['monospace'],
                                  fontSize: 11,
                                  height: 1.45,
                                ),
                              ),
                            ),
                          ),
                          if (diff.patchTruncated)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                'Diff 已截断，完整内容请在 Desktop 查看',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: eco.textMuted),
                              ),
                            ),
                        ],
                      ],
                    ],
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
  String? _runningScript;

  @override
  void initState() {
    super.initState();
    _future = _loadScripts();
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

  Future<void> _runScript(PackageScriptInfo script) async {
    final rpc = ref.read(desktopRpcProvider);
    if (rpc == null || _runningScript != null) return;
    setState(() => _runningScript = script.name);
    try {
      final result = await rpc.startPackageScript(
        workspacePath: widget.workspacePath,
        script: script.name,
      );
      if (!mounted) return;
      final message = result.runId != null
          ? '已在 Desktop 运行 ${script.name}'
          : '已启动 ${script.name}';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _runningScript = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
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
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    controller: widget.scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
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
                          (script) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(script.name),
                            subtitle: Text(
                              script.command,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(color: eco.textMuted, fontSize: 12),
                            ),
                            trailing: _runningScript == script.name
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.play_arrow_rounded),
                            onTap: _runningScript == null
                                ? () => _runScript(script)
                                : null,
                          ),
                        ),
                    ],
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
