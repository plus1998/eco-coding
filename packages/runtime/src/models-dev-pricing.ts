import type { ModelCostRates } from "./billing";

const MODELS_DEV_API_URL = "https://models.dev/api.json";

/** Short aliases used in provider configs → models.dev family prefix. */
const MODEL_ALIASES: Record<string, string[]> = {
  sonnet: ["claude-sonnet"],
  opus: ["claude-opus"],
  haiku: ["claude-haiku"],
};

export interface ModelsDevProviderEntry {
  id: string;
  api?: string;
  models: Record<string, ModelsDevModelEntry>;
}

export interface ModelsDevModelEntry {
  id: string;
  name?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export type ModelsDevCatalog = Record<string, ModelsDevProviderEntry>;

export interface ModelPricingLookup {
  providerKey: string;
  modelId: string;
  rates: ModelCostRates;
  displayName?: string;
}

export function resolveProviderKeyFromBaseUrl(baseUrl: string): string | null {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, "");
  if (normalized.includes("api.anthropic.com")) {
    return "anthropic";
  }
  if (normalized.includes("openrouter.ai")) {
    return "openrouter";
  }
  if (normalized.includes("generativelanguage.googleapis.com") || normalized.includes("googleapis.com")) {
    return "google";
  }
  if (normalized.includes("api.openai.com")) {
    return "openai";
  }
  if (normalized.includes("api.deepseek.com")) {
    return "deepseek";
  }
  if (normalized.includes("api.mistral.ai")) {
    return "mistral";
  }
  if (normalized.includes("api.groq.com")) {
    return "groq";
  }
  if (normalized.includes("api.x.ai")) {
    return "xai";
  }
  return null;
}

export function extractRatesFromModelEntry(entry: ModelsDevModelEntry): ModelCostRates | null {
  const cost = entry.cost;
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
    return null;
  }
  return {
    input: cost.input,
    output: cost.output,
    ...(typeof cost.cache_read === "number" && { cacheRead: cost.cache_read }),
    ...(typeof cost.cache_write === "number" && { cacheWrite: cost.cache_write }),
  };
}

export function lookupModelCostInCatalog(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  modelId: string,
): ModelPricingLookup | null {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return null;
  }

  if (providerHint && catalog[providerHint]) {
    const direct = lookupInProvider(catalog[providerHint]!, trimmed);
    if (direct) {
      return buildPricingLookup(providerHint, direct);
    }
  }

  for (const [providerKey, provider] of Object.entries(catalog)) {
    if (providerHint && providerKey !== providerHint) {
      continue;
    }
    const match = lookupInProvider(provider, trimmed);
    if (match) {
      return buildPricingLookup(providerKey, match);
    }
  }

  if (!providerHint) {
    for (const [providerKey, provider] of Object.entries(catalog)) {
      const match = lookupInProvider(provider, trimmed);
      if (match) {
        return buildPricingLookup(providerKey, match);
      }
    }
  }

  return null;
}

function buildPricingLookup(
  providerKey: string,
  match: { modelId: string; rates: ModelCostRates; displayName?: string },
): ModelPricingLookup {
  return {
    providerKey,
    modelId: match.modelId,
    rates: match.rates,
    ...(match.displayName && { displayName: match.displayName }),
  };
}

function matchFromEntry(entry: ModelsDevModelEntry): {
  modelId: string;
  rates: ModelCostRates;
  displayName?: string;
} | null {
  const rates = extractRatesFromModelEntry(entry);
  if (!rates) {
    return null;
  }
  return {
    modelId: entry.id,
    rates,
    ...(entry.name && { displayName: entry.name }),
  };
}

function lookupInProvider(
  provider: ModelsDevProviderEntry,
  modelId: string,
): { modelId: string; rates: ModelCostRates; displayName?: string } | null {
  const exact = provider.models[modelId];
  if (exact) {
    const matched = matchFromEntry(exact);
    if (matched) {
      return matched;
    }
  }

  const lower = modelId.toLowerCase();
  for (const entry of Object.values(provider.models)) {
    if (entry.id.toLowerCase() === lower) {
      const matched = matchFromEntry(entry);
      if (matched) {
        return matched;
      }
    }
  }

  const aliasPrefixes = MODEL_ALIASES[lower];
  if (aliasPrefixes) {
    const candidates = Object.values(provider.models)
      .filter((entry) => aliasPrefixes.some((prefix) => entry.id.toLowerCase().includes(prefix)))
      .sort((a, b) => b.id.localeCompare(a.id));
    for (const entry of candidates) {
      const matched = matchFromEntry(entry);
      if (matched) {
        return matched;
      }
    }
  }

  const fuzzy = Object.values(provider.models)
    .filter((entry) => entry.id.toLowerCase().includes(lower) || lower.includes(entry.id.toLowerCase()))
    .sort((a, b) => a.id.length - b.id.length);
  for (const entry of fuzzy) {
    const matched = matchFromEntry(entry);
    if (matched) {
      return matched;
    }
  }

  return null;
}

export function parseModelsDevCatalog(payload: unknown): ModelsDevCatalog {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  return payload as ModelsDevCatalog;
}

export async function fetchModelsDevCatalog(
  fetchImpl: typeof fetch = fetch,
  url = MODELS_DEV_API_URL,
): Promise<ModelsDevCatalog> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`models.dev fetch failed: ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return parseModelsDevCatalog(payload);
}

export function formatModelPricingLabel(lookup: ModelPricingLookup): string {
  const name = lookup.displayName ?? lookup.modelId;
  return `${name} · $${lookup.rates.input}/$${lookup.rates.output} per M`;
}
