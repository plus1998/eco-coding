import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';
import 'package:eco_mobile/features/composer/composer_controls.dart';

MainAgentConfigResource _mainConfig({String id = 'main-1'}) {
  return MainAgentConfigResource(
    id: id,
    name: 'Coding Main',
    agentKey: 'main',
    modelRef: const OrchestrationModelRef(
      providerId: 'provider-1',
      modelId: 'gpt-5.6-sol',
      thinkingEffort: 'high',
    ),
    tools: const ToolPolicy(
      mcp: ToolPolicyMcp(allowedServers: ['mongo']),
      confirmation: 'always',
    ),
  );
}

SubagentOrchestrationResource _subagentOrchestration() {
  return SubagentOrchestrationResource(
    id: 'orch-1',
    name: 'Coding Subagents',
    agents: const [
      AgentInstanceConfig(
        agentKey: 'coder',
        templateId: 'builtin.coding.coder',
        enabled: true,
        modelRef: OrchestrationModelRef(
          providerId: 'provider-1',
          modelId: 'gpt-5.6-sol',
        ),
        tools: ToolPolicy(),
      ),
      AgentInstanceConfig(
        agentKey: 'explore',
        templateId: 'builtin.coding.explore',
        enabled: true,
        modelRef: OrchestrationModelRef(
          providerId: 'provider-1',
          modelId: 'gpt-5.6-sol',
        ),
        tools: ToolPolicy(),
      ),
    ],
    strategy: OrchestrationStrategy(kind: 'autonomous'),
  );
}

ModelSettingsSnapshot _settings({
  List<MainAgentConfigResource>? mainAgentConfigs,
  List<SubagentOrchestrationResource>? subagentOrchestrations,
}) {
  return ModelSettingsSnapshot(
    mainAgentConfigs: mainAgentConfigs ?? [_mainConfig()],
    subagentOrchestrations:
        subagentOrchestrations ?? [_subagentOrchestration()],
  );
}

OrchestrationSelection _selection({
  SubagentSelection subagents = const OrchestrationSubagentSelection(
    orchestrationId: 'orch-1',
  ),
}) {
  return OrchestrationSelection(
    mainAgentConfigId: 'main-1',
    mainPrompt: const BuiltinMainAgentPromptSelection(),
    subagents: subagents,
  );
}

ThreadRuntimeConfig _runtimeConfig({
  OrchestrationSelection? orchestrationSelection,
  ResolvedOrchestrationSnapshot? resolvedOrchestrationSnapshot,
  MainAgentModelOverride? mainAgentModelOverride,
  Map<String, bool>? integrationsEnabled,
}) {
  return ThreadRuntimeConfig(
    orchestrationSelection: orchestrationSelection ?? _selection(),
    resolvedOrchestrationSnapshot: resolvedOrchestrationSnapshot,
    subagentEnabled: defaultSubagentAvailability(),
    mainAgentModelOverride: mainAgentModelOverride,
    integrationsEnabled: integrationsEnabled,
    sessionMode: 'agent',
    bashReviewMode: 'always',
  );
}

