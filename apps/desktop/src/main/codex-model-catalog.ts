import { listCodexModelCatalog, type CodexModelCatalogEntry } from "@eco/runtime";
import type { CodexModelCatalogEntryView } from "../shared/models";

export const DEFAULT_CODEX_MODEL_CATALOG_CACHE_TTL_MS = 5 * 60_000;

export interface CodexModelCatalogRequestClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface LiveCodexModelCatalogClient extends CodexModelCatalogRequestClient {
  readonly isInitialized: boolean;
}

export interface TemporaryCodexModelCatalogLifecycle {
  start(): Promise<CodexModelCatalogRequestClient>;
  stop(): Promise<void>;
}

export interface CodexModelCatalogServiceOptions {
  getLiveClient: () => LiveCodexModelCatalogClient | undefined;
  createTemporaryLifecycle: () => TemporaryCodexModelCatalogLifecycle;
  cacheTtlMs?: number;
  now?: () => number;
}

interface CachedCatalog {
  expiresAt: number;
  entries: CodexModelCatalogEntryView[];
  source: "live" | "temporary";
}

interface InFlightCatalog {
  generation: number;
  request: Promise<CodexModelCatalogEntryView[]>;
  source: CachedCatalog["source"];
}

export class CodexModelCatalogService {
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: CachedCatalog | undefined;
  private generation = 0;
  private inFlight: InFlightCatalog | undefined;

  constructor(private readonly options: CodexModelCatalogServiceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CODEX_MODEL_CATALOG_CACHE_TTL_MS;
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs <= 0) {
      throw new Error(`Codex model catalog cache TTL must be positive, received ${this.cacheTtlMs}.`);
    }
    this.now = options.now ?? Date.now;
  }

  async list(): Promise<CodexModelCatalogEntryView[]> {
    const liveClient = this.options.getLiveClient();
    const liveAvailable = liveClient?.isInitialized === true;
    const source: CachedCatalog["source"] = liveAvailable ? "live" : "temporary";
    const liveSupersedesTemporary =
      liveAvailable && (this.cache?.source === "temporary" || this.inFlight?.source === "temporary");
    if (liveSupersedesTemporary) {
      this.invalidate();
    }

    if (this.cache && this.now() < this.cache.expiresAt) {
      return cloneCatalog(this.cache.entries);
    }
    if (this.inFlight?.generation === this.generation) {
      return cloneCatalog(await this.inFlight.request);
    }

    const generation = this.generation;
    const request = this.loadAndCache(liveAvailable ? liveClient : undefined, source, generation);
    const inFlight: InFlightCatalog = { generation, request, source };
    this.inFlight = inFlight;
    try {
      return cloneCatalog(await request);
    } finally {
      if (this.inFlight === inFlight) {
        this.inFlight = undefined;
      }
    }
  }

  clear(): void {
    this.invalidate();
  }

  private invalidate(): void {
    this.cache = undefined;
    this.generation += 1;
  }

  private async loadAndCache(
    liveClient: LiveCodexModelCatalogClient | undefined,
    source: CachedCatalog["source"],
    generation: number,
  ): Promise<CodexModelCatalogEntryView[]> {
    let entries: CodexModelCatalogEntry[];
    if (liveClient) {
      entries = await listCodexModelCatalog(liveClient);
    } else {
      const lifecycle = this.options.createTemporaryLifecycle();
      try {
        entries = await listCodexModelCatalog(await lifecycle.start());
      } finally {
        await lifecycle.stop();
      }
    }

    const views = entries.map(toCatalogEntryView);
    if (this.generation === generation) {
      this.cache = {
        expiresAt: this.now() + this.cacheTtlMs,
        entries: cloneCatalog(views),
        source,
      };
    }
    return views;
  }
}

function toCatalogEntryView(entry: CodexModelCatalogEntry): CodexModelCatalogEntryView {
  return {
    id: entry.id,
    model: entry.model,
    displayName: entry.displayName,
    defaultReasoningEffort: entry.defaultReasoningEffort,
    supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
  };
}

function cloneCatalog(entries: readonly CodexModelCatalogEntryView[]): CodexModelCatalogEntryView[] {
  return entries.map((entry) => ({
    ...entry,
    supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
  }));
}
