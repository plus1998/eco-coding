import 'package:flutter/material.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/eco_modal_sheet.dart';

const _maxThreadResults = 10;
const _maxProjectResults = 8;

class ThreadSearchSelection {
  const ThreadSearchSelection.thread(this.thread) : project = null;

  const ThreadSearchSelection.project(this.project) : thread = null;

  final ThreadSummary? thread;
  final EcoProject? project;
}

Future<ThreadSearchSelection?> showThreadSearchSheet({
  required BuildContext context,
  required List<ThreadSummary> threads,
  required List<EcoProject> projects,
}) {
  return showEcoModalBottomSheet<ThreadSearchSelection>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: ecoColors(context).bgMain,
    builder: (sheetContext) =>
        _ThreadSearchSheet(threads: threads, projects: projects),
  );
}

class _ThreadSearchSheet extends StatefulWidget {
  const _ThreadSearchSheet({required this.threads, required this.projects});

  final List<ThreadSummary> threads;
  final List<EcoProject> projects;

  @override
  State<_ThreadSearchSheet> createState() => _ThreadSearchSheetState();
}

class _ThreadSearchSheetState extends State<_ThreadSearchSheet> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _searchController.text.trim().toLowerCase();
    final sortedThreads = [...widget.threads]
      ..sort((left, right) => right.updatedAt.compareTo(left.updatedAt));
    final matchingThreads = sortedThreads
        .where(
          (thread) =>
              query.isEmpty || thread.title.toLowerCase().contains(query),
        )
        .toList();
    final runningThreads = matchingThreads
        .where((thread) => thread.status == 'running')
        .toList();
    final recentThreads = matchingThreads
        .where((thread) => thread.status != 'running')
        .take(_maxThreadResults)
        .toList();
    final matchingProjects = widget.projects
        .where(
          (project) =>
              query.isEmpty ||
              project.name.toLowerCase().contains(query) ||
              project.path.toLowerCase().contains(query),
        )
        .take(_maxProjectResults)
        .toList();
    final projectNames = {
      for (final project in widget.projects)
        normalizeProjectPath(project.path): project.name,
    };
    final hasResults =
        runningThreads.isNotEmpty ||
        recentThreads.isNotEmpty ||
        matchingProjects.isNotEmpty;

    return FractionallySizedBox(
      heightFactor: 0.86,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: ecoColors(context).textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: TextField(
              controller: _searchController,
              autofocus: true,
              textInputAction: TextInputAction.search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: '搜索会话标题或项目',
                prefixIcon: const Icon(EcoIcons.search, size: 19),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清除',
                        icon: const Icon(EcoIcons.close, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {});
                        },
                      ),
              ),
            ),
          ),
          Expanded(
            child: hasResults
                ? ListView(
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      if (runningThreads.isNotEmpty)
                        _SearchResultSection(
                          label: '正在运行',
                          children: [
                            for (final thread in runningThreads)
                              _ThreadSearchRow(
                                thread: thread,
                                projectName:
                                    projectNames[normalizeProjectPath(
                                      thread.workspacePath,
                                    )] ??
                                    _projectBasename(thread.workspacePath),
                                onTap: () => Navigator.pop(
                                  context,
                                  ThreadSearchSelection.thread(thread),
                                ),
                              ),
                          ],
                        ),
                      if (recentThreads.isNotEmpty)
                        _SearchResultSection(
                          label: '会话',
                          children: [
                            for (final thread in recentThreads)
                              _ThreadSearchRow(
                                thread: thread,
                                projectName:
                                    projectNames[normalizeProjectPath(
                                      thread.workspacePath,
                                    )] ??
                                    _projectBasename(thread.workspacePath),
                                onTap: () => Navigator.pop(
                                  context,
                                  ThreadSearchSelection.thread(thread),
                                ),
                              ),
                          ],
                        ),
                      if (matchingProjects.isNotEmpty)
                        _SearchResultSection(
                          label: '项目',
                          children: [
                            for (final project in matchingProjects)
                              _ProjectSearchRow(
                                project: project,
                                onTap: () => Navigator.pop(
                                  context,
                                  ThreadSearchSelection.project(project),
                                ),
                              ),
                          ],
                        ),
                    ],
                  )
                : Center(
                    child: Text(
                      '没有匹配的会话或项目',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: ecoColors(context).textMuted,
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _SearchResultSection extends StatelessWidget {
  const _SearchResultSection({required this.label, required this.children});

  final String label;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return EcoGroupedSection(
      label: label,
      topSpacing: 14,
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0) const EcoGroupedDivider(indent: 48),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _ThreadSearchRow extends StatelessWidget {
  const _ThreadSearchRow({
    required this.thread,
    required this.projectName,
    required this.onTap,
  });

  final ThreadSummary thread;
  final String projectName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return EcoGroupedTile(
      onTap: onTap,
      child: Row(
        children: [
          Icon(
            thread.status == 'running' ? EcoIcons.active : EcoIcons.sessions,
            size: 17,
            color: thread.status == 'running'
                ? ecoColors(context).accent
                : ecoColors(context).textMuted,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  thread.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  projectName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Icon(
            EcoIcons.chevronRight,
            size: 16,
            color: ecoColors(context).textMuted,
          ),
        ],
      ),
    );
  }
}

class _ProjectSearchRow extends StatelessWidget {
  const _ProjectSearchRow({required this.project, required this.onTap});

  final EcoProject project;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return EcoGroupedTile(
      onTap: onTap,
      child: Row(
        children: [
          Icon(
            project.isHome ? EcoIcons.home : EcoIcons.folder,
            size: 17,
            color: ecoColors(context).accent,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  project.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  project.path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: ecoColors(context).textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Icon(
            EcoIcons.chevronRight,
            size: 16,
            color: ecoColors(context).textMuted,
          ),
        ],
      ),
    );
  }
}

String _projectBasename(String path) {
  final normalized = normalizeProjectPath(path);
  final segments = normalized.split('/').where((part) => part.isNotEmpty);
  return segments.isEmpty ? '项目' : segments.last;
}
