import type {
  MainAgentModelOverride,
  ModelSettingsSnapshot,
  ResolvedOrchestrationSnapshot,
  RuntimeRoleRouteConfig,
} from "../shared/ipc";
import { resolveMainAgentModelOverrideForProvider } from "../shared/thread-runtime-config";

type ProviderView = ModelSettingsSnapshot["providers"][number];

export function isModelRefReady(
  modelRef: ResolvedOrchestrationSnapshot["mainAgent"]["modelRef"],
  providersById: ReadonlyMap<string, ProviderView>,
): boolean {
  const provider = providersById.get(modelRef.providerId);
  return Boolean(modelRef.modelId.trim() && provider?.enabled);
}

export function isOrchestrationSnapshotReady(
  snapshot: ResolvedOrchestrationSnapshot,
  providersById: ReadonlyMap<string, ProviderView>,
  mainAgentModelOverride?: MainAgentModelOverride,
): boolean {
  const effectiveMainModel =
    resolveMainAgentModelOverrideForProvider(snapshot.mainAgent.modelRef.providerId, mainAgentModelOverride) ??
    snapshot.mainAgent.modelRef;
  return (
    isModelRefReady(effectiveMainModel, providersById) &&
    snapshot.agents
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
