import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/git_models.dart';
import '../../core/models/package_script_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/storage/package_script_args_storage.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/package_script_run.dart';
import 'package_script_providers.dart';
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
  final ScrollController _outputScrollController = ScrollController();
  int _prevOutputLength = 0;
  Map<String, String> _scriptArgsByName = {};
  String? _editingScript;
  final TextEditingController _argsInputController = TextEditingController();

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
    _outputScrollController.dispose();
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
    final runState = ref.read(packageScriptRunProvider);
    if (rpc == null || (runState?.running ?? false)) {
      return;
    }
    try {
      final result = await rpc.startPackageScript(
        workspacePath: widget.workspacePath,
        script: script.name,
        args: args,
      );
      if (!mounted) return;
      if (result.runId == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已启动 ${script.name}')),
        );
        return;
      }
      ref.read(packageScriptRunProvider.notifier).beginRun(
            runId: result.runId!,
            script: result.script,
            command: result.command,
          );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  void _scrollOutputToEnd() {
    if (!_outputScrollController.hasClients) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_outputScrollController.hasClients) {
        return;
      }
      _outputScrollController.animateTo(
        _outputScrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final runState = ref.watch(packageScriptRunProvider);
    final outputLength = runState?.output.length ?? 0;
    if (outputLength > _prevOutputLength) {
      _prevOutputLength = outputLength;
      _scrollOutputToEnd();
    } else if (outputLength < _prevOutputLength) {
      _prevOutputLength = outputLength;
    }

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
                final isRunning = runState?.running ?? false;
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
                                  final scriptRunning = isRunning &&
                                      runState?.script == script.name;
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
                                          color: scriptRunning
                                              ? eco.accentText
                                              : eco.borderSubtle,
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
                                                  icon: scriptRunning
                                                      ? const SizedBox(
                                                          width: 18,
                                                          height: 18,
                                                          child:
                                                              CircularProgressIndicator(
                                                            strokeWidth: 2,
                                                          ),
                                                        )
                                                      : const Icon(
                                                          Icons
                                                              .play_arrow_rounded,
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
                    if (runState != null)
                      _PackageScriptOutputPanel(
                        runState: runState,
                        outputScrollController: _outputScrollController,
                        onStop: runState.running
                            ? () => ref
                                .read(packageScriptRunProvider.notifier)
                                .stopRun()
                            : null,
                        onClose: () => ref
                            .read(packageScriptRunProvider.notifier)
                            .clearRun(),
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

class _PackageScriptOutputPanel extends StatelessWidget {
  const _PackageScriptOutputPanel({
    required this.runState,
    required this.outputScrollController,
    this.onStop,
    required this.onClose,
  });

  final PackageScriptRunViewState runState;
  final ScrollController outputScrollController;
  final VoidCallback? onStop;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final commandText = runState.command.join(' ');
    final outputText = runState.output.isEmpty
        ? (runState.running ? '…' : '（无输出）')
        : runState.output;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.bgElevated,
        border: Border(top: BorderSide(color: eco.borderSubtle)),
      ),
      child: SizedBox(
        height: 220,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Row(
                children: [
                  Icon(
                    EcoIcons.terminal,
                    size: 16,
                    color: runState.running ? eco.accentText : eco.textMuted,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      runState.script,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: eco.textHeading,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                  if (runState.running)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: eco.accentSoft,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '运行中',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: eco.accentText,
                            ),
                      ),
                    )
                  else if (runState.exitCode != null)
                    Text(
                      'exit ${runState.exitCode}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: runState.exitCode == 0
                                ? eco.success
                                : eco.danger,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                    ),
                  if (onStop != null) ...[
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: onStop,
                      style: TextButton.styleFrom(
                        foregroundColor: eco.danger,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text('停止'),
                    ),
                  ],
                  IconButton(
                    icon: const Icon(EcoIcons.close, size: 18),
                    tooltip: '关闭输出',
                    onPressed: onClose,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: eco.borderSubtle),
            Expanded(
              child: SingleChildScrollView(
                controller: outputScrollController,
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                child: SelectableText(
                  outputText,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textSecondary,
                        fontFamily: 'Menlo',
                        height: 1.45,
                      ),
                ),
              ),
            ),
            if (commandText.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                child: Text(
                  commandText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: eco.textMuted,
                        fontFamily: 'Menlo',
                      ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
