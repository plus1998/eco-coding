import type { ParsedUsage } from "./usage";
import {
  type ModelsDevCatalog,
  type ModelsDevModelEntry,
  type ModelsDevProviderEntry,
  expandModelLookupCandidates,
  lookupModelCostInCatalog,
} from "./models-dev-pricing";

const MODEL_ALIASES: Record<string, string[]> = {
  sonnet: ["claude-sonnet"],
  opus: ["claude-opus"],
  haiku: ["claude-haiku"],
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export interface ModelContextLimits {
  contextTokens: number;
  maxOutputTokens?: number;
}

export interface ModelLimitsLookup {
  providerKey: string;
  modelId: string;
  limits: ModelContextLimits;
  displayName?: string;
}

export function extractLimitsFromModelEntry(entry: ModelsDevModelEntry): ModelContextLimits | null {
  const limit = entry.limit;
  if (!limit || typeof limit.context !== "number" || limit.context <= 0) {
    return null;
  }
  return {
    contextTokens: limit.context,
    ...(typeof limit.output === "number" && limit.output > 0 && { maxOutputTokens: limit.output }),
  };
}

export function lookupModelLimitsInCatalog(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  modelId: string,
): ModelLimitsLookup | null {
  const pricing = lookupModelCostInCatalog(catalog, providerHint, modelId);
  if (!pricing) {
    return lookupLimitsOnly(catalog, providerHint, modelId);
  }

  const provider = catalog[pricing.providerKey];
  const entry = provider ? findModelEntry(provider, pricing.modelId) : undefined;
  const limits = entry ? extractLimitsFromModelEntry(entry) : null;
  if (!limits) {
    return lookupLimitsOnly(catalog, providerHint, modelId);
  }

  return {
    providerKey: pricing.providerKey,
    modelId: pricing.modelId,
    limits,
    ...(pricing.displayName && { displayName: pricing.displayName }),
  };
}

function lookupLimitsOnly(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  modelId: string,
): ModelLimitsLookup | null {
  const candidates = expandModelLookupCandidates(modelId, providerHint);
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const match = lookupLimitsForCandidate(catalog, providerHint, candidate);
    if (match) {
      return match;
    }
  }

  if (providerHint) {
    for (const candidate of expandModelLookupCandidates(modelId, null)) {
      const match = lookupLimitsForCandidate(catalog, null, candidate);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function lookupLimitsForCandidate(
  catalog: ModelsDevCatalog,
  providerHint: string | null,
  trimmed: string,
): ModelLimitsLookup | null {
  if (providerHint && catalog[providerHint]) {
    const match = lookupLimitsInProvider(catalog[providerHint]!, trimmed);
    if (match) {
      return { providerKey: providerHint, ...match };
    }
  }

  for (const [providerKey, provider] of Object.entries(catalog)) {
    if (providerHint && providerKey !== providerHint) {
      continue;
    }
    const match = lookupLimitsInProvider(provider, trimmed);
    if (match) {
      return { providerKey, ...match };
    }
  }

  if (!providerHint) {
    for (const [providerKey, provider] of Object.entries(catalog)) {
      const match = lookupLimitsInProvider(provider, trimmed);
      if (match) {
        return { providerKey, ...match };
      }
    }
  }

  return null;
}

function lookupLimitsInProvider(
  provider: ModelsDevProviderEntry,
  modelId: string,
): Omit<ModelLimitsLookup, "providerKey"> | null {
  const match = matchLimitsFromProvider(provider, modelId);
  return match;
}

function matchLimitsFromProvider(
  provider: ModelsDevProviderEntry,
  modelId: string,
): Omit<ModelLimitsLookup, "providerKey"> | null {
  const exact = provider.models[modelId];
  if (exact) {
    return limitsFromEntry(exact);
  }

  const lower = modelId.toLowerCase();
  for (const entry of Object.values(provider.models)) {
    if (entry.id.toLowerCase() === lower) {
      const matched = limitsFromEntry(entry);
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
      const matched = limitsFromEntry(entry);
      if (matched) {
        return matched;
      }
    }
  }

  const fuzzy = Object.values(provider.models)
    .filter((entry) => entry.id.toLowerCase().includes(lower) || lower.includes(entry.id.toLowerCase()))
    .sort((a, b) => b.id.length - a.id.length);
  for (const entry of fuzzy) {
    const matched = limitsFromEntry(entry);
    if (matched) {
      return matched;
    }
  }

  return null;
}

function limitsFromEntry(entry: ModelsDevModelEntry): Omit<ModelLimitsLookup, "providerKey"> | null {
  const limits = extractLimitsFromModelEntry(entry);
  if (!limits) {
    return null;
  }
  return {
    modelId: entry.id,
    limits,
    ...(entry.name && { displayName: entry.name }),
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

/**
 * Context window fill for a single API turn (Claude Code / OpenCode style).
 * Uses input + cache tokens only — output does not count toward the context limit.
 */
export function computeWindowOccupancy(usage: ParsedUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function computeOccupancyRatio(
  occupied: number,
  limit: number,
  threshold = 0.85,
): { ratio: number; atThreshold: boolean } {
  if (limit <= 0) {
    return { ratio: 0, atThreshold: false };
  }
  const ratio = occupied / limit;
  return { ratio, atThreshold: ratio >= threshold };
}

export function occupancyPercent(occupied: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((occupied / limit) * 100));
}

/** Compact label for context window size (e.g. 200K, 1.0M). */
export function formatContextLimit(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 1_000_000) {
    const rounded = tokens / 1000;
    return rounded >= 100 ? `${Math.round(rounded)}K` : `${rounded.toFixed(1)}K`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
