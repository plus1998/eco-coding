import 'dart:convert';

import 'activity_display.dart';

const _missionPrefix = '@mission ';

bool isSubagentMissionEnvelope(String message) {
  return message.trim().startsWith(_missionPrefix);
}

class SubagentMissionPayload {
  const SubagentMissionPayload({
    required this.role,
    required this.summary,
    required this.prompt,
    this.agentId,
  });

  final String role;
  final String summary;
  final String prompt;
  final String? agentId;
}

SubagentMissionPayload? parseSubagentMissionMessage(String message) {
  final trimmed = message.trim();
  if (!trimmed.startsWith(_missionPrefix)) {
    return null;
  }
  try {
    final parsed = jsonDecode(trimmed.substring(_missionPrefix.length));
    if (parsed is! Map<String, dynamic>) {
      return null;
    }
    final role = parsed['role'];
    final summary = parsed['summary'];
    if (role is! String || summary is! String) {
      return null;
    }
    final normalizedRole = _normalizeMissionRole(role);
    final agentId = parsed['agentId'];
    return SubagentMissionPayload(
      role: normalizedRole,
      summary: summary.trim(),
      prompt: parsed['prompt'] is String ? (parsed['prompt'] as String).trim() : '',
      agentId: agentId is String && agentId.trim().isNotEmpty ? agentId.trim() : null,
    );
  } catch (_) {
    return null;
  }
}

String _normalizeMissionRole(String role) {
  final trimmed = role.trim();
  const chineseRoleToId = {
    '探索': 'explore',
    '架构': 'architect',
    '编码': 'coder',
    '审查': 'reviewer',
    '测试': 'tester',
  };
  final fromChinese = chineseRoleToId[trimmed];
  if (fromChinese != null) {
    return fromChinese;
  }
  return normalizeAgentDisplayRole(trimmed) ?? trimmed;
}

String resolveMissionDisplayText(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) {
    return '';
  }
  final parsed = parseSubagentMissionMessage(trimmed);
  if (parsed != null) {
    return parsed.prompt.isNotEmpty ? parsed.prompt : parsed.summary;
  }
  return trimmed;
}
