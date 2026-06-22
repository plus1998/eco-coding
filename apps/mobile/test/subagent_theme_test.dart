import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/theme/subagent_theme.dart';

void main() {
  test('resolveSubagentThemeColor uses built-in defaults', () {
    expect(resolveSubagentThemeColor('explore'), const Color(0xFFA78BFA));
    expect(resolveSubagentThemeColor('architect'), const Color(0xFF22D3EE));
    expect(resolveSubagentThemeColor('coder'), const Color(0xFF34D399));
    expect(resolveSubagentThemeColor('reviewer'), const Color(0xFFFBBF24));
    expect(resolveSubagentThemeColor('tester'), const Color(0xFFF472B6));
  });

  test('resolveSubagentThemeColor uses profile overrides and unknown fallback', () {
    const profile = OrchestrationProfile(
      id: 'p1',
      name: 'Test',
      builtinExploreThemeColor: '#112233',
      agents: [
        OrchestrationAgentInstance(
          agentKey: 'coder',
          enabled: true,
          themeColor: '#445566',
        ),
      ],
    );

    expect(
      resolveSubagentThemeColor('explore', profile: profile),
      const Color(0xFF112233),
    );
    expect(
      resolveSubagentThemeColor('eco_coder', profile: profile),
      const Color(0xFF445566),
    );
    expect(
      resolveSubagentThemeColor('researcher', profile: profile),
      subagentUnknownThemeColor,
    );
  });
}
