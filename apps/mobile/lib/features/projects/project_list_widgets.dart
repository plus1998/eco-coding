import 'package:flutter/material.dart';

import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/relative_time.dart';
import '../../core/utils/thread_status.dart';

class ProjectListEmptyState extends StatelessWidget {
  const ProjectListEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 56),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              EcoIcons.folderOpen,
              size: 32,
              color: eco.textMuted.withValues(alpha: 0.55),
            ),
            const SizedBox(height: 20),
            Text(
              '还没有项目',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w500,
                    letterSpacing: -0.2,
                    color: eco.textSecondary,
                  ),
            ),
            const SizedBox(height: 10),
            Text(
              '点击右上角打开项目，\n输入 Desktop 上的路径即可开始。',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted.withValues(alpha: 0.85),
                    height: 1.6,
                    letterSpacing: 0.1,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class ProjectSectionCard extends StatefulWidget {
  const ProjectSectionCard({
    super.key,
    required this.project,
    required this.threads,
    required this.isCollapsed,
    required this.isPinned,
    required this.pinnedThreadIds,
    required this.onHeaderTap,
    this.onHeaderLongPress,
    required this.onNewThread,
    required this.onThreadTap,
    this.onThreadLongPress,
  });

  final EcoProject project;
  final List<ThreadSummary> threads;
  final bool isCollapsed;
  final bool isPinned;
  final Set<String> pinnedThreadIds;
  final VoidCallback onHeaderTap;
  final VoidCallback? onHeaderLongPress;
  final VoidCallback onNewThread;
  final void Function(ThreadSummary thread) onThreadTap;
  final void Function(ThreadSummary thread)? onThreadLongPress;

  @override
  State<ProjectSectionCard> createState() => _ProjectSectionCardState();
}

class _ProjectSectionCardState extends State<ProjectSectionCard> {
  var _threadsExpanded = false;

  @override
  void didUpdateWidget(covariant ProjectSectionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.path != widget.project.path ||
        oldWidget.threads.length <= projectVisibleThreadLimit) {
      _threadsExpanded = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final project = widget.project;
    final threads = widget.threads;
    final isCollapsed = widget.isCollapsed;
    final slice = sliceProjectThreads(threads, expanded: _threadsExpanded);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProjectHeader(
            project: project,
            threadCount: threads.length,
            isCollapsed: isCollapsed,
            isPinned: widget.isPinned,
            onTap: widget.onHeaderTap,
            onLongPress: widget.onHeaderLongPress,
            onNewThread: widget.onNewThread,
          ),
          AnimatedCrossFade(
            firstCurve: Curves.easeOut,
            secondCurve: Curves.easeOut,
            sizeCurve: Curves.easeInOut,
            crossFadeState: isCollapsed
                ? CrossFadeState.showFirst
                : CrossFadeState.showSecond,
            duration: const Duration(milliseconds: 180),
            firstChild: const SizedBox(width: double.infinity),
            secondChild: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (threads.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(left: 28, top: 6, bottom: 2),
                    child: Text(
                      '暂无会话',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: eco.textMuted.withValues(alpha: 0.75),
                            letterSpacing: 0.1,
                          ),
                    ),
                  )
                else ...[
                  const SizedBox(height: 4),
                  ...slice.visible.asMap().entries.map(
                        (entry) {
                          final thread = entry.value;
                          return ProjectThreadRow(
                            thread: thread,
                            isPinned: widget.pinnedThreadIds.contains(thread.id),
                            isLast: entry.key == slice.visible.length - 1 &&
                                !slice.hasMore,
                            onTap: () => widget.onThreadTap(thread),
                            onLongPress: widget.onThreadLongPress == null
                                ? null
                                : () => widget.onThreadLongPress!(thread),
                          );
                        },
                      ),
                ],
                if (slice.hasMore)
                  Padding(
                    padding: const EdgeInsets.only(left: 20, top: 4),
                    child: TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        foregroundColor: eco.textMuted,
                      ),
                      onPressed: () => setState(() => _threadsExpanded = true),
                      child: Text(
                        '还有 ${threads.length - slice.visible.length} 条',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: eco.textMuted,
                              letterSpacing: 0.2,
                            ),
                      ),
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

class _ProjectHeader extends StatelessWidget {
  const _ProjectHeader({
    required this.project,
    required this.threadCount,
    required this.isCollapsed,
    required this.isPinned,
    required this.onTap,
    this.onLongPress,
    required this.onNewThread,
  });

  final EcoProject project;
  final int threadCount;
  final bool isCollapsed;
  final bool isPinned;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback onNewThread;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTap,
              onLongPress: onLongPress,
              borderRadius: BorderRadius.circular(8),
              splashColor: eco.navHover,
              highlightColor: eco.navHover,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(
                        project.isHome
                            ? EcoIcons.home
                            : isCollapsed
                                ? EcoIcons.folder
                                : EcoIcons.folderOpen,
                        size: 16,
                        color: eco.textMuted.withValues(alpha: 0.8),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              if (isPinned) ...[
                                Icon(
                                  EcoIcons.pin,
                                  size: 11,
                                  color: eco.textMuted.withValues(alpha: 0.65),
                                ),
                                const SizedBox(width: 5),
                              ],
                              Flexible(
                                child: Text(
                                  project.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(
                                        fontSize: (Theme.of(context)
                                                    .textTheme
                                                    .titleSmall
                                                    ?.fontSize ??
                                                14) *
                                            1.2,
                                        fontWeight: FontWeight.w500,
                                        letterSpacing: -0.25,
                                        color: eco.textPrimary,
                                      ),
                                ),
                              ),
                              const SizedBox(width: 4),
                              AnimatedRotation(
                                turns: isCollapsed ? 0 : 0.25,
                                duration: const Duration(milliseconds: 180),
                                curve: Curves.easeOut,
                                child: Icon(
                                  EcoIcons.chevronRight,
                                  size: 15,
                                  color: eco.textMuted.withValues(alpha: 0.7),
                                ),
                              ),
                              if (isCollapsed && threadCount > 0) ...[
                                const SizedBox(width: 6),
                                Text(
                                  '$threadCount',
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelSmall
                                      ?.copyWith(
                                        color: eco.textMuted
                                            .withValues(alpha: 0.7),
                                        fontFeatures: const [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 3),
                          if (!project.isHome)
                            Text(
                              project.path,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
                                    color: eco.textMuted.withValues(alpha: 0.8),
                                    fontSize: 11,
                                    letterSpacing: 0.05,
                                    height: 1.3,
                                  ),
                            ),
                          if (shouldShowProjectBranch(project.branch))
                            Padding(
                              padding:
                                  EdgeInsets.only(top: project.isHome ? 0 : 3),
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: _BranchLabel(label: project.branch!),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        IconButton(
          tooltip: '新建会话',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(
            minWidth: 32,
            minHeight: 32,
          ),
          icon: Icon(
            EcoIcons.newThread,
            size: 17,
            color: eco.textMuted.withValues(alpha: 0.65),
          ),
          onPressed: onNewThread,
        ),
      ],
    );
  }
}

class _BranchLabel extends StatelessWidget {
  const _BranchLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Text(
      label,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: eco.textMuted.withValues(alpha: 0.75),
            fontSize: 10,
            letterSpacing: 0.15,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
    );
  }
}

class ProjectThreadRow extends StatelessWidget {
  const ProjectThreadRow({
    super.key,
    required this.thread,
    required this.isPinned,
    required this.isLast,
    required this.onTap,
    this.onLongPress,
  });

  final ThreadSummary thread;
  final bool isPinned;
  final bool isLast;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final title = thread.title;
    final showStatus = hasThreadStatusIndicator(thread);
    final timeLabel = formatRelativeTime(threadStatusTime(thread));

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(6),
        splashColor: eco.navHover,
        highlightColor: eco.navHover,
        child: Container(
          padding: const EdgeInsets.fromLTRB(28, 10, 4, 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: isLast
                  ? BorderSide.none
                  : BorderSide(
                      color: eco.borderSubtle.withValues(alpha: 0.45),
                    ),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (isPinned) ...[
                          Icon(
                            EcoIcons.pin,
                            size: 10,
                            color: eco.textMuted.withValues(alpha: 0.65),
                          ),
                          const SizedBox(width: 5),
                        ],
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  fontSize:
                                      (Theme.of(context).textTheme.bodyMedium?.fontSize ??
                                              13) *
                                          1.2,
                                  fontWeight: FontWeight.w400,
                                  letterSpacing: -0.1,
                                ),
                          ),
                        ),
                      ],
                    ),
                    if (thread.message.isNotEmpty && showStatus) ...[
                      const SizedBox(height: 2),
                      Text(
                        thread.message,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: eco.textMuted.withValues(alpha: 0.85),
                              height: 1.35,
                            ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              ThreadStatusIndicator(
                thread: thread,
                timeLabel: timeLabel,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ThreadStatusIndicator extends StatelessWidget {
  const ThreadStatusIndicator({
    super.key,
    required this.thread,
    required this.timeLabel,
  });

  final ThreadSummary thread;
  final String timeLabel;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    if (isThreadWaitingForApproval(thread)) {
      return Text(
        '待批准',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: eco.statusAllowText.withValues(alpha: 0.9),
              fontSize: 10,
              letterSpacing: 0.2,
            ),
      );
    }

    if (isThreadBusy(thread)) {
      return SizedBox(
        width: 13,
        height: 13,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: eco.textMuted.withValues(alpha: 0.6),
        ),
      );
    }

    if (thread.status == 'failed' || thread.status == 'blocked') {
      return Container(
        width: 5,
        height: 5,
        decoration: BoxDecoration(
          color: threadStatusDotColor(thread.status, eco)
              .withValues(alpha: 0.85),
          shape: BoxShape.circle,
        ),
      );
    }

    if (timeLabel.isEmpty) return const SizedBox.shrink();

    return Text(
      timeLabel,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: eco.textMuted.withValues(alpha: 0.7),
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
    );
  }
}
