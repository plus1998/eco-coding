import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/composer_mcp.dart';
import 'package:eco_mobile/core/models/mcp_models.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_runtime_config.dart';

const _servers = [
  McpServerConfigView(
    id: '1',
    name: 'mongo',
    transport: 'stdio',
    enabled: true,
  ),
  McpServerConfigView(
    id: '2',
    name: 'browser',
    transport: 'stdio',
    enabled: true,
  ),
];

ModelSettingsSnapshot _settings() {
  return ModelSettingsSnapshot(
    mainAgentConfigs: [
      MainAgentConfigResource(
        id: 'main-1',
        name: 'Orchestration',
        agentKey: 'main',
        domain: 'coding',
        modelRef: const OrchestrationModelRef(
          providerId: 'provider-1',
          modelId: 'gpt-5.6-sol',
        ),
        tools: const ToolPolicy(mcp: ToolPolicyMcp(allowedServers: ['mongo'])),
      ),
    ],
    subagentOrchestrations: const [
      SubagentOrchestrationResource(
        id: 'orch-1',
        name: 'Subagents',
        domain: 'coding',
        agents: [],
        strategy: OrchestrationStrategy(kind: 'autonomous'),
      ),
    ],
  );
}

ResolvedOrchestrationSnapshot _snapshot() {
  return resolveOrchestrationSnapshot(
    const OrchestrationSelection(
      mainAgentConfigId: 'main-1',
      mainPrompt: BuiltinMainAgentPromptSelection(),
      subagents: OrchestrationSubagentSelection(orchestrationId: 'orch-1'),
    ),
    OrchestrationResourceLookup(
      mainAgentConfigs: _settings().mainAgentConfigs,
      mainAgentPrompts: const [],
      subagentOrchestrations: _settings().subagentOrchestrations,
    ),
  );
}

void main() {
  test(
    'deriveMcpServersEnabled prefers existing over remembered and orchestration',
    () {
      expect(
        deriveMcpServersEnabled(
          const ['mongo', 'browser'],
          orchestrationAssignedServers: const ['mongo'],
          remembered: const {'mongo': false, 'browser': true},
          existing: const {'mongo': true},
        ),
        const {'mongo': true, 'browser': true},
      );
    },
  );

  test('resolveComposerMcpSettings uses runtime overrides when present', () {
    final runtimeConfig = ThreadRuntimeConfig(
      orchestrationSelection: const OrchestrationSelection(
        mainAgentConfigId: 'main-1',
        mainPrompt: BuiltinMainAgentPromptSelection(),
        subagents: OrchestrationSubagentSelection(orchestrationId: 'orch-1'),
      ),
      resolvedOrchestrationSnapshot: _snapshot(),
      subagentEnabled: defaultSubagentAvailability(),
      mcpServersEnabled: const {'mongo': false, 'browser': true},
      sessionMode: 'agent',
      bashReviewMode: 'always',
    );

    expect(
      resolveComposerMcpSettings(
        servers: _servers,
        runtimeConfig: runtimeConfig,
        snapshot: _snapshot(),
      ),
      const {'mongo': false, 'browser': true},
    );
  });

  test('buildDefaultRuntimeConfig seeds MCP from workflow defaults', () {
    final settings = _settings();
    final config = buildDefaultRuntimeConfig(
      modelSettings: settings,
      workflow: const WorkflowSettingsSnapshot(
        sessionMode: 'agent',
        mcpServersEnabled: {'browser': true},
        defaultOrchestrationSelection: OrchestrationSelection(
          mainAgentConfigId: 'main-1',
          mainPrompt: BuiltinMainAgentPromptSelection(),
          subagents: OrchestrationSubagentSelection(orchestrationId: 'orch-1'),
        ),
      ),
      mcpServers: _servers,
    );

    expect(config.mcpServersEnabled, const {'mongo': true, 'browser': true});
  });

  test(
    'WorkflowSettingsSnapshot toJson includes sessionMode and planModelEnabled',
    () {
      final planSnapshot = const WorkflowSettingsSnapshot(
        sessionMode: 'plan',
        mcpServersEnabled: {'mongo': true},
      );
      final planJson = planSnapshot.toJson();
      expect(planJson['sessionMode'], 'plan');
      expect(planJson['planModelEnabled'], true);
      expect(planJson['mcpServersEnabled'], {'mongo': true});

      final agentSnapshot = const WorkflowSettingsSnapshot(
        sessionMode: 'agent',
        mcpServersEnabled: {'mongo': true},
      );
      final agentJson = agentSnapshot.toJson();
      expect(agentJson['sessionMode'], 'agent');
      expect(agentJson['planModelEnabled'], false);
      expect(agentJson['mcpServersEnabled'], {'mongo': true});

      final noMcpSnapshot = const WorkflowSettingsSnapshot(sessionMode: 'ask');
      final noMcpJson = noMcpSnapshot.toJson();
      expect(noMcpJson['sessionMode'], 'ask');
      expect(noMcpJson['planModelEnabled'], false);
      expect(noMcpJson.containsKey('mcpServersEnabled'), false);
    },
  );

  test('ModelSettingsSnapshot parses embedded mcpSettings', () {
    final settings = ModelSettingsSnapshot.fromJson({
      'mainAgentConfigs': [],
      'mainAgentPrompts': [],
      'subagentOrchestrations': [],
      'mcpSettings': {
        'servers': [
          {'id': '1', 'name': 'mongo', 'transport': 'stdio', 'enabled': true},
        ],
      },
    });

    expect(settings.mcpSettings?.servers.length, 1);
    expect(settings.mcpSettings?.servers.first.name, 'mongo');
  });
}
