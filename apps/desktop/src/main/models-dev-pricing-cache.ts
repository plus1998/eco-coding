import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONTEXT_LIMIT,
  extractCapabilitiesFromModelEntry,
  extractLimitsFromModelEntry,
  fetchModelsDevCatalog,
  filterOfficialModelsDevProviders,
  findModelEntryByKey,
  listModelsDevCatalogOptions,
  lookupModelCapabilitiesInCatalog,
  lookupModelCostByKey,
  lookupModelCostInCatalog,
  lookupModelLimitsInCatalog,
  resolveProviderKeyFromBaseUrl,
  type ModelCapabilitiesLookup,
  type ModelLimitsLookup,
  type ModelPricingLookup,
  type ModelsDevCatalog,
  type ModelsDevCatalogModelOption,
} from "@eco/runtime";
import type { ModelsDevMapping } from "../shared/ipc";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** When models.dev is unreachable and there is no disk cache, retry sooner. */
const FAILURE_RETRY_MS = 5 * 60 * 1000;

export interface ModelsDevPricingCacheOptions {
  cachePath: string;
  fetchImpl?: typeof fetch;
}

export interface ModelsDevRouteLookup {
  baseUrl: string;
  modelId: string;
  mapping?: ModelsDevMapping;
}

export class ModelsDevPricingCache {
  private catalog: ModelsDevCatalog | null = null;
  private loadedAt = 0;
  private catalogTtlMs = CACHE_TTL_MS;
  private loading: Promise<ModelsDevCatalog> | null = null;
  private lastLoadError: string | null = null;

  constructor(private readonly options: ModelsDevPricingCacheOptions) {}

  async getCatalog(): Promise<ModelsDevCatalog> {
    if (this.catalog && Date.now() - this.loadedAt < this.catalogTtlMs) {
      return this.catalog;
    }

    if (this.loading) {
      return this.loading;
    }

    this.loading = this.loadCatalog().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async refresh(): Promise<ModelsDevCatalog> {
    this.catalog = null;
    this.loadedAt = 0;
    this.catalogTtlMs = CACHE_TTL_MS;
    return this.getCatalog();
  }

  /** Last network/parse failure message, if any. Cleared on successful fetch. */
  getLastLoadError(): string | null {
    return this.lastLoadError;
  }

  async listModelOptions(): Promise<ModelsDevCatalogModelOption[]> {
    const catalog = await this.getCatalog();
    return listModelsDevCatalogOptions(catalog);
  }

  async lookup(baseUrl: string, modelId: string): Promise<ModelPricingLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelCostInCatalog(catalog, providerHint, modelId);
  }

  async lookupByKey(providerKey: string, modelId: string): Promise<ModelPricingLookup | null> {
    const catalog = await this.getCatalog();
    return lookupModelCostByKey(catalog, providerKey, modelId);
  }

  async lookupForRoute(input: ModelsDevRouteLookup): Promise<ModelPricingLookup | null> {
    if (input.mapping?.providerKey && input.mapping.modelId) {
      return this.lookupByKey(input.mapping.providerKey, input.mapping.modelId);
    }
    return this.lookup(input.baseUrl, input.modelId);
  }

