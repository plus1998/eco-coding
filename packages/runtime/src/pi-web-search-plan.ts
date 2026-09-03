/** Shared across Claude / Codex / PI: provider-native vs Eco Integrated vs off. */
export type WebSearchBackend = "native" | "integrated" | "none";

/** @deprecated Use WebSearchBackend */
export type PiWebSearchBackend = WebSearchBackend;

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

export function resolveWebSearchPlan(input: {
  networkWebSearch: boolean | undefined;
  supportsNativeWebSearch?: boolean;
  integratedSearchConfigured: boolean;
}): WebSearchBackend {
  if (input.networkWebSearch === false) {
    return "none";
  }
  // Prefer Eco Integrated when the user configured it. Native defaults to "supported"
  // for models that cannot actually run provider-native search (e.g. LongCat), which
  // previously shadowed Integrated and left PI with a failing built-in tool.
  if (input.integratedSearchConfigured) {
    return "integrated";
  }
  if (resolveSupportsNativeWebSearch({ supportsNativeWebSearch: input.supportsNativeWebSearch })) {
    return "native";
  }
  return "none";
}

/** @deprecated Use resolveWebSearchPlan */
export const resolvePiWebSearchPlan = resolveWebSearchPlan;

export function resolveWebSearchContext(input: {
  networkWebSearch: boolean | undefined;
  supportsNativeWebSearch?: boolean;
  integratedEnabled?: boolean;
  integratedApiKey?: string;
}): { backend: WebSearchBackend; integratedApiKey?: string } {
  const integratedSearchConfigured = isIntegratedWebSearchConfigured({
    enabled: input.integratedEnabled,
    apiKey: input.integratedApiKey,
  });
  const backend = resolveWebSearchPlan({
    networkWebSearch: input.networkWebSearch,
    supportsNativeWebSearch: input.supportsNativeWebSearch,
    integratedSearchConfigured,
  });
  if (backend === "integrated" && input.integratedApiKey?.trim()) {
    return { backend, integratedApiKey: input.integratedApiKey.trim() };
  }
  return { backend };
}

/** @deprecated Use resolveWebSearchContext */
export const resolvePiWebSearchContext = resolveWebSearchContext;
