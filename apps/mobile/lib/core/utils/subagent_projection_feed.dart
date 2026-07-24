import '../models/thread_run_projection.dart';
import '../../l10n/generated/app_localizations.dart';
import 'subagent_session_timing.dart';
import 'file_change.dart';
import 'activity_display.dart';
import 'agent_mission.dart';

class SubagentTimelineEntry {
  const SubagentTimelineEntry({
    required this.id,
    required this.label,
    this.icon,
    this.lifecycle,
    this.streaming = false,
    this.isError = false,
    this.toolUseId,
    this.fileChange,
  });

  final String id;
  final String label;
  final ActivityActionIcon? icon;
  final ToolActionLifecycle? lifecycle;
  final bool streaming;
  final bool isError;
  final String? toolUseId;
  final FileChangeCardDisplay? fileChange;
}

List<SubagentTimelineEntry> buildSubagentTimelineFromProjection(
  List<ThreadRunProjectionTimelineItem> timeline,
  AppLocalizations l10n,
) {
  final output = <SubagentTimelineEntry>[];
  for (final item in timeline) {
    if (item.eventType == 'agent.started') continue;
    if (item.eventType == 'request.started') continue;
    if (item.eventType == 'request.completed') continue;

    final bashApproval = readBashApprovalMetadata(item.metadata);
    if (bashApproval != null) {
      final description = bashApproval.description?.trim();
      output.add(
        SubagentTimelineEntry(
          id: item.id,
          toolUseId: bashApproval.toolUseId,
          label: description != null && description.isNotEmpty
              ? description
              : formatToolDisplayLabel(
                  bashApproval.toolName,
                  bashApproval.detail,
                  l10n,
                ),
          icon: iconForToolName(bashApproval.toolName),
          lifecycle: bashApprovalPhaseToLifecycle(bashApproval.phase),
        ),
      );
      continue;
    }

    if (item.eventType == 'tool.started' ||
        item.eventType == 'tool.completed' ||
        item.eventType == 'tool.failed') {
      final tool = readProjectionToolMetadata(item.metadata);
      final fileChange = resolveFileChangeCardDisplay(tool?.fileChange);
      if (fileChange != null) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            toolUseId: tool?.toolUseId,
            label: fileChange.fileName,
            icon: ActivityActionIcon.edit,
            lifecycle: item.eventType == 'tool.failed'
                ? ToolActionLifecycle.failed
                : item.eventType == 'tool.completed'
                ? ToolActionLifecycle.completed
                : tool != null
                ? toolLifecycleFromMetadata(tool)
                : ToolActionLifecycle.running,
            isError: item.eventType == 'tool.failed',
            fileChange: fileChange,
          ),
        );
        continue;
      }
      final label = tool != null
          ? (tool.name == 'Bash' && tool.description?.trim().isNotEmpty == true
                ? tool.description!.trim()
                : formatToolDisplayLabel(tool.name, tool.detail, l10n))
          : parseToolActionDisplayLabel(item.text, l10n);
      if (label.trim().isEmpty) continue;
      output.add(
        SubagentTimelineEntry(
          id: item.id,
          toolUseId: tool?.toolUseId,
          label: label,
          icon: iconForToolName(tool?.name ?? label),
          lifecycle: item.eventType == 'tool.failed'
              ? ToolActionLifecycle.failed
              : item.eventType == 'tool.completed'
              ? ToolActionLifecycle.completed
              : tool != null
              ? toolLifecycleFromMetadata(tool)
              : ToolActionLifecycle.running,
          isError: item.eventType == 'tool.failed',
        ),
      );
      continue;
    }

    if (item.eventType == 'api.error') {
      final apiError = item.metadata?['apiError'];
      final message = apiError is Map<String, dynamic>
          ? (apiError['message'] as String?)?.trim()
          : item.text.trim();
      if (message == null || message.isEmpty) continue;
      output.add(
        SubagentTimelineEntry(id: item.id, label: message, isError: true),
      );
      continue;
    }

    if (item.eventType == 'message.delta' ||
        item.eventType == 'message.final') {
      final text = item.text.trim();
      if (text.isEmpty || item.eventType == 'message.delta') continue;
      if (isLegacyBashApprovalActivityText(text)) continue;
      if (parseSubagentMissionMessage(text) != null ||
          isSubagentMissionEnvelope(text))
        continue;
      final preview = _firstReadableLine(text);
      if (preview.length >= 8 && !isActivityNoiseMessage(preview)) {
        output.add(SubagentTimelineEntry(id: item.id, label: preview));
      }
      continue;
    }

    if (item.eventType == 'thinking.final') {
      final preview = _firstReadableLine(item.text);
      if (preview.isNotEmpty) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: '${l10n.activityThinkingLabel}: $preview',
          ),
        );
      }
    }
  }
  return output;
}

