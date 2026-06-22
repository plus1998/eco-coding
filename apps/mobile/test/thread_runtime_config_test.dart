import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';

OrchestrationProfile _profile({
  required List<OrchestrationAgentInstance> agents,
}) {
  return OrchestrationProfile(id: 'p1', name: 'Test', agents: agents);
}

void main() {
  test('deriveSubagentEnabledFromProfile disables roles missing from profile', () {
    final profile = _profile(
      agents: const [
        OrchestrationAgentInstance(agentKey: 'coder', enabled: true),
      ],
    );

    final derived = deriveSubagentEnabledFromProfile(profile);

    expect(derived['architect'], isFalse);
    expect(derived['coder'], isTrue);
    expect(derived['explore'], isTrue);
  });

  test('deriveSubagentEnabledFromProfile preserves existing runtime toggles', () {
    final profile = _profile(
      agents: const [
        OrchestrationAgentInstance(agentKey: 'coder', enabled: true),
        OrchestrationAgentInstance(agentKey: 'reviewer', enabled: true),
      ],
    );

    final derived = deriveSubagentEnabledFromProfile(
      profile,
      existing: const {'coder': false, 'reviewer': true},
    );

    expect(derived['coder'], isFalse);
    expect(derived['reviewer'], isTrue);
  });

  test('isRuntimeSubagentEnabled defaults missing roles to enabled', () {
    expect(
      isRuntimeSubagentEnabled(const {'coder': false}, 'reviewer'),
      isTrue,
    );
    expect(
      isRuntimeSubagentEnabled(const {'coder': false}, 'coder'),
      isFalse,
    );
    expect(
      isRuntimeSubagentEnabled(const {}, 'explore'),
      isTrue,
    );
  });
}
