import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/models/thread_run_projection.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/models/thread_models.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/file_change.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/utils/stream_text.dart';
import '../../core/utils/subagent_projection_feed.dart';
import '../../core/utils/subagent_session_timing.dart';
import '../../core/widgets/eco_markdown.dart';
import '../../core/widgets/shimmer_text.dart';
import 'projection_activity_feed.dart';

enum ActivityFeedKind {
  user,
  clarificationAnswer,
  assistant,
  thinking,
  action,
  phase,
  subagentMission,
  error,
}

class ActivityFeedEntry {
  const ActivityFeedEntry({
    required this.id,
    required this.kind,
    required this.text,
    this.actionIcon,
    this.subagentRole,
    this.detail,
    this.streaming = false,
    this.usageBadge,
    this.lifecycle,
    this.missionPrompt,
    this.agentId,
    this.running = false,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
    this.bashRun,
    this.fileChange,
    this.toolUseId,
    this.reconnecting = false,
  });

  final String id;
  final ActivityFeedKind kind;
  final String text;
  final ActivityActionIcon? actionIcon;
  final String? subagentRole;
  final String? detail;
  final bool streaming;
  final String? usageBadge;
  final ToolActionLifecycle? lifecycle;
  final String? missionPrompt;
  final String? agentId;
  final bool running;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;
  final BashRunCardDisplay? bashRun;
  final FileChangeCardDisplay? fileChange;
  final String? toolUseId;
  final bool reconnecting;
}

bool isProjectionFeedReady(ThreadRunProjectionSnapshot? projection) {
  return projection != null && projection.sourceEventCount > 0;
}

List<ActivityFeedEntry> buildActivityFeed({
  String? threadPrompt,
  String? threadId,
  ThreadRunProjectionSnapshot? runProjection,
  List<ThreadSubagentSessionTiming> subagentSessions = const [],
}) {
  if (!isProjectionFeedReady(runProjection)) {
    return const [];
  }
  return buildProjectionActivityFeed(
    projection: runProjection!,
    threadPrompt: threadPrompt,
    threadId: threadId,
    subagentSessions: subagentSessions,
  );
}

class ActivityFeedList extends StatelessWidget {
  const ActivityFeedList({
    super.key,
    required this.entries,
    required this.scrollController,
    this.topPadding = 8,
    this.agentProfile,
  });

  final List<ActivityFeedEntry> entries;
  final ScrollController scrollController;
  final double topPadding;
  final OrchestrationProfile? agentProfile;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: ListView.builder(
        controller: scrollController,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(12, topPadding, 12, 12),
        cacheExtent: 600,
        itemCount: entries.length,
        itemBuilder: (context, index) {
          final entry = entries[index];
          return _ActivityFeedEntryTile(
            key: ValueKey(entry.id),
            entry: entry,
            agentProfile: agentProfile,
          );
        },
      ),
    );
  }
}

class _ActivityFeedEntryTile extends StatelessWidget {
  const _ActivityFeedEntryTile({
    super.key,
    required this.entry,
    this.agentProfile,
  });

  final ActivityFeedEntry entry;
  final OrchestrationProfile? agentProfile;

  @override
  Widget build(BuildContext context) {
    switch (entry.kind) {
      case ActivityFeedKind.user:
        return _UserPromptTile(text: entry.text);
      case ActivityFeedKind.clarificationAnswer:
        return _ClarificationAnswerTile(text: entry.text);
      case ActivityFeedKind.assistant:
        return _AssistantNarrativeTile(
          text: entry.text,
          streaming: entry.streaming,
          usageBadge: entry.usageBadge,
        );
      case ActivityFeedKind.thinking:
        return _ThinkingTile(text: entry.text, streaming: entry.streaming);
      case ActivityFeedKind.action:
        return _ActionTile(
          label: entry.text,
          icon: entry.actionIcon ?? ActivityActionIcon.file,
          lifecycle: entry.lifecycle,
          bashRun: entry.bashRun,
          fileChange: entry.fileChange,
        );
      case ActivityFeedKind.phase:
        if (entry.reconnecting) {
          return _ReconnectPhaseTile(summary: entry.text, detail: entry.detail);
        }
        return _PhaseTile(text: entry.text, detail: entry.detail);
      case ActivityFeedKind.subagentMission:
        return _SubagentMissionTile(
          role: entry.subagentRole ?? '',
          summary: entry.text,
          prompt: entry.missionPrompt,
          agentId: entry.agentId,
          agentProfile: agentProfile,
          running: entry.running,
          durationMs: entry.durationMs,
          statusText: entry.statusText,
          timeline: entry.timeline,
        );
      case ActivityFeedKind.error:
        return _ErrorTile(text: entry.text);
    }
  }
}

