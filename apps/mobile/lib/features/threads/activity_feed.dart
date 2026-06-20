import 'package:flutter/material.dart';

import '../../core/theme/eco_theme.dart';
import '../../core/utils/activity_display.dart';
import '../../core/utils/agent_mission.dart';
import '../../core/widgets/eco_markdown.dart';
import 'thread_providers.dart';

enum ActivityFeedKind { user, assistant, action, phase, subagentMission, error }

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
}

List<ActivityFeedEntry> buildActivityFeed({
  required List<ActivityItem> lines,
  String? threadPrompt,
  String? threadId,
}) {
  var effectiveLines = lines;
  if (!lines.any((line) => line.role == 'user') &&
      threadPrompt != null &&
      threadPrompt.trim().isNotEmpty) {
    effectiveLines = [
      ActivityItem(
        id: 'legacy-${threadId ?? 'thread'}',
        role: 'user',
        message: threadPrompt,
      ),
      ...lines,
    ];
  }

  final output = <ActivityFeedEntry>[];
  var narrative = '';
  String? narrativeId;
  var narrativeStreaming = false;
  String? pendingUsageBadge;

  void flushNarrative() {
    final text = stripActivityStatusNoise(narrative).trim();
    if (text.isEmpty) {
      narrative = '';
      narrativeId = null;
      narrativeStreaming = false;
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: narrativeId ?? 'narrative-${output.length}',
        kind: ActivityFeedKind.assistant,
        text: text,
        streaming: narrativeStreaming,
        usageBadge: pendingUsageBadge,
      ),
    );
    narrative = '';
    narrativeId = null;
    narrativeStreaming = false;
    pendingUsageBadge = null;
  }

  void upsertAction({
    required String id,
    required String label,
    required ActivityActionIcon icon,
    ToolActionLifecycle? lifecycle,
    String? subagentRole,
  }) {
    final actionKey = activityActionKey(
      subagent: subagentRole,
      label: label,
      icon: icon,
    );
    final existingIndex = output.indexWhere(
      (entry) =>
          entry.kind == ActivityFeedKind.action &&
          activityActionKey(
                subagent: entry.subagentRole,
                label: entry.text,
                icon: entry.actionIcon,
              ) ==
              actionKey,
    );
    if (existingIndex >= 0) {
      final existing = output[existingIndex];
      ToolActionLifecycle? nextLifecycle = lifecycle;
      if (existing.lifecycle != null && lifecycle != null) {
        nextLifecycle =
            compareToolActionLifecyclePriority(lifecycle, existing.lifecycle!) >=
                    0
                ? lifecycle
                : existing.lifecycle;
      } else {
        nextLifecycle ??= existing.lifecycle;
      }
      output[existingIndex] = ActivityFeedEntry(
        id: existing.id,
        kind: ActivityFeedKind.action,
        text: label,
        actionIcon: icon,
        subagentRole: subagentRole ?? existing.subagentRole,
        lifecycle: nextLifecycle,
      );
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: id,
        kind: ActivityFeedKind.action,
        text: label,
        actionIcon: icon,
        subagentRole: subagentRole,
        lifecycle: lifecycle,
      ),
    );
  }

  void upsertPhase(String summary, {String? detail}) {
    final last = output.isNotEmpty ? output.last : null;
    if (last != null &&
        last.kind == ActivityFeedKind.phase &&
        last.text == summary) {
      if (detail != null && detail.isNotEmpty) {
        output[output.length - 1] = ActivityFeedEntry(
          id: last.id,
          kind: ActivityFeedKind.phase,
          text: summary,
          detail: detail,
        );
      }
      return;
    }
    output.add(
      ActivityFeedEntry(
        id: 'phase-${output.length}',
        kind: ActivityFeedKind.phase,
        text: summary,
        detail: detail,
      ),
    );
  }

  for (final line in effectiveLines) {
    final cleaned = stripActivityStatusNoise(line.message);
    final message = stripSubagentBracketPrefix(cleaned);
    if (message.isEmpty || isUsageNoiseMessage(message)) continue;

    if (line.role == 'system' || isInternalAgentActivityRole(line.role)) {
      continue;
    }

    if (isInternalActivityMessage(message)) {
      continue;
    }

    if (isUsageBadgeText(message)) {
      flushNarrative();
      pendingUsageBadge = message.trim();
      continue;
    }

    final mission = parseSubagentMissionMessage(message);
    if (mission != null && isSubagentDisplayRole(mission.role)) {
      flushNarrative();
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.subagentMission,
          text: mission.summary,
          subagentRole: mission.role,
          missionPrompt:
              mission.prompt.isNotEmpty ? mission.prompt : null,
        ),
      );
      continue;
    }

    if (line.role == 'user') {
      flushNarrative();
      if (!isUserPromptActivityLine(role: line.role, message: line.message)) {
        continue;
      }
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.user,
          text: line.message.trim(),
        ),
      );
      continue;
    }

    final agentRole = normalizeAgentDisplayRole(line.role);
    if (agentRole != null && isSubagentDisplayRole(agentRole)) {
      flushNarrative();
      final summary = message.trim();
      if (summary.length >= 8 &&
          !summary.startsWith('Tool:') &&
          !summary.startsWith('Reading ') &&
          !summary.startsWith('Running ')) {
        output.add(
          ActivityFeedEntry(
            id: line.id,
            kind: ActivityFeedKind.subagentMission,
            text: summary,
            subagentRole: agentRole,
          ),
        );
      }
      continue;
    }

    if (line.role == 'thinking') {
      continue;
    }

    final reconnect = parseReconnectActivityMessage(message);
    if (reconnect != null) {
      flushNarrative();
      upsertPhase(reconnect.summary, detail: reconnect.detail);
      continue;
    }

    if (isThreadFollowUpActivityMessage(message)) {
      continue;
    }

    final parsedApproval = parseBashApprovalActivityText(message);
    if (parsedApproval != null) {
      flushNarrative();
      upsertAction(
        id: line.id,
        label: formatToolDisplayLabel(
          parsedApproval.toolName,
          parsedApproval.detail,
        ),
        icon: iconForToolName(parsedApproval.toolName),
        lifecycle: parsedApproval.phase,
        subagentRole: agentRole,
      );
      continue;
    }

    if (looksLikeToolActionMessage(message)) {
      flushNarrative();
      upsertAction(
        id: line.id,
        label: parseToolActionDisplayLabel(message),
        icon: iconForActivityMessage(message),
        lifecycle: ToolActionLifecycle.running,
        subagentRole: agentRole,
      );
      continue;
    }

    if (_looksLikeApiError(message)) {
      flushNarrative();
      output.add(
        ActivityFeedEntry(
          id: line.id,
          kind: ActivityFeedKind.error,
          text: message,
        ),
      );
      continue;
    }

    if (isActivityNoiseMessage(message) || isActivityStatusNoise(message)) {
      continue;
    }

    if (line.role == 'planner' ||
        line.role == 'assistant' ||
        line.role == 'main') {
      if (line.stream) {
        narrative += message;
        narrativeId ??= line.id;
        narrativeStreaming = true;
      } else {
        narrative += message;
        narrativeId ??= line.id;
        narrativeStreaming = false;
      }
      continue;
    }

    if (shouldShowLineInMainFeed(role: line.role) && message.trim().isNotEmpty) {
      narrative += message;
      narrativeId ??= line.id;
      narrativeStreaming = line.stream;
    }
  }

  flushNarrative();
  return output;
}

