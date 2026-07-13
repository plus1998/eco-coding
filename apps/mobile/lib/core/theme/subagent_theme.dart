import 'package:flutter/material.dart';

import '../models/thread_models.dart';
import '../utils/activity_display.dart';

const subagentDefaultThemeColors = <String, Color>{
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

Color resolveSubagentThemeColor(String role, {OrchestrationProfile? profile}) {
  final normalized = normalizeAgentDisplayRole(role) ?? role;
  final agentKey = stripEcoAgentKeyPrefix(normalized);

  if (profile != null) {
    for (final agent in profile.agents) {
      if (agent.agentKey == agentKey) {
        final themeColor = agent.themeColor?.trim();
        if (themeColor != null && themeColor.isNotEmpty) {
          return parseSubagentThemeHex(themeColor);
        }
        break;
      }
    }
  }

  if (agentKey == 'explore') {
    final legacyExploreColor = profile?.builtinExploreThemeColor?.trim();
    if (legacyExploreColor != null && legacyExploreColor.isNotEmpty) {
      return parseSubagentThemeHex(legacyExploreColor);
    }
  }

  return subagentDefaultThemeColors[agentKey] ?? subagentUnknownThemeColor;
}

Color subagentMissionBorderColor(String role, {OrchestrationProfile? profile}) {
  final accent = resolveSubagentThemeColor(role, profile: profile);
  return accent.withValues(alpha: 0.28);
}

Color subagentMissionSurfaceColor(
  String role, {
  OrchestrationProfile? profile,
  double alpha = 0.08,
}) {
  final accent = resolveSubagentThemeColor(role, profile: profile);
  return accent.withValues(alpha: alpha);
}
