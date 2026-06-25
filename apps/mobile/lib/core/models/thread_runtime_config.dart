import '../constants/session_mode.dart';
import 'composer_mcp.dart';
import 'mcp_models.dart';
import 'thread_models.dart';

OrchestrationProfile? agentProfileById(
  ModelSettingsSnapshot? settings,
  String? profileId,
) {
  final id = profileId?.trim();
  if (id == null || id.isEmpty || settings == null) return null;
  for (final profile in settings.orchestrationProfiles) {
    if (profile.id == id) return profile;
  }
  return null;
}

OrchestrationProfile? resolveThreadAgentProfile(
  ModelSettingsSnapshot? settings,
  ThreadRuntimeConfig config,
) {
  return agentProfileById(settings, config.agentProfileId) ??
      agentProfileById(settings, config.routeProfileId);
}

Map<String, bool> deriveSubagentEnabledFromProfile(
  OrchestrationProfile profile, {
  Map<String, bool>? existing,
}) {
  final subagentEnabled = defaultSubagentAvailability();
  for (final role in subagentRoles) {
    if (role == 'explore') {
      subagentEnabled[role] = true;
      continue;
    }
    OrchestrationAgentInstance? agent;
    for (final candidate in profile.agents) {
      if (candidate.agentKey == role) {
        agent = candidate;
        break;
      }
    }
    if (agent == null || !agent.enabled) {
      subagentEnabled[role] = false;
      continue;
    }
    final existingValue = existing?[role];
    if (existingValue is bool) {
      subagentEnabled[role] = existingValue;
    }
  }
  return subagentEnabled;
}

List<String> collectProfileAssignedMcpServers(OrchestrationProfile profile) {
  final servers = <String>{};
  for (final server in profile.mainAssignedMcpServers) {
    servers.add(sanitizeMcpServerName(server));
  }
  for (final agent in profile.agents) {
    if (!agent.enabled) continue;
    for (final server in agent.mcpServers) {
      servers.add(sanitizeMcpServerName(server));
    }
  }
  return servers.toList(growable: false);
}

Map<String, bool> resolveComposerMcpSettings({
  required List<McpServerConfigView> servers,
  required ThreadRuntimeConfig runtimeConfig,
  OrchestrationProfile? profile,
  Map<String, bool>? remembered,
}) {
  final availableServerKeys = listEnabledGlobalMcpServerKeys(servers);
  if (availableServerKeys.isEmpty) {
    return const {};
  }
  if (runtimeConfig.mcpServersEnabled != null) {
    return deriveMcpServersEnabled(
      availableServerKeys,
      existing: runtimeConfig.mcpServersEnabled,
    );
  }
  return deriveMcpServersEnabled(
    availableServerKeys,
    profileAssignedServers: profile == null
        ? const []
        : collectProfileAssignedMcpServers(profile),
    remembered: remembered,
  );
}

ThreadRuntimeConfig buildRuntimeConfigForProfile({
  required OrchestrationProfile profile,
  required ThreadRuntimeConfig runtimeConfig,
  required List<McpServerConfigView> servers,
  Map<String, bool>? remembered,
}) {
  final availableKeys = listEnabledGlobalMcpServerKeys(servers);
  return ThreadRuntimeConfig(
    routeProfileId: profile.id,
    agentProfileId: profile.id,
    subagentEnabled: deriveSubagentEnabledFromProfile(
      profile,
      existing: runtimeConfig.subagentEnabled,
    ),
    mcpServersEnabled: availableKeys.isEmpty
        ? null
        : deriveMcpServersEnabled(
            availableKeys,
            profileAssignedServers: collectProfileAssignedMcpServers(profile),
            existing: runtimeConfig.mcpServersEnabled,
            remembered: remembered,
          ),
    sessionMode: runtimeConfig.sessionMode,
    bashReviewMode: runtimeConfig.bashReviewMode,
  );
}

ThreadRuntimeConfig buildDefaultRuntimeConfig({
  ModelSettingsSnapshot? modelSettings,
  WorkflowSettingsSnapshot? workflow,
  List<McpServerConfigView>? mcpServers,
  String? profileId,
}) {
  final profiles = modelSettings?.orchestrationProfiles ?? [];
  if (profiles.isEmpty) {
    return ThreadRuntimeConfig(
      routeProfileId: '',
      subagentEnabled: defaultSubagentAvailability(),
      sessionMode: resolveSessionMode(sessionMode: workflow?.sessionMode),
      bashReviewMode: 'always',
    );
  }

  OrchestrationProfile? profile;
  final requestedId = profileId?.trim();
  if (requestedId != null && requestedId.isNotEmpty) {
    profile = agentProfileById(modelSettings, requestedId);
  }
  profile ??= profiles.first;

  final availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpServers ?? []);
  final mcpServersEnabled = availableMcpServerKeys.isEmpty
      ? null
      : deriveMcpServersEnabled(
          availableMcpServerKeys,
          profileAssignedServers: collectProfileAssignedMcpServers(profile),
          remembered: workflow?.mcpServersEnabled,
        );

  return ThreadRuntimeConfig(
    routeProfileId: profile.id,
    agentProfileId: profile.id,
    subagentEnabled: deriveSubagentEnabledFromProfile(profile),
    mcpServersEnabled: mcpServersEnabled,
    sessionMode: normalizeSessionMode(workflow?.sessionMode),
    bashReviewMode: 'always',
  );
}

bool isSubagentConfiguredInProfile(
  OrchestrationProfile? profile,
  String role,
) {
  if (role == 'explore') return true;
  if (profile == null) return false;
  for (final agent in profile.agents) {
    if (agent.agentKey == role) {
      return agent.enabled;
    }
  }
  return false;
}

Map<String, bool> normalizedRuntimeSubagentEnabled(
  Map<String, bool> subagentEnabled,
) {
  return normalizeSubagentAvailability(subagentEnabled);
}

bool isRuntimeSubagentEnabled(
  Map<String, bool> subagentEnabled,
  String role,
) {
  if (role == 'explore') {
    return true;
  }
  return normalizedRuntimeSubagentEnabled(subagentEnabled)[role] ?? true;
}

bool isSubagentToggleable(
  OrchestrationProfile? profile,
  String role,
) {
  return role != 'explore' && isSubagentConfiguredInProfile(profile, role);
}

int countEnabledSubagents(Map<String, bool> subagentEnabled) {
  return subagentRoles
      .where((role) => role != 'explore')
      .where((role) => subagentEnabled[role] ?? false)
      .length;
}

int countConfiguredSubagents(OrchestrationProfile? profile) {
  return configuredOrchestrationSubagentRoles(profile)
      .where((role) => role != 'explore')
      .length;
}

/// Sub-agent roles shown in orchestration UI (aligned with desktop profile routes).
List<String> configuredOrchestrationSubagentRoles(
  OrchestrationProfile? profile,
) {
  return subagentRoles
      .where(
        (role) => role == 'explore' || isSubagentConfiguredInProfile(profile, role),
      )
      .toList(growable: false);
}
