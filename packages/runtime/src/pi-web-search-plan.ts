export type PiWebSearchBackend = "native" | "integrated" | "none";

export const PI_WEB_SEARCH_TOOL_NAME = "web_search" as const;

/** Default true when manualSpec omits the field. */
export function resolveSupportsNativeWebSearch(manualSpec?: {
  supportsNativeWebSearch?: boolean;
}): boolean {
  return manualSpec?.supportsNativeWebSearch !== false;
}

export function isIntegratedWebSearchConfigured(input: {
  enabled?: boolean;
  apiKey?: string;
}): boolean {
  return input.enabled === true && Boolean(input.apiKey?.trim());
}

export function resolvePiWebSearchPlan(input: {
  networkWebSearch: boolean | undefined;
  supportsNativeWebSearch?: boolean;
  integratedSearchConfigured: boolean;
}): PiWebSearchBackend {
  if (input.networkWebSearch === false) {
    return "none";
  }
  if (resolveSupportsNativeWebSearch({ supportsNativeWebSearch: input.supportsNativeWebSearch })) {
    return "native";
  }
  if (input.integratedSearchConfigured) {
    return "integrated";
  }
  return "none";
}

export function resolvePiWebSearchContext(input: {
  networkWebSearch: boolean | undefined;
  supportsNativeWebSearch?: boolean;
  integratedEnabled?: boolean;
  integratedApiKey?: string;
}): { backend: PiWebSearchBackend; integratedApiKey?: string } {
  const integratedSearchConfigured = isIntegratedWebSearchConfigured({
    enabled: input.integratedEnabled,
    apiKey: input.integratedApiKey,
  });
  const backend = resolvePiWebSearchPlan({
    networkWebSearch: input.networkWebSearch,
    supportsNativeWebSearch: input.supportsNativeWebSearch,
    integratedSearchConfigured,
  });
  if (backend === "integrated" && input.integratedApiKey?.trim()) {
    return { backend, integratedApiKey: input.integratedApiKey.trim() };
  }
  return { backend };
}
