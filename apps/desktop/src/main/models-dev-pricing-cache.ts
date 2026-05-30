import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONTEXT_LIMIT,
  fetchModelsDevCatalog,
  lookupModelCapabilitiesInCatalog,
  lookupModelCostInCatalog,
  lookupModelLimitsInCatalog,
  resolveProviderKeyFromBaseUrl,
  type ModelCapabilitiesLookup,
  type ModelLimitsLookup,
  type ModelPricingLookup,
  type ModelsDevCatalog,
} from "@eco/runtime";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ModelsDevPricingCacheOptions {
  cachePath: string;
  fetchImpl?: typeof fetch;
}

export class ModelsDevPricingCache {
  private catalog: ModelsDevCatalog | null = null;
  private loadedAt = 0;
  private loading: Promise<ModelsDevCatalog> | null = null;

  constructor(private readonly options: ModelsDevPricingCacheOptions) {}

  async getCatalog(): Promise<ModelsDevCatalog> {
    if (this.catalog && Date.now() - this.loadedAt < CACHE_TTL_MS) {
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
    return this.getCatalog();
  }

  async lookup(baseUrl: string, modelId: string): Promise<ModelPricingLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelCostInCatalog(catalog, providerHint, modelId);
  }

  async lookupLimits(baseUrl: string, modelId: string): Promise<ModelLimitsLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelLimitsInCatalog(catalog, providerHint, modelId);
  }

  async lookupCapabilities(baseUrl: string, modelId: string): Promise<ModelCapabilitiesLookup | null> {
    const catalog = await this.getCatalog();
    const providerHint = resolveProviderKeyFromBaseUrl(baseUrl);
    return lookupModelCapabilitiesInCatalog(catalog, providerHint, modelId);
  }

  async resolveContextLimit(baseUrl: string, modelId: string): Promise<{
    limit: number;
    maxOutputTokens?: number;
    limitsResolved: boolean;
  }> {
    const lookup = await this.lookupLimits(baseUrl, modelId);
    if (lookup) {
      return {
        limit: lookup.limits.contextTokens,
        ...(lookup.limits.maxOutputTokens !== undefined && {
          maxOutputTokens: lookup.limits.maxOutputTokens,
        }),
        limitsResolved: true,
      };
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
      if (Date.now() - fromDisk.fetchedAt < CACHE_TTL_MS) {
        return this.catalog;
      }
    }

    try {
      const catalog = await fetchModelsDevCatalog(this.options.fetchImpl);
      this.catalog = catalog;
      this.loadedAt = Date.now();
      await this.writeDiskCache(catalog);
      return catalog;
    } catch (error) {
      if (fromDisk) {
        return fromDisk.catalog;
      }
      throw error;
    }
  }

  private async readDiskCache(): Promise<{ catalog: ModelsDevCatalog; fetchedAt: number } | null> {
    try {
      const raw = await fs.readFile(this.options.cachePath, "utf8");
      const parsed = JSON.parse(raw) as { fetchedAt?: number; catalog?: ModelsDevCatalog };
      if (parsed.catalog && typeof parsed.fetchedAt === "number") {
        return { catalog: parsed.catalog, fetchedAt: parsed.fetchedAt };
      }
    } catch {
      // no cache yet
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
