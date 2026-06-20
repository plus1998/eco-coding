import '../models/thread_run_projection.dart';
import 'subagent_session_timing.dart';
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
  });

  final String id;
  final String label;
  final ActivityActionIcon? icon;
  final ToolActionLifecycle? lifecycle;
  final bool streaming;
  final bool isError;
}

List<SubagentTimelineEntry> buildSubagentTimelineFromProjection(
  List<ThreadRunProjectionTimelineItem> timeline,
) {
  final output = <SubagentTimelineEntry>[];
  for (final item in timeline) {
    if (item.eventType == 'agent.started') continue;
    if (item.eventType == 'request.started') continue;
    if (item.eventType == 'request.completed') continue;

    final text = item.text.trim();
    final mission = parseSubagentMissionMessage(text);
    if (mission != null) continue;

    if (item.eventType == 'tool.started' ||
        item.eventType == 'tool.completed' ||
        item.eventType == 'tool.failed') {
      final toolName = _resolveProjectionToolName(item);
      final parsedApproval = parseBashApprovalActivityText(text);
      if (parsedApproval != null) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: formatToolDisplayLabel(
              parsedApproval.toolName,
              parsedApproval.detail,
            ),
            icon: iconForToolName(parsedApproval.toolName),
            lifecycle: parsedApproval.phase,
          ),
        );
        continue;
      }
      output.add(
        SubagentTimelineEntry(
          id: item.id,
          label: text.isNotEmpty
              ? parseToolActionDisplayLabel(text)
              : formatToolDisplayLabel(toolName, null),
          icon: iconForToolName(toolName),
          lifecycle: item.eventType == 'tool.failed'
              ? ToolActionLifecycle.failed
              : item.eventType == 'tool.completed'
                  ? ToolActionLifecycle.completed
                  : ToolActionLifecycle.running,
          isError: item.eventType == 'tool.failed',
        ),
      );
      continue;
    }

    if (item.eventType == 'api.error') {
      if (text.isEmpty) continue;
      output.add(
        SubagentTimelineEntry(
          id: item.id,
          label: text,
          isError: true,
        ),
      );
      continue;
    }

    if (item.eventType == 'message.delta' || item.eventType == 'message.final') {
      final parsedApproval = parseBashApprovalActivityText(text);
      if (parsedApproval != null) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: formatToolDisplayLabel(
              parsedApproval.toolName,
              parsedApproval.detail,
            ),
            icon: iconForToolName(parsedApproval.toolName),
            lifecycle: parsedApproval.phase,
          ),
        );
        continue;
      }
      if (text.isEmpty || item.eventType == 'message.delta') continue;
      if (looksLikeToolActionMessage(text)) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: parseToolActionDisplayLabel(text),
            icon: iconForActivityMessage(text),
            lifecycle: ToolActionLifecycle.running,
          ),
        );
        continue;
      }
      final preview = _firstReadableLine(text);
      if (preview.length >= 8 && !isActivityNoiseMessage(preview)) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: preview,
          ),
        );
      }
      continue;
    }

    if (item.eventType == 'thinking.final') {
      final preview = _firstReadableLine(text);
      if (preview.isNotEmpty) {
        output.add(
          SubagentTimelineEntry(
            id: item.id,
            label: '思考：$preview',
          ),
        );
      }
    }
  }
  return output;
}

String? resolveProjectionAgentStatusText(ThreadRunProjectionAgent agent) {
  for (final item in agent.timeline.reversed) {
    if (item.eventType == 'message.final' || item.eventType == 'message.delta') {
      final line = _firstReadableLine(item.text);
      if (line.isNotEmpty && !isActivityNoiseMessage(line)) {
        return line;
      }
    }
    if (item.eventType == 'thinking.final') {
      final line = _firstReadableLine(item.text);
      if (line.isNotEmpty) return '思考：$line';
    }
  }
  final latest = agent.latestActivity?.trim();
  if (latest != null &&
      latest.isNotEmpty &&
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
        return parseToolActionDisplayLabel(label);
      }
    }
  }
  return null;
}

String _resolveProjectionToolName(ThreadRunProjectionTimelineItem item) {
  final metadata = item.metadata;
  final rawName = metadata?['toolName'];
  if (rawName is String && rawName.trim().isNotEmpty) {
    return rawName.trim();
  }
  final match = RegExp(r'^Tool:\s*(\S+)', caseSensitive: false).firstMatch(item.text);
  return match?.group(1) ?? 'Tool';
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

ThreadRunProjectionAgent? findProjectionAgentById(
  ThreadRunProjectionSnapshot projection,
  String agentId,
) {
  for (final agent in projection.agents) {
    if (agent.agentId == agentId) return agent;
  }
  return null;
}