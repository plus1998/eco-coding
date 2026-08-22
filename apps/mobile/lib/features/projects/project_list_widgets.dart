import 'package:flutter/material.dart';

import '../../core/locale/app_error_localizations.dart';
import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/project_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/relative_time.dart';
import '../../core/utils/thread_status.dart';
import '../../core/widgets/eco_grouped_list.dart';
import '../../core/widgets/eco_pressable.dart';

class ProjectListErrorState extends StatelessWidget {
  const ProjectListErrorState({
    super.key,
    required this.error,
    required this.onRetry,
  });

  final Object error;
  final VoidCallback onRetry;

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
              EcoIcons.error,
              size: 40,
              color: eco.textMuted.withValues(alpha: 0.45),
            ),
            const SizedBox(height: 20),
            Text(
              context.l10n.threadsLoadFailedTitle,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: eco.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              localizedAppError(error, context.l10n),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: eco.textMuted,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: onRetry,
              icon: Icon(EcoIcons.refresh, size: 18, color: eco.accent),
              label: Text(context.l10n.commonRetry),
            ),
          ],
        ),
      ),
    );
  }
}

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
              size: 40,
              color: eco.textMuted.withValues(alpha: 0.45),
            ),
            const SizedBox(height: 20),
            Text(
              context.l10n.projectNoProjects,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: eco.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              context.l10n.projectNoProjectsHint,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: eco.textMuted,
                height: 1.45,
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
      padding: const EdgeInsets.only(bottom: 8),
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
          AnimatedSize(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: isCollapsed
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: EcoGroupedSurface(
                      child: threads.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              child: Text(
                                context.l10n.threadNoSessions,
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(color: eco.textMuted),
                              ),
                            )
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                ...slice.visible.asMap().entries.map((entry) {
                                  final thread = entry.value;
                                  final isLast =
                                      entry.key == slice.visible.length - 1 &&
                                      !slice.hasMore;
                                  return Column(
                                    children: [
                                      ProjectThreadRow(
                                        thread: thread,
                                        isPinned: widget.pinnedThreadIds
                                            .contains(thread.id),
                                        onTap: () => widget.onThreadTap(thread),
                                        onLongPress:
                                            widget.onThreadLongPress == null
                                            ? null
                                            : () => widget.onThreadLongPress!(
                                                thread,
                                              ),
                                      ),
                                      // When hasMore, last visible row is not isLast →
                                      // this already draws the hairline above “还有 x 条”.
                                      if (!isLast)
                                        const EcoGroupedDivider(
                                          indent: 16,
                                          soft: true,
                                        ),
                                    ],
                                  );
                                }),
                                if (slice.hasMore)
                                  EcoGroupedTile(
                                    onTap: () =>
                                        setState(() => _threadsExpanded = true),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 12,
                                    ),
                                    child: Text(
                                      context.l10n.projectMoreThreads(
                                        threads.length - slice.visible.length,
                                      ),
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyMedium
                                          ?.copyWith(
                                            color: eco.accent,
                                            fontWeight: FontWeight.w500,
                                          ),
                                    ),
                                  ),
                              ],
                            ),
                    ),
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

    return Padding(
      padding: const EdgeInsets.fromLTRB(ecoGroupedHorizontalInset, 12, 8, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: EcoPressable(
              onTap: onTap,
              onLongPress: onLongPress,
              borderRadius: BorderRadius.circular(10),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                child: Row(
                  children: [
                    Icon(
                      project.isHome
                          ? EcoIcons.home
                          : isCollapsed
                          ? EcoIcons.folder
                          : EcoIcons.folderOpen,
                      size: 18,
                      color: eco.accent,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              if (isPinned) ...[
                                Icon(
                                  EcoIcons.pin,
                                  size: 12,
                                  color: eco.textMuted,
                                ),
                                const SizedBox(width: 5),
                              ],
                              Flexible(
                                child: Text(
                                  project.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.titleSmall
                                      ?.copyWith(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        letterSpacing: 0.1,
                                        color: eco.textMuted,
                                      ),
                                ),
                              ),
                              const SizedBox(width: 4),
                              AnimatedRotation(
                                turns: isCollapsed ? 0 : 0.25,
                                duration: const Duration(milliseconds: 220),
                                curve: Curves.easeOutCubic,
                                child: Icon(
                                  EcoIcons.chevronRight,
                                  size: 14,
                                  color: eco.textMuted.withValues(alpha: 0.7),
                                ),
                              ),
                              if (isCollapsed && threadCount > 0) ...[
                                const SizedBox(width: 6),
                                Text(
                                  '$threadCount',
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(
                                        color: eco.textMuted,
                                        fontFeatures: const [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                ),
                              ],
                            ],
                          ),
                          if (!project.isHome) ...[
                            const SizedBox(height: 2),
                            SizedBox(
                              width: double.infinity,
                              child: Text(
                                project.path,
                                maxLines: 1,
                                softWrap: false,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.labelSmall
                                    ?.copyWith(
                                      color: eco.textMuted.withValues(
                                        alpha: 0.75,
                                      ),
                                      fontSize: 11,
                                    ),
                              ),
                            ),
                          ],
                          if (shouldShowProjectBranch(project.branch))
                            Padding(
                              padding: EdgeInsets.only(
                                top: project.isHome ? 2 : 2,
                              ),
                              child: SizedBox(
                                width: double.infinity,
                                child: Text(
                                  project.branch!,
                                  maxLines: 1,
                                  softWrap: false,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(
                                        color: eco.textMuted.withValues(
                                          alpha: 0.7,
                                        ),
                                        fontSize: 11,
                                        fontFeatures: const [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                ),
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
          EcoPressable(
            onTap: onNewThread,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Icon(EcoIcons.newThread, size: 20, color: eco.accent),
            ),
          ),
        ],
      ),
    );
  }
}

class ProjectThreadRow extends StatelessWidget {
  const ProjectThreadRow({
    super.key,
    required this.thread,
    required this.isPinned,
    required this.onTap,
    this.onLongPress,
  });

  final ThreadSummary thread;
  final bool isPinned;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final title = thread.title;
    final showStatus = hasThreadStatusIndicator(thread);
    final timeLabel = formatRelativeTime(
      threadStatusTime(thread),
      context.l10n,
    );

    return EcoGroupedTile(
      onTap: onTap,
      onLongPress: onLongPress,
      padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (isPinned) ...[
                      Icon(EcoIcons.pin, size: 11, color: eco.textMuted),
                      const SizedBox(width: 5),
                    ],
                    Expanded(
                      child: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontSize: 17,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ],
                ),
                if (thread.message.isNotEmpty && showStatus) ...[
                  const SizedBox(height: 3),
                  Text(
                    thread.message,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.3,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          ThreadStatusIndicator(thread: thread, timeLabel: timeLabel),
        ],
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
        context.l10n.projectAwaitingApproval,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: eco.statusAllowText,
          fontWeight: FontWeight.w500,
          letterSpacing: 0.1,
        ),
      );
    }

    if (isThreadBusy(thread)) {
      return SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: eco.textMuted.withValues(alpha: 0.55),
        ),
      );
    }

    if (thread.status == 'failed' || thread.status == 'blocked') {
      return Container(
        width: 6,
        height: 6,
        decoration: BoxDecoration(
          color: threadStatusDotColor(thread.status, eco),
          shape: BoxShape.circle,
        ),
      );
    }

    if (timeLabel.isEmpty) return const SizedBox.shrink();

    return Text(
      timeLabel,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
        color: eco.textMuted,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}
