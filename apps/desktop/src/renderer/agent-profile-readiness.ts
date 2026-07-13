import { listOrchestrationProfileAgents } from "../shared/agent-orchestration";
import type {
  MainAgentModelOverride,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  RuntimeRoleRouteConfig,
} from "../shared/ipc";
import { resolveMainAgentModelOverrideForProvider } from "../shared/thread-runtime-config";

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
  mainAgentModelOverride?: MainAgentModelOverride,
): boolean {
  const effectiveMainModel =
    resolveMainAgentModelOverrideForProvider(profile.mainAgent.modelRef.providerId, mainAgentModelOverride) ??
    profile.mainAgent.modelRef;
  return (
    isModelRefReady(effectiveMainModel, providersById) &&
    listOrchestrationProfileAgents(profile)
      .filter((agent) => agent.enabled)
      .every((agent) => isModelRefReady(agent.modelRef, providersById))
  );
}

export function areCodingRoutesReady(
  routes: readonly RuntimeRoleRouteConfig[],
  providersById: ReadonlyMap<string, ProviderView>,
): boolean {
  if (!routes.some((route) => route.role === "planner")) {
    return false;
  }
  return routes.every((route) => {
    const provider = route ? providersById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled);
  });
}
