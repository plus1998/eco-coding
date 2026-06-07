import { AGENT_ROLES } from "../shared/ipc";
import type { ModelSettingsSnapshot, OrchestrationProfile, RuntimeRoleRouteConfig } from "../shared/ipc";

type ProviderView = ModelSettingsSnapshot["providers"][number];

export function isModelRefReady(
  modelRef: OrchestrationProfile["mainAgent"]["modelRef"],
  providersById: ReadonlyMap<string, ProviderView>,
): boolean {
  const provider = providersById.get(modelRef.providerId);
  return Boolean(modelRef.modelId.trim() && provider?.enabled);
}

export function isAgentProfileReady(
  profile: OrchestrationProfile,
  providersById: ReadonlyMap<string, ProviderView>,
): boolean {
  return (
    isModelRefReady(profile.mainAgent.modelRef, providersById) &&
    profile.agents
      .filter((agent) => agent.enabled)
      .every((agent) => isModelRefReady(agent.modelRef, providersById))
  );
}

export function areCodingRoutesReady(
  routes: readonly RuntimeRoleRouteConfig[],
  providersById: ReadonlyMap<string, ProviderView>,
): boolean {
  return AGENT_ROLES.every((role) => {
    const route = routes.find((candidate) => candidate.role === role);
    const provider = route ? providersById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled);
  });
}
