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
    if (existing != null && existing.containsKey(role)) {
      subagentEnabled[role] = existing[role] ?? true;
    }
  }
  return subagentEnabled;
}

ThreadRuntimeConfig buildDefaultRuntimeConfig({
  ModelSettingsSnapshot? modelSettings,
  WorkflowSettingsSnapshot? workflow,
  String? profileId,
}) {
  final profiles = modelSettings?.orchestrationProfiles ?? [];
  if (profiles.isEmpty) {
    return ThreadRuntimeConfig(
      routeProfileId: '',
      subagentEnabled: defaultSubagentAvailability(),
      planModeEnabled: workflow?.planModeEnabled ?? false,
      bashReviewMode: 'always',
    );
  }

  OrchestrationProfile? profile;
  final requestedId = profileId?.trim();
  if (requestedId != null && requestedId.isNotEmpty) {
    profile = agentProfileById(modelSettings, requestedId);
  }
  profile ??= profiles.first;

  return ThreadRuntimeConfig(
    routeProfileId: profile.id,
    agentProfileId: profile.id,
    subagentEnabled: deriveSubagentEnabledFromProfile(profile),
    planModeEnabled: workflow?.planModeEnabled ?? false,
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
    if (agent.agentKey == role) return agent.enabled;
  }
  return false;
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
  return subagentRoles
      .where((role) => role != 'explore')
      .where((role) => isSubagentConfiguredInProfile(profile, role))
      .length;
}