void main() {
  test(
    'deriveSubagentEnabledFromSnapshot disables roles missing from snapshot',
    () {
      final snapshot = resolveOrchestrationSnapshot(
        _selection(
          subagents: const OrchestrationSubagentSelection(
            orchestrationId: 'orch-1',
          ),
        ),
        OrchestrationResourceLookup(
          mainAgentConfigs: [_mainConfig()],
          mainAgentPrompts: const [],
          subagentOrchestrations: [
            SubagentOrchestrationResource(
              id: 'orch-1',
              name: 'Coding Subagents',
              agents: const [
                AgentInstanceConfig(
                  agentKey: 'coder',
                  templateId: 'builtin.coding.coder',
                  enabled: true,
                  modelRef: OrchestrationModelRef(
                    providerId: 'provider-1',
                    modelId: 'gpt-5.6-sol',
                  ),
                  tools: ToolPolicy(),
                ),
              ],
              strategy: OrchestrationStrategy(kind: 'autonomous'),
            ),
          ],
        ),
      );

      final derived = deriveSubagentEnabledFromSnapshot(snapshot);

      expect(derived['architect'], isFalse);
      expect(derived['coder'], isTrue);
      expect(derived['explore'], isFalse);
    },
  );

  test(
    'deriveSubagentEnabledFromSnapshot preserves existing runtime toggles',
    () {
      final snapshot = resolveOrchestrationSnapshot(
        _selection(),
        OrchestrationResourceLookup(
          mainAgentConfigs: [_mainConfig()],
          mainAgentPrompts: const [],
          subagentOrchestrations: [_subagentOrchestration()],
        ),
      );

      final derived = deriveSubagentEnabledFromSnapshot(
        snapshot,
        existing: const {'explore': false, 'coder': false, 'reviewer': true},
      );

      expect(derived['explore'], isFalse);
      expect(derived['coder'], isFalse);
      expect(derived['reviewer'], isFalse);
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
    final snapshot = resolveOrchestrationSnapshot(
      _selection(),
      OrchestrationResourceLookup(
        mainAgentConfigs: [_mainConfig()],
        mainAgentPrompts: const [],
        subagentOrchestrations: [_subagentOrchestration()],
      ),
    );
    expect(isSubagentToggleable(null, 'explore'), isFalse);
    expect(isSubagentToggleable(snapshot, 'explore'), isTrue);
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
    expect(countConfiguredSubagents(snapshot), 2);
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
      'orchestrationSelection': _selection().toJson(),
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

  test(
    'integrationsEnabled JSON round-trips without unknown integration ids',
    () {
      final config = _runtimeConfig(
        integrationsEnabled: const {'browser': true, 'imageGeneration': false},
      );

      final restored = ThreadRuntimeConfig.fromJson(config.toJson());

      expect(restored.integrationsEnabled, const {
        'browser': true,
        'imageGeneration': false,
      });
    },
  );

  test('legacy browser MCP flag migrates to integrationsEnabled', () {
    final json = _runtimeConfig().toJson();
    json['mcpServersEnabled'] = {'eco_agent_browser': true, 'docs': false};

    final restored = ThreadRuntimeConfig.fromJson(json);

    expect(restored.integrationsEnabled, const {'browser': true});
    expect(restored.mcpServersEnabled, const {'docs': false});
  });

  test('auxiliary model JSON round-trips through runtime and workflow', () {
    const auxiliaryModel = AuxiliaryModelSelection(
      providerId: 'provider-2',
      modelId: 'fast-model',
      candidateModelId: 'candidate-fast',
    );
    final runtime = _runtimeConfig().copyWith(auxiliaryModel: auxiliaryModel);

    final restoredRuntime = ThreadRuntimeConfig.fromJson(runtime.toJson());
    final workflow = WorkflowSettingsSnapshot.fromJson(
      const WorkflowSettingsSnapshot(
        sessionMode: 'agent',
        defaultAuxiliaryModel: auxiliaryModel,
      ).toJson(),
    );

    expect(restoredRuntime.auxiliaryModel?.providerId, 'provider-2');
    expect(restoredRuntime.auxiliaryModel?.modelId, 'fast-model');
    expect(restoredRuntime.auxiliaryModel?.candidateModelId, 'candidate-fast');
    expect(workflow.defaultAuxiliaryModel?.candidateModelId, 'candidate-fast');
  });

  test('vision model JSON round-trips through runtime and workflow', () {
    const visionModel = VisionModelSelection(
      providerId: 'provider-3',
      modelId: 'vision-model',
      candidateModelId: 'candidate-vision',
    );
    final runtime = _runtimeConfig().copyWith(visionModel: visionModel);

    final restoredRuntime = ThreadRuntimeConfig.fromJson(runtime.toJson());
    final workflow = WorkflowSettingsSnapshot.fromJson(
      const WorkflowSettingsSnapshot(
        sessionMode: 'agent',
        defaultVisionModel: visionModel,
      ).toJson(),
    );

    expect(restoredRuntime.visionModel?.providerId, 'provider-3');
    expect(restoredRuntime.visionModel?.modelId, 'vision-model');
    expect(restoredRuntime.visionModel?.candidateModelId, 'candidate-vision');
    expect(workflow.defaultVisionModel?.candidateModelId, 'candidate-vision');
  });

  test('buildDefaultRuntimeConfig copies default vision model', () {
    final config = buildDefaultRuntimeConfig(
      workflow: const WorkflowSettingsSnapshot(
        sessionMode: 'agent',
        defaultVisionModel: VisionModelSelection(
          providerId: 'provider-3',
          modelId: 'vision-model',
          candidateModelId: 'candidate-vision',
        ),
      ),
    );
    expect(config.visionModel?.modelId, 'vision-model');
  });

  test('missing auxiliary model downgrades automatic review to manual', () {
    final automatic = _runtimeConfig().copyWith(bashReviewMode: 'auto');
    final downgraded = downgradeAuxiliaryDependentFeatures(automatic);

    expect(downgraded.bashReviewMode, 'always');
    expect(
      downgradeAuxiliaryDependentFeatures(
        automatic.copyWith(
          auxiliaryModel: const AuxiliaryModelSelection(
            providerId: 'provider-2',
            modelId: 'fast-model',
            candidateModelId: 'candidate-fast',
          ),
        ),
      ).bashReviewMode,
      'auto',
    );
  });

  test('legacy runtime config fields are rejected', () {
    expect(
      () => ThreadRuntimeConfig.fromJson({
        'agentProfileId': 'legacy',
        'subagentEnabled': defaultSubagentAvailability(),
        'sessionMode': 'agent',
        'bashReviewMode': 'always',
      }),
      throwsFormatException,
    );
  });

  test('hasCompleteOrchestrationSelection validates composition', () {
    expect(
      hasCompleteOrchestrationSelection(
        const OrchestrationSelection(
          mainAgentConfigId: 'main-1',
          mainPrompt: BuiltinMainAgentPromptSelection(),
          subagents: NoneSubagentSelection(),
        ),
      ),
      isTrue,
    );
    expect(
      hasCompleteOrchestrationSelection(
        const OrchestrationSelection(
          mainAgentConfigId: '',
          mainPrompt: BuiltinMainAgentPromptSelection(),
          subagents: NoneSubagentSelection(),
        ),
      ),
      isFalse,
    );
  });

  test('model settings parse main agent config resources', () {
    final settings = ModelSettingsSnapshot.fromJson({
      'providers': [
        {
          'id': 'provider-1',
          'name': 'OpenAI',
          'defaultModel': 'gpt-5.6',
          'enabled': true,
        },
      ],
      'mainAgentConfigs': [
        {
          'id': 'main-1',
          'name': 'Coding',
          'agentKey': 'main',
          'modelRef': {
            'providerId': 'provider-1',
            'modelId': 'gpt-5.6-sol',
            'thinkingEffort': 'high',
          },
          'tools': {'allowed': [], 'disallowed': []},
          'skills': [],
          'updatedAt': '2026-01-01T00:00:00.000Z',
          'source': 'user',
        },
      ],
      'mainAgentPrompts': [],
      'subagentOrchestrations': [],
    });

    expect(settings.providers.single.name, 'OpenAI');
    expect(settings.mainAgentConfigs.single.modelRef.modelId, 'gpt-5.6-sol');
    expect(settings.mainAgentConfigs.single.modelRef.thinkingEffort, 'high');
  });

  test('temporary model options follow desktop candidate behavior', () {
    const provider = ModelProviderView(
      id: 'provider-1',
      name: 'OpenAI',
      defaultModel: 'gpt-default',
      enabled: true,
    );
    const template = OrchestrationModelRef(
      providerId: 'provider-1',
      modelId: 'gpt-template',
      candidateModelId: 'candidate-template',
    );
    final options = buildComposerTemporaryModelOptions(
      provider: provider,
      templateModel: template,
      candidates: const [
        CandidateModelView(
          id: 'candidate-fast',
          providerId: 'provider-1',
          modelId: 'gpt-fast',
          displayName: 'Fast',
          resolvedSupportsReasoning: false,
        ),
        CandidateModelView(
          id: 'candidate-fast-copy',
          providerId: 'provider-1',
          modelId: 'gpt-fast',
        ),
      ],
    );

    expect(options.map((option) => option.modelId), [
      'gpt-template',
      'gpt-fast',
      'gpt-default',
    ]);
    expect(
      composerTemporaryModelSelected(
        const MainAgentModelOverride(
          providerId: 'provider-1',
          modelId: 'gpt-fast',
          candidateModelId: 'candidate-fast',
        ),
        options[1],
      ),
      isTrue,
    );
    expect(
      composerTemporaryModelMatchesTemplate(options.first, template),
      isTrue,
    );
    expect(options[1].supportsReasoning, isFalse);
  });

  test('remote list summary keeps the session runtime config when omitted', () {
    final session = ThreadSummary(
      id: 'thr_1',
      title: 'Session',
      prompt: 'hello',
      workspacePath: '/tmp/workspace',
      status: 'idle',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      message: '',
      coreKind: 'claude',
      runtimeConfig: _runtimeConfig(
        mainAgentModelOverride: const MainAgentModelOverride(
          providerId: 'provider-1',
          modelId: 'gpt-5.6-sol',
          thinkingEffort: 'high',
        ),
      ),
    );
    final listed = ThreadSummary(
      id: 'thr_1',
      title: 'Session',
      prompt: 'hello',
      workspacePath: '/tmp/workspace',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      message: '正在启动…',
    );

    final merged = mergeThreadSummaryFromRemoteList(
      current: session,
      listed: listed,
    );

    expect(merged.status, 'running');
    expect(merged.message, '正在启动…');
    expect(merged.coreKind, 'claude');
    expect(
      merged.runtimeConfig?.mainAgentModelOverride?.modelId,
      'gpt-5.6-sol',
    );
  });

  test('switching orchestration clears main agent model override', () {
    final switched = buildRuntimeConfigForSelection(
      settings: _settings(),
      selection: _selection(),
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

  test(
    'buildDefaultRuntimeConfig returns pending config without complete selection',
    () {
      final config = buildDefaultRuntimeConfig(
        modelSettings: _settings(),
        workflow: const WorkflowSettingsSnapshot(sessionMode: 'agent'),
        mcpServers: const [],
        orchestrationSelection: const OrchestrationSelection(
          mainAgentConfigId: '',
          mainPrompt: BuiltinMainAgentPromptSelection(),
          subagents: NoneSubagentSelection(),
        ),
      );

      expect(config.resolvedOrchestrationSnapshot, isNull);
      expect(isThreadOrchestrationReady(_settings(), config), isFalse);
    },
  );
}
