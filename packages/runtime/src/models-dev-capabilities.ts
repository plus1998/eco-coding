import {
  type ModelsDevCatalog,
  type ModelsDevModelEntry,
  type ModelsDevProviderEntry,
  lookupModelCostInCatalog,
} from "./models-dev-pricing";

const MODEL_ALIASES: Record<string, string[]> = {
  sonnet: ["claude-sonnet"],
  opus: ["claude-opus"],
  haiku: ["claude-haiku"],
};

export interface ModelCapabilities {
  supportsImageInput: boolean;
  supportsReasoning: boolean;
  capabilitiesResolved: boolean;
  displayName?: string;
}

export interface ModelCapabilitiesLookup {
  providerKey: string;
  modelId: string;
  capabilities: ModelCapabilities;
}

export function extractCapabilitiesFromModelEntry(entry: ModelsDevModelEntry): ModelCapabilities {
  const inputModalities = entry.modalities?.input ?? [];
  return {
    supportsImageInput: inputModalities.includes("image"),
    supportsReasoning: entry.reasoning === true,
    capabilitiesResolved: true,
    ...(entry.name && { displayName: entry.name }),
  };
}

export function lookupModelCapabilitiesInCatalog(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  modelId: string,
): ModelCapabilitiesLookup | null {
  const pricing = lookupModelCostInCatalog(catalog, providerHint, modelId);
  if (pricing) {
    const provider = catalog[pricing.providerKey];
    const entry = provider ? findModelEntry(provider, pricing.modelId) : undefined;
    if (entry) {
      return {
        providerKey: pricing.providerKey,
        modelId: pricing.modelId,
        capabilities: extractCapabilitiesFromModelEntry(entry),
      };
    }
  }

  return lookupCapabilitiesOnly(catalog, providerHint, modelId);
}

function lookupCapabilitiesOnly(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  modelId: string,
): ModelCapabilitiesLookup | null {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return null;
  }

  if (providerHint && catalog[providerHint]) {
    const match = lookupCapabilitiesInProvider(catalog[providerHint]!, trimmed);
    if (match) {
      return { providerKey: providerHint, ...match };
    }
  }

  for (const [providerKey, provider] of Object.entries(catalog)) {
    if (providerHint && providerKey !== providerHint) {
      continue;
    }
    const match = lookupCapabilitiesInProvider(provider, trimmed);
    if (match) {
      return { providerKey, ...match };
    }
  }

  if (!providerHint) {
    for (const [providerKey, provider] of Object.entries(catalog)) {
      const match = lookupCapabilitiesInProvider(provider, trimmed);
      if (match) {
        return { providerKey, ...match };
      }
    }
  }

  return null;
}

function lookupCapabilitiesInProvider(
  provider: ModelsDevProviderEntry,
  modelId: string,
): Omit<ModelCapabilitiesLookup, "providerKey"> | null {
  return matchCapabilitiesFromProvider(provider, modelId);
}

function matchCapabilitiesFromProvider(
  provider: ModelsDevProviderEntry,
  modelId: string,
): Omit<ModelCapabilitiesLookup, "providerKey"> | null {
  const exact = provider.models[modelId];
  if (exact) {
    return capabilitiesFromEntry(exact);
  }

  const lower = modelId.toLowerCase();
  for (const entry of Object.values(provider.models)) {
    if (entry.id.toLowerCase() === lower) {
      const matched = capabilitiesFromEntry(entry);
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
      const matched = capabilitiesFromEntry(entry);
      if (matched) {
        return matched;
      }
    }
  }

  const fuzzy = Object.values(provider.models)
    .filter((entry) => entry.id.toLowerCase().includes(lower) || lower.includes(entry.id.toLowerCase()))
    .sort((a, b) => a.id.length - b.id.length);
  for (const entry of fuzzy) {
    const matched = capabilitiesFromEntry(entry);
    if (matched) {
      return matched;
    }
  }

  return null;
}

function capabilitiesFromEntry(entry: ModelsDevModelEntry): Omit<ModelCapabilitiesLookup, "providerKey"> {
  return {
    modelId: entry.id,
    capabilities: extractCapabilitiesFromModelEntry(entry),
  };
}

function findModelEntry(provider: ModelsDevProviderEntry, modelId: string): ModelsDevModelEntry | undefined {
  const exact = provider.models[modelId];
  if (exact) {
    return exact;
  }
  const lower = modelId.toLowerCase();
  for (const entry of Object.values(provider.models)) {
    if (entry.id.toLowerCase() === lower) {
      return entry;
    }
  }
  return undefined;
}

/** Unresolved capabilities for models not found in catalog. */
export function unresolvedModelCapabilities(): ModelCapabilities {
  return {
    supportsImageInput: false,
    supportsReasoning: false,
    capabilitiesResolved: false,
  };
}