String? resolveProjectionAgentStatusText(
  ThreadRunProjectionAgent agent,
  AppLocalizations l10n,
) {
  for (final item in agent.timeline.reversed) {
    if (item.eventType == 'message.final' ||
        item.eventType == 'message.delta') {
      if (parseSubagentMissionMessage(item.text) != null ||
          isSubagentMissionEnvelope(item.text)) {
        continue;
      }
      final line = _firstReadableLine(item.text);
      if (line.isNotEmpty && !isActivityNoiseMessage(line)) {
        return line;
      }
    }
    if (item.eventType == 'thinking.final') {
      final line = _firstReadableLine(item.text);
      if (line.isNotEmpty) {
        return '${l10n.activityThinkingLabel}: $line';
      }
    }
  }
  final latest = agent.latestActivity?.trim();
  if (latest != null &&
      latest.isNotEmpty &&
      // Historical Desktop status payload, not a mobile UI label.
      latest != '状态已更新' &&
      !latest.startsWith('Agent session')) {
    return _firstReadableLine(latest);
  }
  for (final item in agent.timeline.reversed) {
    if (item.eventType == 'tool.started' ||
        item.eventType == 'tool.completed' ||
        item.eventType == 'tool.failed') {
      final label = item.text.trim();
      if (label.isNotEmpty) {
        return parseToolActionDisplayLabel(label, l10n);
      }
    }
  }
  return null;
}

String _firstReadableLine(String text) {
  for (final line in text.split(RegExp(r'\r?\n'))) {
    final trimmed = line.trim();
    if (trimmed.isNotEmpty) return trimmed;
  }
  return '';
}

Map<String, List<ThreadRunProjectionAgent>> groupSubagentAgentsByRole(
  ThreadRunProjectionSnapshot projection,
) {
  final grouped = <String, List<ThreadRunProjectionAgent>>{};
  for (final agent in projection.agents) {
    if (agent.kind != 'subagent') continue;
    final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
    grouped.putIfAbsent(role, () => []).add(agent);
  }
  return grouped;
}

Map<String, ThreadSubagentSessionTiming> indexSubagentSessionsByAgentId(
  List<ThreadSubagentSessionTiming> sessions,
) {
  return {for (final session in sessions) session.agentId: session};
}

int resolveSubagentDurationMs({
  required ThreadRunProjectionAgent? agent,
  required ThreadSubagentSessionTiming? timing,
}) {
  if (timing != null) {
    return computeSubagentSessionDurationMs(timing);
  }
  return agent?.durationMs ?? 0;
}

bool resolveSubagentRunning({
  required ThreadRunProjectionAgent? agent,
  required ThreadSubagentSessionTiming? timing,
}) {
  if (agent != null) return agent.isRunning;
  return timing?.isActive ?? false;
}

class ProjectionAgentDelegation {
  const ProjectionAgentDelegation({
    required this.role,
    required this.summary,
    this.prompt,
  });

  final String role;
  final String summary;
  final String? prompt;
}

