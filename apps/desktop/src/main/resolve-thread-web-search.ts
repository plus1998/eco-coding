import {
  resolveSupportsNativeWebSearch,
  resolveWebSearchContext,
  type WebSearchBackend,
} from "@eco/runtime";
import type {
  IntegratedWebSearchProvider,
  IntegratedWebSearchSettingsSnapshot,
  RouteManualSpec,
} from "../shared/ipc";

export interface ThreadWebSearchPlan {
  backend: WebSearchBackend;
  integratedApiKey?: string;
  provider?: IntegratedWebSearchProvider;
}

export function resolveThreadWebSearchPlan(input: {
  networkWebSearch: boolean | undefined;
  plannerManualSpec?: RouteManualSpec;
  integratedSettings: IntegratedWebSearchSettingsSnapshot;
  integratedApiKey?: string;
}): ThreadWebSearchPlan {
  const context = resolveWebSearchContext({
    networkWebSearch: input.networkWebSearch,
    supportsNativeWebSearch: resolveSupportsNativeWebSearch(input.plannerManualSpec),
    integratedEnabled: input.integratedSettings.enabled,
    integratedApiKey: input.integratedApiKey,
  });
  if (context.backend === "integrated") {
    return {
      backend: "integrated",
      ...(context.integratedApiKey ? { integratedApiKey: context.integratedApiKey } : {}),
      provider: input.integratedSettings.provider,
    };
  }
  return { backend: context.backend };
}
