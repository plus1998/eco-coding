import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/agent_orchestration.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';

void main() {
  test('resolveSubagentThemeColor uses built-in defaults', () {
    expect(resolveSubagentThemeColor('explore'), const Color(0xFFA78BFA));
    expect(resolveSubagentThemeColor('architect'), const Color(0xFF22D3EE));
    expect(resolveSubagentThemeColor('coder'), const Color(0xFF34D399));
    expect(resolveSubagentThemeColor('reviewer'), const Color(0xFFFBBF24));
    expect(resolveSubagentThemeColor('tester'), const Color(0xFFF472B6));
  });

  test(
    'resolveSubagentThemeColor uses agent overrides and unknown fallback',
    () {
      const agents = [
        AgentInstanceConfig(
          agentKey: 'explore',
          templateId: 'builtin.coding.explore',
          enabled: true,
          themeColor: '#112233',
          modelRef: OrchestrationModelRef(
            providerId: 'provider-1',
            modelId: 'gpt-5.6-terra',
          ),
          tools: ToolPolicy(),
        ),
        AgentInstanceConfig(
          agentKey: 'coder',
          templateId: 'builtin.coding.coder',
          enabled: true,
          themeColor: '#445566',
          modelRef: OrchestrationModelRef(
            providerId: 'provider-1',
            modelId: 'gpt-5.6-sol',
          ),
          tools: ToolPolicy(),
        ),
      ];

      expect(
        resolveSubagentThemeColor('explore', agents: agents),
        const Color(0xFF112233),
      );
      expect(
        resolveSubagentThemeColor('eco_coder', agents: agents),
        const Color(0xFF445566),
      );
      expect(
        resolveSubagentThemeColor('researcher', agents: agents),
        subagentUnknownThemeColor,
      );
    },
  );
}