ProjectionAgentDelegation? readProjectionDelegationMetadata(
  ThreadRunProjectionTimelineItem item,
) {
  final metadata = item.metadata;
  if (metadata == null) return null;
  final summary = (metadata['delegationSummary'] as String?)?.trim() ?? '';
  final prompt = (metadata['delegationPrompt'] as String?)?.trim() ?? '';
  if (summary.isEmpty && prompt.isEmpty) return null;
  final role =
      normalizeAgentDisplayRole(item.role) ?? item.role?.trim() ?? 'subagent';
  return ProjectionAgentDelegation(
    role: role,
    summary: summary.isNotEmpty
        ? summary
        : (prompt.length > 200 ? prompt.substring(0, 200) : prompt),
    prompt: prompt.isEmpty ? null : prompt,
  );
}

ProjectionAgentDelegation? readProjectionAgentDelegation(
  ThreadRunProjectionAgent agent,
) {
  final summary = agent.delegationSummary?.trim() ?? '';
  final prompt = agent.delegationPrompt?.trim() ?? '';
  if (summary.isEmpty && prompt.isEmpty) return null;
  final role = normalizeAgentDisplayRole(agent.role) ?? agent.role;
  return ProjectionAgentDelegation(
    role: role,
    summary: summary.isNotEmpty
        ? summary
        : (prompt.length > 200 ? prompt.substring(0, 200) : prompt),
    prompt: prompt.isEmpty ? null : prompt,
  );
}

/// Mission body for subagent cards — structured attribution only (delegation / parentToolUseId).
String resolveSubagentCardMissionText(
  ThreadRunProjectionAgent agent, {
  List<ThreadRunProjectionTimelineItem> mainTimeline = const [],
}) {
  final delegation = readProjectionAgentDelegation(agent);
  if (delegation != null) {
    final text = resolveMissionDisplayText(
      (delegation.prompt?.trim().isNotEmpty == true
              ? delegation.prompt!
              : delegation.summary)
          .trim(),
    );
    if (text.isNotEmpty) return text;
  }

  for (final item in agent.timeline) {
    if (item.eventType == 'agent.started') {
      final timelineDelegation = readProjectionDelegationMetadata(item);
      if (timelineDelegation != null) {
        final text = resolveMissionDisplayText(
          (timelineDelegation.prompt?.trim().isNotEmpty == true
                  ? timelineDelegation.prompt!
                  : timelineDelegation.summary)
              .trim(),
        );
        if (text.isNotEmpty) return text;
      }
    }
    final mission = parseSubagentMissionMessage(item.text);
    if (mission != null) {
      if (mission.agentId != null && mission.agentId != agent.agentId) {
        continue;
      }
      if (item.agentId != null && item.agentId != agent.agentId) continue;
      final text = resolveMissionDisplayText(
        mission.prompt.isNotEmpty ? mission.prompt : mission.summary,
      );
      if (text.isNotEmpty) return text;
    }
  }

  final parentToolUseId = agent.parentToolUseId?.trim();
  if (parentToolUseId != null &&
      parentToolUseId.isNotEmpty &&
      mainTimeline.isNotEmpty) {
    for (final item in mainTimeline) {
      final toolUseId =
          readProjectionToolMetadata(item.metadata)?.toolUseId?.trim() ??
          readBashApprovalMetadata(item.metadata)?.toolUseId.trim();
      if (toolUseId != parentToolUseId) continue;
      final mission = parseSubagentMissionMessage(item.text);
      if (mission == null) break;
      if (mission.agentId != null && mission.agentId != agent.agentId) break;
      final text = resolveMissionDisplayText(
        mission.prompt.isNotEmpty ? mission.prompt : mission.summary,
      );
      if (text.isNotEmpty) return text;
      break;
    }
  }

  return '';
}

ThreadRunProjectionAgent? findProjectionAgentById(
  ThreadRunProjectionSnapshot projection,
  String agentId,
) {
  for (final agent in projection.agents) {
    if (agent.agentId == agentId) return agent;
  }
  return null;
}