class _UserPromptTile extends StatefulWidget {
  const _UserPromptTile({required this.text});

  final String text;

  @override
  State<_UserPromptTile> createState() => _UserPromptTileState();
}

class _UserPromptTileState extends State<_UserPromptTile> {
  static const _collapsedMaxLines = 5;

  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final maxBubbleWidth = MediaQuery.of(context).size.width * 0.88;
    const horizontalPadding = 28.0;
    final textStyle = Theme.of(
      context,
    ).textTheme.bodyMedium?.copyWith(height: 1.45, color: eco.textPrimary);

    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxBubbleWidth),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: eco.userBubble,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: eco.borderSubtle),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final bodyMaxWidth = (constraints.maxWidth - horizontalPadding)
                  .clamp(0.0, maxBubbleWidth - horizontalPadding);
              final canExpand = _textExceedsLineLimit(
                text: widget.text,
                style: textStyle,
                maxWidth: bodyMaxWidth,
                maxLines: _collapsedMaxLines,
                textDirection: Directionality.of(context),
              );
              final showCollapsed = canExpand && !_expanded;

              return IntrinsicWidth(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Stack(
                      children: [
                        AnimatedSize(
                          duration: const Duration(milliseconds: 150),
                          curve: Curves.easeOut,
                          alignment: Alignment.topRight,
                          child: Text(
                            widget.text,
                            maxLines: showCollapsed ? _collapsedMaxLines : null,
                            overflow: showCollapsed
                                ? TextOverflow.ellipsis
                                : null,
                            style: textStyle,
                          ),
                        ),
                        if (showCollapsed)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 40,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                borderRadius: const BorderRadius.vertical(
                                  bottom: Radius.circular(8),
                                ),
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    eco.userBubble.withValues(alpha: 0),
                                    eco.userBubble,
                                  ],
                                  stops: const [0, 0.72],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                    if (canExpand)
                      Align(
                        alignment: Alignment.center,
                        child: TextButton(
                          onPressed: () =>
                              setState(() => _expanded = !_expanded),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            visualDensity: VisualDensity.compact,
                          ),
                          child: Text(
                            _expanded ? '收起' : '展开全文',
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(color: eco.textMuted),
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ClarificationAnswerTile extends StatelessWidget {
  const _ClarificationAnswerTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final rows = parseClarificationAnswersSummary(text) ?? const [];
    final eco = ecoColors(context);

    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.88,
        ),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          decoration: BoxDecoration(
            color: eco.userBubble,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: eco.borderSubtle),
          ),
          child: IntrinsicWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '澄清回答',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: eco.textMuted,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 10),
                for (var index = 0; index < rows.length; index++) ...[
                  if (index > 0) const SizedBox(height: 10),
                  Text(
                    rows[index].question,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    rows[index].answer.isEmpty ? '（未选择）' : rows[index].answer,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: eco.textPrimary,
                      height: 1.45,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantNarrativeTile extends StatelessWidget {
  const _AssistantNarrativeTile({
    required this.text,
    this.streaming = false,
    this.usageBadge,
  });

  final String text;
  final bool streaming;
  final String? usageBadge;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty && usageBadge != null) {
      return _UsageBadgeLine(badge: usageBadge!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text.isNotEmpty)
            streaming
                ? Text(
                    text,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: ecoColors(context).textHeading,
                      height: 1.55,
                    ),
                  )
                : EcoMarkdown(text: text, selectable: false),
          if (usageBadge != null) ...[
            const SizedBox(height: 6),
            _UsageBadgeLine(badge: usageBadge!),
          ],
          if (streaming && text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '…',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).textMuted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ThinkingTile extends StatefulWidget {
  const _ThinkingTile({required this.text, this.streaming = false});

  final String text;
  final bool streaming;

  @override
  State<_ThinkingTile> createState() => _ThinkingTileState();
}

class _ThinkingTileState extends State<_ThinkingTile> {
  var _collapsed = false;

  bool get _hasBody => widget.text.trim().isNotEmpty;

  bool get _expanded =>
      (widget.streaming && _hasBody) || (!_collapsed && _hasBody);

  @override
  void initState() {
    super.initState();
    _collapsed = !widget.streaming && widget.text.trim().isNotEmpty;
  }

  @override
  void didUpdateWidget(covariant _ThinkingTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.streaming && _hasBody) {
      _collapsed = false;
    } else if (oldWidget.streaming &&
        !widget.streaming &&
        _hasBody &&
        !_collapsed) {
      _collapsed = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.streaming && !_hasBody) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
        child: ShimmerText(
          text: '正在思考',
          style: Theme.of(context).textTheme.bodySmall,
          baseColor: ecoColors(context).textMuted,
          highlightColor: ecoColors(context).textSecondary,
        ),
      );
    }

    final preview = _hasBody ? thinkingPreviewLine(widget.text) : '';
    final showPreview = _hasBody && _collapsed && !widget.streaming;
    final labelStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
      color: ecoColors(context).textMuted,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.2,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: ecoColors(context).cardSurface.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: ecoColors(context).borderSubtle.withValues(alpha: 0.8),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: widget.streaming && !_hasBody
                    ? null
                    : () {
                        if (widget.streaming || !_hasBody) return;
                        setState(() => _collapsed = !_collapsed);
                      },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      if (widget.streaming && !_hasBody)
                        ShimmerText(
                          text: '正在思考',
                          style: labelStyle,
                          baseColor: ecoColors(context).textMuted,
                          highlightColor: ecoColors(context).textSecondary,
                        )
                      else
                        Text('思考', style: labelStyle),
                      if (showPreview) ...[
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            preview,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: ecoColors(
                                    context,
                                  ).textMuted.withValues(alpha: 0.85),
                                  height: 1.3,
                                ),
                          ),
                        ),
                      ],
                      if (_hasBody && !widget.streaming) ...[
                        const Spacer(),
                        Icon(
                          _expanded ? EcoIcons.expandUp : EcoIcons.expandDown,
                          size: 18,
                          color: ecoColors(context).textMuted,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            if (_hasBody && _expanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: widget.streaming
                    ? Text(
                        widget.text,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: ecoColors(
                            context,
                          ).textMuted.withValues(alpha: 0.85),
                          height: 1.45,
                        ),
                      )
                    : EcoMarkdown(
                        text: widget.text,
                        compact: true,
                        muted: true,
                        selectable: false,
                      ),
              ),
          ],
        ),
      ),
    );
  }
}

