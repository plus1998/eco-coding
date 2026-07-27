import 'package:flutter/material.dart';

import '../models/agent_orchestration.dart';
import '../utils/activity_display.dart';

const subagentDefaultThemeColors = <String, Color>{
  'vision': Color(0xFF38BDF8),
  'explore': Color(0xFFA78BFA),
  'architect': Color(0xFF22D3EE),
  'coder': Color(0xFF34D399),
  'reviewer': Color(0xFFFBBF24),
  'tester': Color(0xFFF472B6),
};

const subagentUnknownThemeColor = Color(0xFF60A5FA);

Color parseSubagentThemeHex(String value) {
  final trimmed = value.trim();
  final match = RegExp(r'^#([0-9A-Fa-f]{6})$').firstMatch(trimmed);
  if (match == null) {
    throw FormatException('无效主题色：$value');
  }
  final hex = match.group(1)!;
  return Color(int.parse('FF$hex', radix: 16));
}

String stripEcoAgentKeyPrefix(String value) {
  return value.startsWith('eco_') ? value.substring(4) : value;
}

Color resolveSubagentThemeColor(
  String role, {
  List<AgentInstanceConfig> agents = const [],
}) {
  final normalized = normalizeAgentDisplayRole(role) ?? role;
  final agentKey = stripEcoAgentKeyPrefix(normalized);

  for (final agent in agents) {
    if (agent.agentKey == agentKey) {
      final themeColor = agent.themeColor?.trim();
      if (themeColor != null && themeColor.isNotEmpty) {
        return parseSubagentThemeHex(themeColor);
      }
      break;
    }
  }

  return subagentDefaultThemeColors[agentKey] ?? subagentUnknownThemeColor;
}

Color subagentMissionBorderColor(
  String role, {
  List<AgentInstanceConfig> agents = const [],
}) {
  final accent = resolveSubagentThemeColor(role, agents: agents);
  return accent.withValues(alpha: 0.28);
}

Color subagentMissionSurfaceColor(
  String role, {
  List<AgentInstanceConfig> agents = const [],
  double alpha = 0.08,
}) {
  final accent = resolveSubagentThemeColor(role, agents: agents);
  return accent.withValues(alpha: alpha);
}