bool _looksLikeApiError(String message) {
  final trimmed = message.trim();
  return trimmed.startsWith('API error') ||
      trimmed.startsWith('Tool failed:') ||
      trimmed.startsWith('工具调用失败');
}

class ActivityFeedList extends StatelessWidget {
  const ActivityFeedList({
    super.key,
    required this.entries,
    required this.scrollController,
  });

  final List<ActivityFeedEntry> entries;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      itemCount: entries.length,
      itemBuilder: (context, index) => _ActivityFeedEntryTile(
        entry: entries[index],
      ),
    );
  }
}

class _ActivityFeedEntryTile extends StatelessWidget {
  const _ActivityFeedEntryTile({required this.entry});

  final ActivityFeedEntry entry;

  @override
  Widget build(BuildContext context) {
    switch (entry.kind) {
      case ActivityFeedKind.user:
        return _UserPromptTile(text: entry.text);
      case ActivityFeedKind.assistant:
        return _AssistantNarrativeTile(
          text: entry.text,
          streaming: entry.streaming,
          usageBadge: entry.usageBadge,
        );
      case ActivityFeedKind.action:
        return _ActionTile(
          label: entry.text,
          icon: entry.actionIcon ?? ActivityActionIcon.file,
        );
      case ActivityFeedKind.phase:
        return _PhaseTile(text: entry.text, detail: entry.detail);
      case ActivityFeedKind.subagentMission:
        return _SubagentMissionTile(
          role: entry.subagentRole ?? '',
          summary: entry.text,
          prompt: entry.missionPrompt,
        );
      case ActivityFeedKind.error:
        return _ErrorTile(text: entry.text);
    }
  }
}