class _UsageBadgeLine extends StatelessWidget {
  const _UsageBadgeLine({required this.badge});

  final String badge;

  @override
  Widget build(BuildContext context) {
    return Text(
      badge,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
        color: ecoColors(context).textMuted,
        fontSize: 11,
        letterSpacing: 0.2,
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.label,
    required this.icon,
    this.lifecycle,
    this.bashRun,
    this.fileChange,
  });

  final String label;
  final ActivityActionIcon icon;
  final ToolActionLifecycle? lifecycle;
  final BashRunCardDisplay? bashRun;
  final FileChangeCardDisplay? fileChange;

  @override
  Widget build(BuildContext context) {
    if (fileChange != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: _FileChangeCard(display: fileChange!, lifecycle: lifecycle),
      );
    }
    if (bashRun != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: _BashRunCard(display: bashRun!, lifecycle: lifecycle),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: Row(
        children: [
          Icon(
            _materialIcon(icon),
            size: 15,
            color: ecoColors(context).textMuted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: ecoColors(context).textMuted,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) =>
      EcoIcons.activityAction(icon);
}

class _BashRunCard extends StatefulWidget {
  const _BashRunCard({required this.display, this.lifecycle});

  final BashRunCardDisplay display;
  final ToolActionLifecycle? lifecycle;

  @override
  State<_BashRunCard> createState() => _BashRunCardState();
}

class _BashRunCardState extends State<_BashRunCard> {
  static const _collapsedBodyLines = 2;
  bool _bodyExpanded = false;

  @override
  Widget build(BuildContext context) {
    final display = widget.display;
    final lifecycle = widget.lifecycle;
    final running = lifecycle == ToolActionLifecycle.running;
    final failed = lifecycle == ToolActionLifecycle.failed;
    final borderColor = failed
        ? ecoColors(context).danger.withValues(alpha: 0.45)
        : running
        ? ecoColors(context).accent.withValues(alpha: 0.45)
        : ecoColors(context).borderSubtle;
    final body = display.body?.trim() ?? '';
    final bodyStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: ecoColors(context).textSecondary,
      fontFamily: 'Menlo',
      height: 1.45,
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final bodyMaxWidth = constraints.maxWidth - 24;
        final canExpand =
            body.isNotEmpty &&
            _textExceedsLineLimit(
              text: body,
              style: bodyStyle,
              maxWidth: bodyMaxWidth > 0 ? bodyMaxWidth : constraints.maxWidth,
              maxLines: _collapsedBodyLines,
              textDirection: Directionality.of(context),
            );

        final card = DecoratedBox(
          decoration: BoxDecoration(
            color: ecoColors(context).cardSurface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Row(
                  children: [
                    Icon(
                      EcoIcons.terminal,
                      size: 16,
                      color: running
                          ? ecoColors(context).accentText
                          : ecoColors(context).textMuted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        display.title,
                        style: Theme.of(context).textTheme.labelMedium
                            ?.copyWith(
                              color: ecoColors(context).textHeading,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                    ),
                    if (display.meta != null && display.meta!.isNotEmpty)
                      Text(
                        display.meta!,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: ecoColors(context).textMuted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    if (canExpand) ...[
                      const SizedBox(width: 4),
                      AnimatedRotation(
                        turns: _bodyExpanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 150),
                        child: Icon(
                          EcoIcons.expandDown,
                          size: 16,
                          color: ecoColors(context).textMuted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (body.isNotEmpty) ...[
                Divider(height: 1, color: ecoColors(context).borderSubtle),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                  child: AnimatedSize(
                    duration: const Duration(milliseconds: 150),
                    curve: Curves.easeOut,
                    alignment: Alignment.topLeft,
                    child: _bodyExpanded
                        ? SelectableText(body, style: bodyStyle)
                        : Text(
                            body,
                            maxLines: _collapsedBodyLines,
                            overflow: TextOverflow.ellipsis,
                            style: bodyStyle,
                          ),
                  ),
                ),
              ],
            ],
          ),
        );

        if (!canExpand) {
          return card;
        }

        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => setState(() => _bodyExpanded = !_bodyExpanded),
            borderRadius: BorderRadius.circular(10),
            child: card,
          ),
        );
      },
    );
  }
}

bool _textExceedsLineLimit({
  required String text,
  required TextStyle? style,
  required double maxWidth,
  required int maxLines,
  required TextDirection textDirection,
}) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    maxLines: maxLines,
    textDirection: textDirection,
  )..layout(maxWidth: maxWidth);
  return painter.didExceedMaxLines;
}

class _FileChangeCard extends StatefulWidget {
  const _FileChangeCard({required this.display, this.lifecycle});

