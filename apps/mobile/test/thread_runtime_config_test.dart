import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';

OrchestrationProfile _profile({
  required List<OrchestrationAgentInstance> agents,
}) {
  return OrchestrationProfile(id: 'p1', name: 'Test', agents: agents);
}

ThreadRuntimeConfig _runtimeConfig({
  MainAgentModelOverride? mainAgentModelOverride,
}) {
  return ThreadRuntimeConfig(
    routeProfileId: 'p1',
    agentProfileId: 'p1',
    subagentEnabled: defaultSubagentAvailability(),
    mainAgentModelOverride: mainAgentModelOverride,
    sessionMode: 'agent',
    bashReviewMode: 'always',
  );
}

void main() {
  test(
    'deriveSubagentEnabledFromProfile disables roles missing from profile',
    () {
      final profile = _profile(
        agents: const [
          OrchestrationAgentInstance(agentKey: 'coder', enabled: true),
        ],
      );

      final derived = deriveSubagentEnabledFromProfile(profile);

      expect(derived['architect'], isFalse);
      expect(derived['coder'], isTrue);
      expect(derived['explore'], isFalse);
    },
  );

  test(
    'deriveSubagentEnabledFromProfile preserves existing runtime toggles',
    () {
      final profile = _profile(
        agents: const [
          OrchestrationAgentInstance(agentKey: 'explore', enabled: true),
          OrchestrationAgentInstance(agentKey: 'coder', enabled: true),
          OrchestrationAgentInstance(agentKey: 'reviewer', enabled: true),
        ],
      );

      final derived = deriveSubagentEnabledFromProfile(
        profile,
        existing: const {'explore': false, 'coder': false, 'reviewer': true},
      );

      expect(derived['explore'], isFalse);
      expect(derived['coder'], isFalse);
      expect(derived['reviewer'], isTrue);
    },
  );

  test('isRuntimeSubagentEnabled defaults missing roles to enabled', () {
    expect(
      isRuntimeSubagentEnabled(const {'coder': false}, 'reviewer'),
      isTrue,
    );
    expect(isRuntimeSubagentEnabled(const {'coder': false}, 'coder'), isFalse);
    expect(isRuntimeSubagentEnabled(const {}, 'explore'), isTrue);
    expect(
      isRuntimeSubagentEnabled(const {'explore': false}, 'explore'),
      isFalse,
    );
  });

  test('Explore is toggleable and included in subagent counts', () {
    final profile = _profile(
      agents: const [
        OrchestrationAgentInstance(agentKey: 'explore', enabled: true),
      ],
    );
    expect(isSubagentToggleable(null, 'explore'), isFalse);
    expect(isSubagentToggleable(profile, 'explore'), isTrue);
    expect(
      countEnabledSubagents(const {
        'explore': true,
        'architect': false,
        'coder': false,
        'reviewer': false,
        'tester': false,
      }),
      1,
    );
    expect(countConfiguredSubagents(null), 0);
    expect(countConfiguredSubagents(profile), 1);
  });

  test('main agent model override JSON round-trips without losing fields', () {
    final config = _runtimeConfig(
      mainAgentModelOverride: const MainAgentModelOverride(
        providerId: ' provider-1 ',
        modelId: ' gpt-5.6-sol ',
        thinkingEffort: 'high',
        candidateModelId: ' candidate-1 ',
      ),
    );

    final restored = ThreadRuntimeConfig.fromJson(config.toJson());

    expect(restored.mainAgentModelOverride?.providerId, 'provider-1');
    expect(restored.mainAgentModelOverride?.modelId, 'gpt-5.6-sol');
    expect(restored.mainAgentModelOverride?.thinkingEffort, 'high');
    expect(restored.mainAgentModelOverride?.candidateModelId, 'candidate-1');
    expect(restored.toJson(), {
      'routeProfileId': 'p1',
      'agentProfileId': 'p1',
      'subagentEnabled': defaultSubagentAvailability(),
      'mainAgentModelOverride': {
        'providerId': 'provider-1',
        'modelId': 'gpt-5.6-sol',
        'thinkingEffort': 'high',
        'candidateModelId': 'candidate-1',
      },
      'sessionMode': 'agent',
      'bashReviewMode': 'always',
    });
  });

  test('main agent model override omits an unset thinking effort', () {
    final config = _runtimeConfig(
      mainAgentModelOverride: const MainAgentModelOverride(
        providerId: 'provider-1',
        modelId: 'gpt-5.6-sol',
      ),
    );

    final restored = ThreadRuntimeConfig.fromJson(config.toJson());

    expect(restored.mainAgentModelOverride?.thinkingEffort, isNull);
    expect(restored.mainAgentModelOverride?.toJson(), {
      'providerId': 'provider-1',
      'modelId': 'gpt-5.6-sol',
    });
  });

  test('main agent model override rejects invalid JSON', () {
    Map<String, dynamic> runtimeJson(Map<String, dynamic> override) => {
      ..._runtimeConfig().toJson(),
      'mainAgentModelOverride': override,
    };

    expect(
      () => ThreadRuntimeConfig.fromJson(
        runtimeJson({
          'providerId': 'provider-1',
          'modelId': 'gpt-5.6-sol',
          'thinkingEffort': 'ultra',
        }),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => ThreadRuntimeConfig.fromJson(
        runtimeJson({'modelId': 'gpt-5.6-sol', 'thinkingEffort': 'high'}),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => ThreadRuntimeConfig.fromJson({
        ..._runtimeConfig().toJson(),
        'mainAgentModelOverride': null,
      }),
      throwsA(isA<FormatException>()),
    );
  });

  test('copyWith preserves main agent model override', () {
    const override = MainAgentModelOverride(
      providerId: 'provider-1',
      modelId: 'gpt-5.6-sol',
      thinkingEffort: 'high',
    );
    final copied = _runtimeConfig(
      mainAgentModelOverride: override,
    ).copyWith(sessionMode: 'plan');

    expect(copied.mainAgentModelOverride, same(override));
    expect(copied.sessionMode, 'plan');
  });

  test('switching profiles clears main agent model override', () {
    final switched = buildRuntimeConfigForProfile(
      profile: _profile(agents: const []),
      runtimeConfig: _runtimeConfig(
        mainAgentModelOverride: const MainAgentModelOverride(
          providerId: 'provider-1',
          modelId: 'gpt-5.6-sol',
          thinkingEffort: 'high',
        ),
      ),
      servers: const [],
    );

    expect(switched.mainAgentModelOverride, isNull);
  });
}