class _UserPromptTile extends StatelessWidget {
  const _UserPromptTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.88,
        ),
        decoration: BoxDecoration(
          color: eco.userBubble,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: eco.borderSubtle),
        ),
        child: Text(
          text,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                height: 1.45,
                color: EcoColors.textPrimary,
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
    final eco = ecoThemeExtras(context);
    if (text.isEmpty && usageBadge != null) {
      return _UsageBadgeLine(badge: usageBadge!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text.isNotEmpty) EcoMarkdown(text: text),
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
                      color: eco.textMuted,
                    ),
              ),
            ),
        ],
      ),
    );
  }
}

class _UsageBadgeLine extends StatelessWidget {
  const _UsageBadgeLine({required this.badge});

  final String badge;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Text(
      badge,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: eco.textMuted,
            fontSize: 11,
            letterSpacing: 0.2,
          ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.label, required this.icon});

  final String label;
  final ActivityActionIcon icon;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: Row(
        children: [
          Icon(
            _materialIcon(icon),
            size: 15,
            color: eco.textMuted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: eco.textMuted,
                    height: 1.35,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  IconData _materialIcon(ActivityActionIcon icon) {
    switch (icon) {
      case ActivityActionIcon.search:
        return Icons.search;
      case ActivityActionIcon.edit:
        return Icons.edit_outlined;
      case ActivityActionIcon.terminal:
        return Icons.terminal;
      case ActivityActionIcon.agent:
        return Icons.smart_toy_outlined;
      case ActivityActionIcon.file:
        return Icons.description_outlined;
    }
  }
}

class _PhaseTile extends StatelessWidget {
  const _PhaseTile({required this.text, this.detail});

  final String text;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: eco.textMuted,
                  fontStyle: FontStyle.italic,
                ),
          ),
          if (detail != null && detail!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: eco.textMuted,
                      height: 1.35,
                    ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SubagentMissionTile extends StatefulWidget {
  const _SubagentMissionTile({
    required this.role,
    required this.summary,
    this.prompt,
  });

  final String role;
  final String summary;
  final String? prompt;

  @override
  State<_SubagentMissionTile> createState() => _SubagentMissionTileState();
}

class _SubagentMissionTileState extends State<_SubagentMissionTile> {
  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final role = normalizeAgentDisplayRole(widget.role) ?? widget.role;
    final trimmedPrompt = widget.prompt?.trim() ?? '';
    final trimmedSummary = widget.summary.trim();
    final fullText =
        trimmedPrompt.isNotEmpty ? trimmedPrompt : trimmedSummary;
    final borderColor = subagentMissionBorderColor(role);

    return Semantics(
      button: true,
      expanded: _expanded,
      label: '${resolveSubagentRunDisplayTitle(role)} 任务目标',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Color.alphaBlend(
                  borderColor.withValues(alpha: 0.45),
                  eco.borderSubtle,
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
                            style:
                                Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: EcoColors.accentText,
                                      fontWeight: FontWeight.w600,
                                    ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '任务目标',
                            style:
                                Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: eco.textMuted,
                                      fontSize: 11,
                                      letterSpacing: 0.3,
                                    ),
                          ),
                        ],
                      ),
                    ),
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(
                        Icons.expand_more,
                        size: 18,
                        color: eco.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if (fullText.isEmpty)
                  Text(
                    '等待任务说明…',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: eco.textMuted,
                          fontStyle: FontStyle.italic,
                          height: 1.4,
                        ),
                  )
                else
                  AnimatedSize(
                    duration: const Duration(milliseconds: 150),
                    curve: Curves.easeOut,
                    alignment: Alignment.topLeft,
                    child: Text(
                      fullText,
                      maxLines: _expanded ? null : 2,
                      overflow:
                          _expanded ? null : TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: eco.textSecondary,
                            height: 1.45,
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

class _ErrorTile extends StatelessWidget {
  const _ErrorTile({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: EcoColors.statusDenyBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: EcoColors.statusDenyBorder),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: EcoColors.statusDenyText,
              height: 1.4,
            ),
      ),
    );
  }
}