  final FileChangeCardDisplay display;
  final ToolActionLifecycle? lifecycle;

  @override
  State<_FileChangeCard> createState() => _FileChangeCardState();
}

class _FileChangeCardState extends State<_FileChangeCard> {
  static const _collapsedLineLimit = 6;
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final display = widget.display;
    final lifecycle = widget.lifecycle;
    final running = lifecycle == ToolActionLifecycle.running;
    final failed = lifecycle == ToolActionLifecycle.failed;
    final borderColor = failed
        ? ecoColors(context).danger.withValues(alpha: 0.45)
        : running
            ? ecoColors(context).accent.withValues(alpha: 0.45)
            : ecoColors(context).borderSubtle;
    final previewLines = _expanded
        ? display.previewLines
        : display.previewLines.take(_collapsedLineLimit).toList();
    final hasMore = display.previewLines.length > _collapsedLineLimit;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => setState(() => _expanded = !_expanded),
        borderRadius: BorderRadius.circular(12),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: ecoColors(context).cardSurface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Row(
                  children: [
                    Icon(
                      EcoIcons.file,
                      size: 16,
                      color: ecoColors(context).accentText,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        display.fileName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                              color: ecoColors(context).textHeading,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                    ),
                    if (display.additions > 0)
                      Text(
                        '+${display.additions}',
                        style: TextStyle(
                          color: ecoColors(context).success,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    if (display.additions > 0 && display.deletions > 0)
                      const SizedBox(width: 8),
                    if (display.deletions > 0)
                      Text(
                        '-${display.deletions}',
                        style: TextStyle(
                          color: ecoColors(context).danger,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                  ],
                ),
              ),
              Divider(height: 1, color: ecoColors(context).borderSubtle),
              Stack(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(0, 6, 0, 10),
                    child: Column(
                      children: [
                        for (final line in previewLines)
                          _FileChangeLineRow(line: line),
                      ],
                    ),
                  ),
                  if (!_expanded && hasMore)
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 44,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              ecoColors(context).cardSurface.withValues(alpha: 0),
                              ecoColors(context).cardSurface,
                            ],
                          ),
                        ),
                      ),
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

class _FileChangeLineRow extends StatelessWidget {
  const _FileChangeLineRow({required this.line});