  async lookupLimits(baseUrl: string, modelId: string): Promise<ModelLimitsLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelLimitsInCatalog(catalog, providerHint, modelId);
  }

  async lookupLimitsByKey(providerKey: string, modelId: string): Promise<ModelLimitsLookup | null> {
    const catalog = await this.getCatalog();
    const found = findModelEntryByKey(catalog, providerKey, modelId);
    if (!found) {
      return null;
    }
    const limits = extractLimitsFromModelEntry(found.entry);
    if (!limits) {
      return null;
    }
    return {
      providerKey: found.providerKey,
      modelId: found.entry.id,
      limits,
      ...(found.entry.name && { displayName: found.entry.name }),
    };
  }

  async lookupLimitsForRoute(input: ModelsDevRouteLookup): Promise<ModelLimitsLookup | null> {
    if (input.mapping?.providerKey && input.mapping.modelId) {
      return this.lookupLimitsByKey(input.mapping.providerKey, input.mapping.modelId);
    }
    return this.lookupLimits(input.baseUrl, input.modelId);
  }

  async lookupCapabilities(baseUrl: string, modelId: string): Promise<ModelCapabilitiesLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelCapabilitiesInCatalog(catalog, providerHint, modelId);
  }

  async lookupCapabilitiesByKey(
    providerKey: string,
    modelId: string,
  ): Promise<ModelCapabilitiesLookup | null> {
    const catalog = await this.getCatalog();
    const found = findModelEntryByKey(catalog, providerKey, modelId);
    if (!found) {
      return null;
    }
    return {
      providerKey: found.providerKey,
      modelId: found.entry.id,
      capabilities: extractCapabilitiesFromModelEntry(found.entry),
    };
  }

  async lookupCapabilitiesForRoute(input: ModelsDevRouteLookup): Promise<ModelCapabilitiesLookup | null> {
    if (input.mapping?.providerKey && input.mapping.modelId) {
      return this.lookupCapabilitiesByKey(input.mapping.providerKey, input.mapping.modelId);
    }
    return this.lookupCapabilities(input.baseUrl, input.modelId);
  }

  async resolveContextLimit(
    baseUrl: string,
    modelId: string,
    mapping?: ModelsDevMapping,
    manualContextTokens?: number,
    manualMaxOutputTokens?: number,
  ): Promise<{
    limit: number;
    maxOutputTokens?: number;
    limitsResolved: boolean;
  }> {
    if (manualContextTokens !== undefined && manualContextTokens > 0) {
      return {
        limit: manualContextTokens,
        ...(manualMaxOutputTokens !== undefined &&
          manualMaxOutputTokens > 0 && { maxOutputTokens: manualMaxOutputTokens }),
        limitsResolved: true,
      };
    }
    const lookup = await this.lookupLimitsForRoute({ baseUrl, modelId, ...(mapping && { mapping }) });
    if (lookup) {
      const maxOutputTokens = manualMaxOutputTokens ?? lookup.limits.maxOutputTokens;
      return {
        limit: lookup.limits.contextTokens,
        ...(maxOutputTokens !== undefined && { maxOutputTokens }),
        limitsResolved: true,
      };
    }
    if (manualMaxOutputTokens !== undefined && manualMaxOutputTokens > 0) {
      return { limit: DEFAULT_CONTEXT_LIMIT, maxOutputTokens: manualMaxOutputTokens, limitsResolved: true };
    }
    return { limit: DEFAULT_CONTEXT_LIMIT, limitsResolved: false };
  }

  getCachedAt(): number {
    return this.loadedAt;
  }

  private async loadCatalog(): Promise<ModelsDevCatalog> {
    const fromDisk = await this.readDiskCache();
    if (fromDisk) {
      this.catalog = fromDisk.catalog;
      this.loadedAt = fromDisk.fetchedAt;
      this.catalogTtlMs = CACHE_TTL_MS;
      if (Date.now() - fromDisk.fetchedAt < CACHE_TTL_MS) {
        return this.catalog;
      }
    }

    try {
      const catalog = await fetchModelsDevCatalog(this.options.fetchImpl);
      this.catalog = catalog;
      this.loadedAt = Date.now();
      this.catalogTtlMs = CACHE_TTL_MS;
      this.lastLoadError = null;
      await this.writeDiskCache(catalog);
      return catalog;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastLoadError = message;
      if (fromDisk) {
        // Keep serving stale disk cache; shorten TTL so we retry the network soon.
        this.catalogTtlMs = FAILURE_RETRY_MS;
        this.loadedAt = Date.now();
        return fromDisk.catalog;
      }
      // No disk cache: empty catalog so pricing/mapping is unresolved, but never throws.
      this.catalog = {};
      this.loadedAt = Date.now();
      this.catalogTtlMs = FAILURE_RETRY_MS;
      return this.catalog;
    }
  }

  private async readDiskCache(): Promise<{ catalog: ModelsDevCatalog; fetchedAt: number } | null> {
    try {
      const raw = await fs.readFile(this.options.cachePath, "utf8");
      const parsed = JSON.parse(raw) as { fetchedAt?: number; catalog?: ModelsDevCatalog };
      if (parsed.catalog && typeof parsed.fetchedAt === "number") {
        return {
          catalog: filterOfficialModelsDevProviders(parsed.catalog),
          fetchedAt: parsed.fetchedAt,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private async writeDiskCache(catalog: ModelsDevCatalog): Promise<void> {
    await fs.mkdir(path.dirname(this.options.cachePath), { recursive: true });
    await fs.writeFile(
      this.options.cachePath,
      JSON.stringify({ fetchedAt: Date.now(), catalog }),
      "utf8",
    );
  }
}