  final FileChangePreviewLine line;

  @override
  Widget build(BuildContext context) {
    Color background = Colors.transparent;
    Color borderColor = Colors.transparent;
    switch (line.kind) {
      case FileChangePreviewLineKind.add:
        background = ecoColors(context).statusAllowBg;
        borderColor = ecoColors(context).success;
      case FileChangePreviewLineKind.remove:
        background = ecoColors(context).statusDenyBg;
        borderColor = ecoColors(context).danger;
      case FileChangePreviewLineKind.context:
        background = Colors.transparent;
        borderColor = Colors.transparent;
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        border: Border(
          left: BorderSide(
            color: borderColor,
            width: 3,
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 2, 12, 2),
        child: Text(
          line.text.isEmpty ? ' ' : line.text,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                fontFamily: 'Menlo',
                height: 1.45,
                color: ecoColors(context).textSecondary,
              ),
        ),
      ),
    );
  }
}

class _PhaseTile extends StatelessWidget {
  const _PhaseTile({required this.text, this.detail});

  final String text;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: ecoColors(context).textMuted,
              fontStyle: FontStyle.italic,
            ),
          ),
          if (detail != null && detail!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: ecoColors(context).textMuted,
                  height: 1.35,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ReconnectPhaseTile extends StatefulWidget {
  const _ReconnectPhaseTile({required this.summary, this.detail});

  final String summary;
  final String? detail;

  @override
  State<_ReconnectPhaseTile> createState() => _ReconnectPhaseTileState();
}

class _ReconnectPhaseTileState extends State<_ReconnectPhaseTile>
    with SingleTickerProviderStateMixin {
  var _expanded = false;
  late final AnimationController _spinController;

  @override
  void initState() {
    super.initState();
    _spinController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    if (!_isFailure) {
      _spinController.repeat();
    }
  }

  @override
  void dispose() {
    _spinController.dispose();
    super.dispose();
  }

  bool get _isFailure => widget.summary.startsWith('连接失败');

  bool get _hasDetail =>
      widget.detail != null && widget.detail!.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final summaryColor = _isFailure ? eco.statusDenyText : eco.textSecondary;
    final iconColor = _isFailure ? eco.statusDenyText : eco.textMuted;

    final summaryRow = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_isFailure)
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(Icons.error_outline, size: 16, color: iconColor),
          )
        else
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: RotationTransition(
              turns: _spinController,
              child: Icon(Icons.refresh, size: 16, color: iconColor),
            ),
          ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            widget.summary,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: summaryColor,
              fontWeight: FontWeight.w500,
              height: 1.35,
            ),
          ),
        ),
        if (_hasDetail)
          Icon(
            _expanded ? Icons.expand_less : Icons.expand_more,
            size: 18,
            color: eco.textMuted,
          ),
      ],
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _hasDetail
              ? () => setState(() => _expanded = !_expanded)
              : null,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                summaryRow,
                if (_hasDetail && _expanded)
                  Container(
                    margin: const EdgeInsets.only(left: 24, top: 6),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: eco.codeBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: eco.borderSubtle),
                    ),
                    child: SelectableText(
                      widget.detail!.trim(),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted,
                        fontFamily: 'monospace',
                        height: 1.4,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubagentMissionTile extends StatefulWidget {
  const _SubagentMissionTile({
    required this.role,
    required this.summary,
    this.prompt,
    this.agentId,
    this.agentProfile,
    this.running = false,
    this.durationMs = 0,
    this.statusText,
    this.timeline = const [],
  });

  final String role;
  final String summary;
  final String? prompt;
  final String? agentId;
  final OrchestrationProfile? agentProfile;
  final bool running;
  final int durationMs;
  final String? statusText;
  final List<SubagentTimelineEntry> timeline;

  @override
  State<_SubagentMissionTile> createState() => _SubagentMissionTileState();
}

class _SubagentMissionTileState extends State<_SubagentMissionTile> {
  var _expanded = false;
  late int _liveDurationMs;
  Timer? _durationTimer;

  @override
  void initState() {
    super.initState();
    _liveDurationMs = widget.durationMs;
    _syncDurationTimer();
  }

  @override
  void didUpdateWidget(covariant _SubagentMissionTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.running) {
      _liveDurationMs = widget.durationMs;
    } else if (oldWidget.durationMs != widget.durationMs) {
      _liveDurationMs = widget.durationMs;
    }
    _syncDurationTimer();
  }

  void _syncDurationTimer() {
    _durationTimer?.cancel();
    _durationTimer = null;
    if (!widget.running) return;
    final baselineMs = widget.durationMs;
    final anchorAt = DateTime.now();
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        _liveDurationMs =
            baselineMs + DateTime.now().difference(anchorAt).inMilliseconds;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final role = normalizeAgentDisplayRole(widget.role) ?? widget.role;
    final trimmedPrompt = widget.prompt?.trim() ?? '';
    final trimmedSummary = widget.summary.trim();
    final fullText = resolveMissionDisplayText(
      trimmedPrompt.isNotEmpty ? trimmedPrompt : trimmedSummary,
    );
    final borderColor = subagentMissionBorderColor(
      role,
      profile: widget.agentProfile,
    );
    final statusText = widget.statusText?.trim();
    final showStatus =
        fullText.isEmpty && statusText != null && statusText.isNotEmpty;
    final durationLabel = formatSubagentDuration(
      widget.running ? _liveDurationMs : widget.durationMs,
      running: widget.running,
    );

    return Semantics(
      button: true,
      expanded: _expanded,
      label: '${resolveSubagentRunDisplayTitle(role)} 子代理任务',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            decoration: BoxDecoration(
              color: widget.running
                  ? Color.alphaBlend(
                      borderColor.withValues(alpha: 0.08),
                      ecoColors(context).cardSurface,
                    )
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Color.alphaBlend(
                  borderColor.withValues(alpha: widget.running ? 0.55 : 0.45),
                  ecoColors(context).borderSubtle,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Text(
                            resolveSubagentRunDisplayTitle(role),
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: ecoColors(context).accentText,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                          if (widget.agentId != null) ...[
                            const SizedBox(width: 6),
                            Text(
                              '#${shortSubagentAgentId(widget.agentId!)}',
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
                                    color: ecoColors(context).textMuted,
                                    fontSize: 10,
                                  ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (durationLabel.isNotEmpty) ...[
                      Text(
                        durationLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: widget.running
                              ? ecoColors(context).accentText
                              : ecoColors(context).textMuted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: widget.running
                            ? ecoColors(context).accentSoft
                            : ecoColors(context).cardSurface,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: widget.running
                              ? ecoColors(
                                  context,
                                ).accent.withValues(alpha: 0.45)
                              : ecoColors(context).borderSubtle,
                        ),
                      ),
                      child: Text(
                        widget.running ? '运行中' : '已完成',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: widget.running
                              ? ecoColors(context).accentText
                              : ecoColors(context).textMuted,
                          fontSize: 10,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(
                        EcoIcons.expandDown,
                        size: 18,
                        color: ecoColors(context).textMuted,
                      ),
                    ),
                  ],
                ),
                if (showStatus) ...[
                  const SizedBox(height: 6),
                  Text(
                    statusText,
                    maxLines: _expanded ? null : 1,
                    overflow: _expanded ? null : TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textSecondary,
                      height: 1.35,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  '任务目标',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: ecoColors(context).textMuted,
                    fontSize: 11,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 4),
                if (fullText.isEmpty)
                  Text(
                    '等待任务说明…',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textMuted,
                      fontStyle: FontStyle.italic,
                      height: 1.4,
                    ),
                  )
                else if (_expanded)
                  Text(
                    fullText,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textSecondary,
                      height: 1.45,
                    ),
                  )
                else
                  Text(
                    fullText,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textSecondary,
                      height: 1.45,
                    ),
                  ),
                if (_expanded && widget.timeline.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Divider(height: 1, color: ecoColors(context).borderSubtle),
                  const SizedBox(height: 8),
                  ...widget.timeline.map(
                    (item) => _SubagentTimelineRow(entry: item),
                  ),
                ] else if (_expanded && widget.running) ...[
                  const SizedBox(height: 10),
                  Text(
                    '等待执行事件…',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ecoColors(context).textMuted,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    super.dispose();
  }
}

class _SubagentTimelineRow extends StatelessWidget {
  const _SubagentTimelineRow({required this.entry});

  final SubagentTimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    if (entry.fileChange != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: _FileChangeCard(
          display: entry.fileChange!,
          lifecycle: entry.lifecycle,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.icon != null)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(
                _materialIcon(entry.icon!),
                size: 14,
                color: entry.isError
                    ? ecoColors(context).statusDenyText
                    : ecoColors(context).textMuted,
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Container(
                width: 5,
                height: 5,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: entry.isError
                      ? ecoColors(context).statusDenyText
                      : ecoColors(context).textMuted,
                ),
              ),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              entry.label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: entry.isError
                    ? ecoColors(context).statusDenyText
                    : ecoColors(context).textMuted,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) =>
      EcoIcons.activityAction(icon);
}

class _ErrorTile extends StatelessWidget {
  const _ErrorTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ecoColors(context).statusDenyBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: ecoColors(context).statusDenyBorder),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: ecoColors(context).statusDenyText,
          height: 1.4,
        ),
      ),
    );
  }
}
